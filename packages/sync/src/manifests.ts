import fs from 'node:fs'
import path from 'node:path'
import { info, warning } from '@wsrt/diagnostics'
import type {
  ManifestTarget,
  SyncFileStatus,
  SyncMode,
  WorkspaceRuntime,
  WorkspacePackage,
} from '@wsrt/types'
import { readJsonFile, stableJson, writeJsonFile } from './json.js'

export async function syncManifests(
  runtime: WorkspaceRuntime,
  mode: SyncMode = runtime.state.manifests.mode,
): Promise<SyncFileStatus[]> {
  if (!runtime.state.manifests.enabled) {
    runtime.state.manifests.files = []
    return []
  }
  const config = runtime.config.get('manifests')
  const targets = config?.targets ?? ['package-json', 'extension', 'wsrt']
  const statuses = targets.flatMap((target) => syncTarget(runtime, target, mode))
  runtime.state.manifests = { enabled: true, mode, files: statuses }
  runtime.diagnostics.add(
    info('manifests.sync.complete', `Checked ${statuses.length} manifest file(s)`, {
      detail: { mode, drifted: statuses.filter((item) => item.status === 'drifted').length },
    }),
  )
  return statuses
}

function syncTarget(
  runtime: WorkspaceRuntime,
  target: ManifestTarget,
  mode: SyncMode,
): SyncFileStatus[] {
  if (target === 'wsrt') return [syncWSRTManifest(runtime, mode)]
  return runtime.state.packages.flatMap((pkg) =>
    target === 'package-json'
      ? [syncPackageJson(runtime, pkg, mode)]
      : syncExtensionManifests(runtime, pkg, mode),
  )
}

function syncPackageJson(
  runtime: WorkspaceRuntime,
  pkg: WorkspacePackage,
  mode: SyncMode,
): SyncFileStatus {
  const current = readJsonFile(pkg.packageJson)
  if (!current) return missing(runtime, pkg.packageJson, 'package-json')
  const next = {
    ...current,
    name: pkg.name,
    version: pkg.version ?? current.version,
    private: pkg.private ?? current.private,
  }
  return driftStatus(runtime, pkg.packageJson, 'package-json', current, next, mode)
}

function syncExtensionManifests(
  runtime: WorkspaceRuntime,
  pkg: WorkspacePackage,
  mode: SyncMode,
): SyncFileStatus[] {
  return extensionManifestNames(runtime).flatMap((manifestName) => {
    const file = path.join(pkg.root, manifestName)
    if (!fs.existsSync(file)) return []
    const current = readJsonFile(file)
    if (!current) return [missing(runtime, file, 'extension')]
    const next = {
      ...current,
      id: typeof current.id === 'string' ? current.id : pkg.name,
      version: typeof current.version === 'string' ? current.version : pkg.version,
    }
    return [driftStatus(runtime, file, 'extension', current, next, mode)]
  })
}

function syncWSRTManifest(runtime: WorkspaceRuntime, mode: SyncMode): SyncFileStatus {
  const dir = artifactDir(runtime)
  const file = path.join(dir, wsrtManifestName(runtime))
  const current = readJsonFile(file) ?? {}
  const next = {
    schema: 'wsrt.manifest.v1',
    root: runtime.state.root,
    generatedAt: current.generatedAt ?? new Date(0).toISOString(),
    projects: runtime.state.projects.map((project) => ({
      name: project.name,
      root: project.root,
      adapter: project.adapter,
    })),
    packages: runtime.state.packages.map((pkg) => ({
      name: pkg.name,
      root: pkg.root,
      version: pkg.version,
      private: pkg.private,
    })),
  }
  return driftStatus(runtime, file, 'wsrt', current, next, mode)
}

function driftStatus(
  runtime: WorkspaceRuntime,
  file: string,
  target: string,
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  mode: SyncMode,
): SyncFileStatus {
  if (stableJson(current) === stableJson(next))
    return { file, target, status: 'synced', diagnostics: [] }
  if (mode === 'write') {
    const value = target === 'wsrt' ? { ...next, generatedAt: new Date().toISOString() } : next
    writeJsonFile(file, value)
    return {
      file,
      target,
      status: 'written',
      message: `${target} manifest updated`,
      diagnostics: [],
    }
  }
  runtime.diagnostics.add(
    warning('manifest.drift', `Manifest drift detected: ${file}`, {
      source: file,
      detail: { target },
    }),
  )
  return {
    file,
    target,
    status: 'drifted',
    message: `${target} manifest differs from WSRT runtime metadata`,
    diagnostics: [],
  }
}

function missing(runtime: WorkspaceRuntime, file: string, target: string): SyncFileStatus {
  runtime.diagnostics.add(
    warning('manifest.missing', `Manifest not found: ${file}`, {
      source: file,
      detail: { target },
    }),
  )
  return { file, target, status: 'missing', message: 'manifest not found', diagnostics: [] }
}

function artifactDir(runtime: WorkspaceRuntime): string {
  return path.resolve(runtime.state.root, runtime.config.get('artifacts')?.dir ?? '.wsrt')
}

function extensionManifestNames(runtime: WorkspaceRuntime): string[] {
  const names = runtime.config
    .get('manifests')
    ?.manifestNames?.filter((name) => name.trim().length > 0)
  return names?.length ? names : ['wsrt.manifest.json']
}

function wsrtManifestName(runtime: WorkspaceRuntime): string {
  return runtime.config.get('manifests')?.wsrtManifestName ?? 'wsrt.manifest.json'
}
