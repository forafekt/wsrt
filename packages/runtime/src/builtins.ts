import { spawn } from 'node:child_process'
import { runMcpTool } from '@wsrt/mcp'
import type { ProjectHandle, WorkspaceRuntime } from '@wsrt/types'

export type RuntimeCliLifecycleResult = {
  kind: 'lifecycle'
  message: string
  close: () => Promise<void>
  value?: unknown
}

export function registerCoreRuntimeExtensions(runtime: WorkspaceRuntime): void {
  registerCoreTasks(runtime)
  registerCoreCommands(runtime)
  registerCoreCliGroups(runtime)
}

function registerCoreTasks(runtime: WorkspaceRuntime): void {
  runtime.tasks.register({
    id: 'validate',
    title: 'Validate runtime model',
    description: 'Return diagnostics and an ok flag for the current runtime model.',
    run: ({ runtime: currentRuntime }) => ({
      ok: currentRuntime.query.diagnostics({ level: 'error' }).length === 0,
      diagnostics: currentRuntime.query.diagnostics(),
    }),
  })
  runtime.tasks.register({
    id: 'graph',
    title: 'Query workspace graph',
    description: 'Return the runtime graph model.',
    run: ({ runtime: currentRuntime }) => currentRuntime.query.graph(),
  })
  runtime.tasks.register({
    id: 'snapshot',
    title: 'Generate runtime artifacts',
    description: 'Generate configured runtime report artifacts.',
    run: ({ runtime: currentRuntime }) => currentRuntime.generateArtifacts(),
  })
  runtime.tasks.register({
    id: 'tsconfig',
    title: 'Synchronize tsconfig files',
    description: 'Check or write configured tsconfig files.',
    run: ({ runtime: currentRuntime, args }) =>
      currentRuntime.syncTsconfig(args[0] === 'write' ? 'write' : 'check'),
  })
  runtime.tasks.register({
    id: 'manifests',
    title: 'Synchronize manifests',
    description: 'Check or write configured manifest files.',
    run: ({ runtime: currentRuntime, args }) =>
      currentRuntime.syncManifests(args[0] === 'write' ? 'write' : 'check'),
  })
}

function registerCoreCommands(runtime: WorkspaceRuntime): void {
  runtime.commands.register({
    id: 'service',
    title: 'Control a runtime service',
    description: 'Run service <id> <start|stop|restart|health>.',
    async run({ runtime: currentRuntime, args }) {
      const [id, action = 'start'] = args
      if (!id) throw new Error('Usage: wsrt exec service <id> <start|stop|restart|health>')
      if (action === 'start') return currentRuntime.services.start(id)
      if (action === 'stop') return currentRuntime.services.stop(id)
      if (action === 'restart') return currentRuntime.services.restart(id)
      if (action === 'health') return currentRuntime.services.health(id)
      throw new Error(`Unknown service action "${action}"`)
    },
  })
  runtime.commands.register({
    id: 'graph',
    title: 'Query or export graph',
    description: 'Return the runtime graph.',
    run: ({ runtime: currentRuntime }) => currentRuntime.query.graph(),
  })
  runtime.commands.register({
    id: 'mcp',
    title: 'Run an MCP tool',
    description: 'Run a registered MCP tool through the runtime model.',
    run: ({ runtime: currentRuntime, args }) => {
      const [tool, ...pairs] = args
      if (!tool) return currentRuntime.state.mcp
      return runMcpTool(currentRuntime, tool, parseKeyValues(pairs))
    },
  })
}

