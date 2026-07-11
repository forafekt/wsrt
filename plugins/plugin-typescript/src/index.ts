import fs from 'node:fs'
import path from 'node:path'
import type { WsrtDiagnostic, WsrtPlugin, WorkspaceRuntime } from '@wsrt/types'
import { packageManagerCommand, readJson, relative, runProcess, walkFiles } from '@wsrt/plugin-utils'

type TsconfigInfo = {
  file: string
  extends?: unknown
  references: string[]
  compilerOptions: Record<string, unknown>
}

type TypeScriptState = {
  detected: boolean
  version?: string
  tsconfigs: TsconfigInfo[]
  diagnostics: WsrtDiagnostic[]
  lastTypecheck?: { exitCode: number | null; command: string; stdout: string; stderr: string }
}

export default function typeScriptPlugin(): WsrtPlugin {
  return {
    name: 'typescript',
    runtimeCreated({ runtime }) {
      refreshTypeScript(runtime)
      runtime.commands.register({
        id: 'typescript.refresh',
        title: 'Refresh TypeScript state',
        description: 'Discover tsconfig files, references, compiler options, and warnings.',
        run: ({ runtime: currentRuntime }) => refreshTypeScript(currentRuntime),
      })
      runtime.tasks.register({
        id: 'typecheck',
        title: 'Run TypeScript typecheck',
        description: 'Run the package manager typecheck script or tsc --noEmit when available.',
        run: ({ runtime: currentRuntime }) => runTypecheck(currentRuntime),
      })
    },

    // TODO
    // dashboardRoutes(routes) {
    //   routes.push({ id: 'typescript', label: 'TypeScript', path: '#typescript' })
    // },
    // dashboardPages(pages, { runtime }) {
    //   const state = runtime.query.plugin('typescript') as TypeScriptState | undefined
    //   if (!state?.detected) return
    //   pages.push(typeScriptDashboardPage(state))
    // },
    custom({ runtime }) {
      if (!runtime.state?.dashboard) return
      runtime.state.dashboard.routes.push({ id: 'typescript', label: 'TypeScript', path: '#typescript' })
      const state = runtime.query.plugin('typescript') as TypeScriptState | undefined
      if (!state?.detected) return
      runtime.state.dashboard.pages.push(typeScriptDashboardPage(state))
    },
    mcpTools(entries) {
      entries.push({
        id: 'plugin.typescript',
        title: 'TypeScript summary',
        description: 'Return discovered tsconfig files, references, options, and typecheck status.',
        kind: 'tool',
      })
    },
  }
}

export { typeScriptPlugin }

function refreshTypeScript(runtime: WorkspaceRuntime): TypeScriptState {
  const tsconfigs = walkFiles(runtime.root, (file) => /^tsconfig(\..+)?\.json$/.test(path.basename(file)))
    .map((file) => tsconfigInfo(runtime.root, file))
    .filter((item): item is TsconfigInfo => Boolean(item))
  const diagnostics = tsDiagnostics(tsconfigs)
  for (const config of tsconfigs) runtime.events.emit('typescript:tsconfig-discovered', { file: config.file })
  for (const diagnostic of diagnostics) runtime.diagnostics.add(diagnostic)
  const state: TypeScriptState = {
    detected: tsconfigs.length > 0 || fs.existsSync(path.join(runtime.root, 'node_modules/typescript/package.json')),
    version: typeScriptVersion(runtime.root),
    tsconfigs,
    diagnostics,
  }
  runtime.setPluginData('typescript', 'state', state)
  runtime.events.emit('typescript:state-refreshed', {
    root: runtime.root,
    tsconfigs: tsconfigs.length,
    diagnostics: diagnostics.length,
  })
  upsertGraph(runtime, tsconfigs)
  return state
}

async function runTypecheck(runtime: WorkspaceRuntime): Promise<TypeScriptState> {
  runtime.events.emit('typescript:typecheck-started', { root: runtime.root })
  const workspace = runtime.query.plugin('workspace') as { packageManager?: { name?: string }; rootPackage?: { scripts?: Record<string, string> } } | undefined
  const manager = workspace?.packageManager?.name
  const scripts = workspace?.rootPackage?.scripts ?? {}
  const command = packageManagerCommand(manager)
  const args = scripts.typecheck
    ? manager === 'npm'
      ? ['run', 'typecheck']
      : ['typecheck']
    : ['exec', 'tsc', '--noEmit']
  try {
    const result = await runProcess(command, args, runtime.root)
    runtime.events.emit('typescript:typecheck-completed', { root: runtime.root, exitCode: result.exitCode })
    const refreshed = refreshTypeScript(runtime)
    const state = { ...refreshed, lastTypecheck: result }
    runtime.setPluginData('typescript', 'state', state)
    return state
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause)
    runtime.events.emit('typescript:typecheck-failed', { root: runtime.root, error })
    throw cause
  }
}

