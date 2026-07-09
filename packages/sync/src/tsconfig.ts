import fs from 'node:fs'
import path from 'node:path'
import { info, warning } from '@wsrt/diagnostics'
import type { SyncFileStatus, SyncMode, WorkspaceRuntime } from '@wsrt/types'
import { readJsonFile, stableJson, writeJsonFile } from './json.js'

export async function syncTsconfigs(
  runtime: WorkspaceRuntime,
  mode: SyncMode = runtime.state.tsconfig.mode,
): Promise<SyncFileStatus[]> {
  const config = runtime.config.get('tsconfig')
  const enabled = runtime.state.tsconfig.enabled
  if (!enabled) {
    runtime.state.tsconfig.files = []
    return []
  }
  const files = tsconfigFiles(
    runtime,
    config?.root !== false,
    config?.projects !== false,
  )
  const statuses = files.map((file) =>
    syncTsconfigFile(runtime, file, mode, config?.paths !== false),
  )
  runtime.state.tsconfig = { enabled, mode, files: statuses }
  runtime.diagnostics.add(
    info('tsconfig.sync.complete', `Checked ${statuses.length} tsconfig file(s)`, {
      detail: { mode, drifted: statuses.filter((item) => item.status === 'drifted').length },
    }),
  )
  return statuses
}

function syncTsconfigFile(
  runtime: WorkspaceRuntime,
  file: string,
  mode: SyncMode,
  includePaths: boolean,
): SyncFileStatus {
  const diagnostics = [
    warning(
      'tsconfig.comments_lost_on_write',
      'WSRT writes tsconfig files as JSON; comments are not preserved in write mode.',
      { source: file },
    ),
  ]
  const current = readJsonFile(file)
  if (!current) {
    const status: SyncFileStatus = {
      file,
      target: 'tsconfig',
      status: 'missing',
      message: 'tsconfig not found',
      diagnostics: [],
    }
    runtime.diagnostics.add(
      warning('tsconfig.missing', `tsconfig not found: ${file}`, { source: file }),
    )
    return status
  }
  const next = {
    ...current,
    compilerOptions: {
      ...record(current.compilerOptions),
      ...(includePaths ? { paths: compilerPaths(runtime) } : {}),
    },
  }
  const changed = stableJson(current) !== stableJson(next)
  if (!changed) return { file, target: 'tsconfig', status: 'synced', diagnostics: [] }
  if (mode === 'write') {
    writeJsonFile(file, next)
    return {
      file,
      target: 'tsconfig',
      status: 'written',
      message: 'compilerOptions.paths updated',
      diagnostics,
    }
  }
  runtime.diagnostics.add(
    warning('tsconfig.drift', `tsconfig paths drift detected: ${file}`, { source: file }),
  )
  return {
    file,
    target: 'tsconfig',
    status: 'drifted',
    message: 'compilerOptions.paths differ from WSRT aliases',
    diagnostics,
  }
}

function tsconfigFiles(
  runtime: WorkspaceRuntime,
  rootEnabled: boolean,
  projectsEnabled: boolean,
): string[] {
  const files = new Set<string>()
  if (rootEnabled) files.add(path.join(runtime.state.root, 'tsconfig.json'))
  if (projectsEnabled) {
    for (const project of runtime.state.projects) {
      files.add(path.join(project.root, 'tsconfig.json'))
      for (const processProject of project.processes)
        files.add(path.join(processProject.root, 'tsconfig.json'))
    }
  }
  return [...files].filter((file) => fs.existsSync(file)).sort()
}

function compilerPaths(runtime: WorkspaceRuntime): Record<string, string[]> {
  const entries: Record<string, string[]> = {}
  for (const [specifier, target] of Object.entries(runtime.state.aliases)) {
    entries[specifier] = [relativeTsconfigPath(runtime.state.root, target)]
  }
  return entries
}

function relativeTsconfigPath(root: string, target: string): string {
  const relative = path.relative(root, target).replaceAll(path.sep, '/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