function registerCoreCliGroups(runtime: WorkspaceRuntime): void {
  runtime.cli.registerGroup({
    id: 'run',
    title: 'Run lifecycle services',
    aliases: ['dev', 'mcp'],
    async run({ runtime: currentRuntime, args, options }) {
      const alias = typeof options.alias === 'string' ? options.alias : undefined
      const [target = inferRunTarget(options), ...rest] = alias ? [alias, ...args] : args
      if (target === 'mcp') {
        return runMcpTool(currentRuntime, rest[0] ?? 'workspace.overview', parseKeyValues(rest.slice(1)))
      }
      if (target === 'profile') {
        return currentRuntime.query.overview()
      }
      if (target === 'service') {
        const [id, action = 'start'] = rest
        if (!id) return currentRuntime.query.services()
        const service =
          action === 'restart'
            ? await currentRuntime.services.restart(id)
            : await currentRuntime.services.start(id)
        return service
      }
      const handles = target === 'dev' ? await startProjects(currentRuntime, rest) : await startProjects(currentRuntime, [target, ...rest])
      return {
        kind: 'lifecycle',
        message: lifecycleMessage(handles),
        close: async () => {
          await Promise.all(handles.map((handle) => handle.close()))
        },
        value: handles,
      } satisfies RuntimeCliLifecycleResult
    },
  })

  runtime.cli.registerGroup({
    id: 'task',
    title: 'Run finite runtime tasks',
    aliases: ['tsconfig', 'manifests', 'artifacts'],
    async run({ runtime: currentRuntime, args, options }) {
      const alias = typeof options.alias === 'string' ? options.alias : undefined
      const [taskId = 'list', ...taskArgs] = alias ? [alias, ...args] : args
      if (taskId === 'list') return currentRuntime.query.tasks()
      const aliasTask = taskAlias(taskId)
      const result = await currentRuntime.tasks.run(aliasTask, { args: taskArgs })
      return options.json ? result : { task: aliasTask, result }
    },
  })

  runtime.cli.registerGroup({
    id: 'exec',
    title: 'Execute commands',
    async run({ runtime: currentRuntime, args }) {
      const [command, ...commandArgs] = args
      if (!command) return currentRuntime.commands.list()
      if (currentRuntime.commands.get(command))
        return currentRuntime.commands.run(command, { args: commandArgs })
      return runExternalCommand(command, commandArgs)
    },
  })

  runtime.cli.registerGroup({
    id: 'query',
    title: 'Inspect runtime state',
    aliases: ['inspect', 'graph', 'resolve'],
    run({ runtime: currentRuntime, args, options }) {
      const [target = inferQueryTarget(options), ...rest] = args
      if (target === 'overview') return currentRuntime.query.overview()
      if (target === 'projects') return currentRuntime.query.projects()
      if (target === 'packages') return currentRuntime.query.packages({ search: rest[0] })
      if (target === 'services') return currentRuntime.query.services()
      if (target === 'diagnostics') return currentRuntime.query.diagnostics()
      if (target === 'graph') return currentRuntime.query.graph()
      if (target === 'events') return currentRuntime.query.events()
      if (target === 'timeline') return currentRuntime.query.timeline()
      if (target === 'config') return currentRuntime.query.config()
      if (target === 'artifacts') return currentRuntime.query.artifacts()
      if (target === 'tasks') return currentRuntime.query.tasks()
      if (target === 'cli') return currentRuntime.query.cli()
      if (currentRuntime.query.plugin(target) !== undefined) return currentRuntime.query.plugin(target)
      if (target === 'resolve') {
        const specifier = rest[0]
        if (!specifier) throw new Error('Usage: wsrt query resolve <specifier>')
        return currentRuntime.resolve(specifier)
      }
      throw new Error(`Unknown runtime query "${target}"`)
    },
  })
}

async function startProjects(runtime: WorkspaceRuntime, names: string[]): Promise<ProjectHandle[]> {
  if (names.length === 0) return runtime.start()
  const handles: ProjectHandle[] = []
  for (const name of names) handles.push(await runtime.runProject(name))
  return handles
}

function lifecycleMessage(handles: ProjectHandle[]): string {
  if (handles.length === 1) {
    const [handle] = handles
    return `WSRT ${handle.adapter} service "${handle.name}" running${handle.url ? ` at ${handle.url}` : ''}`
  }
  return `WSRT running ${handles.length} service(s)`
}

function runExternalCommand(command: string, args: string[]): Promise<{ command: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code && code !== 0) {
        reject(new Error(`Command "${command}" exited with code ${code}`))
        return
      }
      resolve({ command: [command, ...args].join(' '), code })
    })
  })
}

function parseKeyValues(args: string[]): Record<string, unknown> {
  return Object.fromEntries(args.map((arg) => {
    const [key, ...rest] = arg.split('=')
    return [key, rest.join('=')]
  }))
}

function taskAlias(id: string): string {
  if (id === 'artifacts') return 'snapshot'
  return id
}

function inferRunTarget(options: Record<string, unknown>): string {
  return typeof options.alias === 'string' ? options.alias : 'dev'
}

function inferQueryTarget(options: Record<string, unknown>): string {
  if (options.alias === 'graph') return 'graph'
  if (options.alias === 'resolve') return 'resolve'
  return 'overview'
}