function tsconfigInfo(root: string, file: string): TsconfigInfo | undefined {
  const json = readJson(file)
  if (!json) return undefined
  const references = Array.isArray(json.references)
    ? json.references
        .map((reference) => reference && typeof reference === 'object' && 'path' in reference ? String((reference as { path: unknown }).path) : undefined)
        .filter((item): item is string => Boolean(item))
        .map((reference) => relative(root, path.resolve(path.dirname(file), reference)))
    : []
  return {
    file: relative(root, file),
    extends: json.extends,
    references,
    compilerOptions: compilerOptionsSummary(json.compilerOptions),
  }
}

function compilerOptionsSummary(value: unknown): Record<string, unknown> {
  const options = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const keys = ['target', 'module', 'moduleResolution', 'lib', 'jsx', 'strict', 'noEmit', 'declaration', 'composite', 'baseUrl', 'paths', 'types']
  return Object.fromEntries(keys.filter((key) => key in options).map((key) => [key, options[key]]))
}

function tsDiagnostics(tsconfigs: TsconfigInfo[]): WsrtDiagnostic[] {
  const diagnostics: WsrtDiagnostic[] = []
  for (const config of tsconfigs) {
    if (config.references.length && config.compilerOptions.composite !== true) {
      diagnostics.push({
        level: 'warning',
        code: 'typescript.references_without_composite',
        message: 'Project references usually require composite compiler output.',
        source: config.file,
      })
    }
  }
  return diagnostics
}

function typeScriptVersion(root: string): string | undefined {
  const manifest = readJson(path.join(root, 'node_modules/typescript/package.json'))
  return typeof manifest?.version === 'string' ? manifest.version : undefined
}

function upsertGraph(runtime: WorkspaceRuntime, tsconfigs: TsconfigInfo[]): void {
  for (const config of tsconfigs) {
    const id = `tsconfig:${config.file}`
    if (!runtime.state.graph.nodes.some((node) => node.id === id))
      runtime.state.graph.nodes.push({ id, root: path.join(runtime.root, config.file), kind: 'tsconfig', metadata: { options: config.compilerOptions } })
    for (const reference of config.references) {
      const target = `tsconfig:${reference.endsWith('.json') ? reference : path.join(reference, 'tsconfig.json')}`
      if (!runtime.state.graph.nodes.some((node) => node.id === target))
        runtime.state.graph.nodes.push({ id: target, root: path.join(runtime.root, reference), kind: 'tsconfig' })
      if (!runtime.state.graph.edges.some((edge) => edge.from === id && edge.to === target && edge.type === 'typescript:reference'))
        runtime.state.graph.edges.push({ from: id, to: target, type: 'typescript:reference' })
    }
  }
}

// TODO
type DashboardPluginPage = Record<string, unknown>

function typeScriptDashboardPage(state: TypeScriptState): DashboardPluginPage {
  return {
    id: 'typescript',
    title: 'TypeScript',
    subtitle: state.version ? `TypeScript ${state.version}` : 'Project configuration',
    plugin: 'typescript',
    widgets: [
      { kind: 'metric', label: 'Tsconfigs', value: state.tsconfigs.length },
      { kind: 'metric', label: 'References', value: state.tsconfigs.reduce((count, config) => count + config.references.length, 0) },
      { kind: 'metric', label: 'Warnings', value: state.diagnostics.length },
      { kind: 'key-values', title: 'Runtime', values: { Version: state.version || 'not installed locally', 'Last typecheck': state.lastTypecheck ? `exit ${state.lastTypecheck.exitCode}` : 'not run' } },
      { kind: 'actions', title: 'Actions', actions: [{ label: 'Refresh', action: 'command:run', id: 'typescript.refresh' }, { label: 'Typecheck', action: 'task:run', id: 'typecheck' }] },
      { kind: 'table', title: 'Tsconfig files', headers: ['File', 'Extends', 'References'], rows: state.tsconfigs.map((config) => [config.file, String(config.extends ?? ''), config.references.join(', ')]) },
      { kind: 'table', title: 'Important compiler options', headers: ['File', 'Options'], rows: state.tsconfigs.map((config) => [config.file, Object.entries(config.compilerOptions).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(', ')]) },
      { kind: 'table', title: 'Detected issues', headers: ['Level', 'Code', 'Message', 'Source'], rows: state.diagnostics.map((diagnostic) => [diagnostic.level, diagnostic.code, diagnostic.message, diagnostic.source ?? '']) },
      { kind: 'json', title: 'Advanced', data: state },
    ],
  }
}
