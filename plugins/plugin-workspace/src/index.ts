import fs from 'node:fs'
import path from 'node:path'
import type { WsrtDiagnostic, WsrtPlugin, WorkspacePackage, WorkspaceRuntime } from '@wsrt/types'
import { packageManagerCommand, readJson, relative, runProcess, walkFiles } from '@wsrt/plugin-utils'

type PackageSummary = {
  name: string
  root: string
  private?: boolean
  version?: string
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  internalDependencies: string[]
}

type WorkspaceState = {
  root: string
  packageManager?: { name: string; version?: string; lockfile?: string }
  workspaceConfig?: string
  rootPackage?: PackageSummary
  packages: PackageSummary[]
  dependencySummary: { dependencies: number; devDependencies: number; internal: number }
  diagnostics: WsrtDiagnostic[]
}

export default function workspacePlugin(): WsrtPlugin {
  return {
    name: 'workspace',
    runtimeCreated({ runtime }) {
      refreshWorkspace(runtime)
      runtime.commands.register({
        id: 'workspace.refresh',
        title: 'Refresh workspace package data',
        description: 'Refresh package manager, package, script, and dependency summaries.',
        run: ({ runtime: currentRuntime }) => refreshWorkspace(currentRuntime),
      })
      registerScriptTasks(runtime)
    },
    packagesDiscovered(packages, { runtime }) {
      for (const pkg of packages) runtime.events.emit('workspace:package-discovered', { name: pkg.name, root: pkg.root })
    },
  // TODO
    // dashboardRoutes(routes) {
    //   routes.push({ id: 'workspace', label: 'Workspace', path: '#workspace' })
    // },
    // dashboardPages(pages, { runtime }) {
    //   const state = runtime.query.plugin('workspace') as WorkspaceState | undefined
    //   if (state) pages.push(workspaceDashboardPage(state))
    // },
    custom({ runtime }) {
      if (!runtime.state?.dashboard) return
      runtime.state.dashboard.routes.push({ id: 'workspace', label: 'Workspace', path: '#workspace' })
      const state = runtime.query.plugin('workspace') as WorkspaceState | undefined
      if (state) runtime.state.dashboard.pages.push(workspaceDashboardPage(state))
    },
    mcpTools(entries) {
      entries.push({
        id: 'plugin.workspace',
        title: 'Workspace package summary',
        description: 'Return package manager, scripts, dependencies, packages, and package graph data.',
        kind: 'tool',
      })
    },
  }
}

export { workspacePlugin }

function refreshWorkspace(runtime: WorkspaceRuntime): WorkspaceState {
  const rootPackage = packageSummary(runtime.root, runtime.root, runtime.state.packages)
  const packageFiles = new Set([
    ...runtime.state.packages.map((pkg) => pkg.packageJson),
    ...walkFiles(runtime.root, (file) => path.basename(file) === 'package.json', { maxDepth: 5 }),
  ])
  const packages = [...packageFiles]
    .map((file) => packageSummary(runtime.root, path.dirname(file), runtime.state.packages))
    .filter((pkg): pkg is PackageSummary => Boolean(pkg))
    .sort((a, b) => a.name.localeCompare(b.name))
  const manager = detectPackageManager(runtime.root, rootPackage)
  const diagnostics = workspaceDiagnostics(runtime.root, manager, packages)
  for (const diagnostic of diagnostics) runtime.diagnostics.add(diagnostic)
  const state: WorkspaceState = {
    root: runtime.root,
    packageManager: manager,
    workspaceConfig: workspaceConfig(runtime.root),
    rootPackage,
    packages,
    dependencySummary: {
      dependencies: sum(packages, (pkg) => Object.keys(pkg.dependencies).length),
      devDependencies: sum(packages, (pkg) => Object.keys(pkg.devDependencies).length),
      internal: sum(packages, (pkg) => pkg.internalDependencies.length),
    },
    diagnostics,
  }
  runtime.setPluginData('workspace', 'state', state)
  runtime.events.emit('workspace:package-manager-detected', { root: runtime.root, packageManager: manager?.name })
  runtime.events.emit('workspace:graph-updated', { packages: packages.length, edges: runtime.state.graph.edges.length })
  upsertGraph(runtime, packages)
  return state
}

function registerScriptTasks(runtime: WorkspaceRuntime): void {
  for (const script of ['build', 'test', 'lint']) {
    runtime.tasks.register({
      id: script,
      title: `Run ${script}`,
      description: `Run the root package ${script} script when present.`,
      run: async ({ runtime: currentRuntime }) => {
        const state = currentRuntime.query.plugin('workspace') as WorkspaceState | undefined
        const manager = state?.packageManager?.name
        const scripts = state?.rootPackage?.scripts ?? {}
        if (!scripts[script]) return { skipped: true, reason: `No root ${script} script was found.` }
        const command = packageManagerCommand(manager)
        const args = manager === 'npm' ? ['run', script] : [script]
        return runProcess(command, args, currentRuntime.root)
      },
    })
  }
}

function packageSummary(root: string, dir: string, workspacePackages: WorkspacePackage[]): PackageSummary | undefined {
  const manifest = readJson(path.join(dir, 'package.json'))
  if (!manifest) return undefined
  const name = typeof manifest.name === 'string' ? manifest.name : relative(root, dir)
  const dependencies = dependencyRecord(manifest.dependencies)
  const devDependencies = dependencyRecord(manifest.devDependencies)
  const workspaceNames = new Set(workspacePackages.map((pkg) => pkg.name))
  return {
    name,
    root: relative(root, dir),
    private: typeof manifest.private === 'boolean' ? manifest.private : undefined,
    version: typeof manifest.version === 'string' ? manifest.version : undefined,
    scripts: dependencyRecord(manifest.scripts),
    dependencies,
    devDependencies,
    internalDependencies: [...Object.keys(dependencies), ...Object.keys(devDependencies)].filter((dep) => workspaceNames.has(dep)),
  }
}

function dependencyRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item)]))
}

function detectPackageManager(root: string, rootPackage?: PackageSummary): WorkspaceState['packageManager'] {
  const packageManager = readJson(path.join(root, 'package.json'))?.packageManager
  const fromManifest = typeof packageManager === 'string' ? packageManager.split('@') : []
  const locks: Array<[string, string]> = [
    ['pnpm', 'pnpm-lock.yaml'],
    ['npm', 'package-lock.json'],
    ['yarn', 'yarn.lock'],
    ['bun', 'bun.lockb'],
    ['bun', 'bun.lock'],
  ]
  const lock = locks.find(([, file]) => fs.existsSync(path.join(root, file)))
  const name = fromManifest[0] || lock?.[0] || (rootPackage?.scripts ? 'npm' : undefined)
  if (!name) return undefined
  return { name, version: fromManifest[1], lockfile: lock?.[1] }
}

function workspaceConfig(root: string): string | undefined {
  for (const file of ['pnpm-workspace.yaml', 'pnpm-workspace.yml', 'lerna.json', 'bunfig.toml']) {
    if (fs.existsSync(path.join(root, file))) return file
  }
  const manifest = readJson(path.join(root, 'package.json'))
  return manifest?.workspaces ? 'package.json#workspaces' : undefined
}

function workspaceDiagnostics(root: string, manager: WorkspaceState['packageManager'], packages: PackageSummary[]): WsrtDiagnostic[] {
  const diagnostics: WsrtDiagnostic[] = []
  if (manager?.name === 'pnpm' && !fs.existsSync(path.join(root, 'pnpm-workspace.yaml')) && packages.length > 1) {
    diagnostics.push({
      level: 'warning',
      code: 'workspace.pnpm_workspace_missing',
      message: 'Multiple packages were found but pnpm-workspace.yaml was not detected.',
      source: root,
    })
  }
  const duplicateNames = duplicates(packages.map((pkg) => pkg.name))
  for (const name of duplicateNames) {
    diagnostics.push({
      level: 'warning',
      code: 'workspace.duplicate_package_name',
      message: `Duplicate package name detected: ${name}`,
      detail: { name },
    })
  }
  return diagnostics
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) dupes.add(value)
    seen.add(value)
  }
  return [...dupes]
}

function sum<T>(items: T[], project: (item: T) => number): number {
  return items.reduce((total, item) => total + project(item), 0)
}

function upsertGraph(runtime: WorkspaceRuntime, packages: PackageSummary[]): void {
  for (const pkg of packages) {
    const id = `package-json:${pkg.name}`
    if (!runtime.state.graph.nodes.some((node) => node.id === id))
      runtime.state.graph.nodes.push({ id, root: path.join(runtime.root, pkg.root), kind: 'package-json', metadata: { scripts: Object.keys(pkg.scripts).length } })
    for (const dependency of pkg.internalDependencies) {
      if (!runtime.state.graph.edges.some((edge) => edge.from === pkg.name && edge.to === dependency && edge.type === 'workspace:package-dependency'))
        runtime.state.graph.edges.push({ from: pkg.name, to: dependency, type: 'workspace:package-dependency' })
    }
  }
}
// TODO
type DashboardPluginPage = Record<string, unknown>
function workspaceDashboardPage(state: WorkspaceState): DashboardPluginPage {
  return {
    id: 'workspace',
    title: 'Workspace',
    subtitle: state.packageManager ? `${state.packageManager.name} workspace` : state.root,
    plugin: 'workspace',
    widgets: [
      { kind: 'metric', label: 'Packages', value: state.packages.length },
      { kind: 'metric', label: 'Scripts', value: sum(state.packages, (pkg) => Object.keys(pkg.scripts).length) },
      { kind: 'metric', label: 'Internal deps', value: state.dependencySummary.internal },
      {
        kind: 'key-values',
        title: 'Package manager',
        values: {
          Manager: state.packageManager?.name || 'unknown',
          Version: state.packageManager?.version || '',
          Lockfile: state.packageManager?.lockfile || 'none',
          Workspace: state.workspaceConfig || 'none',
        },
      },
      { kind: 'actions', title: 'Actions', actions: [{ label: 'Refresh', action: 'command:run', id: 'workspace.refresh' }, { label: 'Build', action: 'task:run', id: 'build' }, { label: 'Test', action: 'task:run', id: 'test' }, { label: 'Lint', action: 'task:run', id: 'lint' }] },
      { kind: 'table', title: 'Workspace packages', headers: ['Package', 'Root', 'Version', 'Scripts', 'Internal dependencies'], rows: state.packages.map((pkg) => [pkg.name, pkg.root, pkg.version ?? '', Object.keys(pkg.scripts).join(', '), pkg.internalDependencies.join(', ')]) },
      { kind: 'table', title: 'Scripts', headers: ['Package', 'Script', 'Command'], rows: state.packages.flatMap((pkg) => Object.entries(pkg.scripts).map(([script, command]) => [pkg.name, script, command])) },
      { kind: 'table', title: 'Dependency summary', headers: ['Kind', 'Count'], rows: [['dependencies', state.dependencySummary.dependencies], ['devDependencies', state.dependencySummary.devDependencies], ['internal workspace', state.dependencySummary.internal]] },
      { kind: 'table', title: 'Detected issues', headers: ['Level', 'Code', 'Message'], rows: state.diagnostics.map((diagnostic) => [diagnostic.level, diagnostic.code, diagnostic.message]) },
      { kind: 'json', title: 'Advanced', data: state },
    ],
  }
}
