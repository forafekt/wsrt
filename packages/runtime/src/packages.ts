import fs from 'node:fs'
import path from 'node:path'
import { warning } from '@wsrt/diagnostics'
import type { WsrtConfig, WsrtDiagnostic, WorkspacePackage } from '@wsrt/types'
import { resolvePackageEntry, resolvePackageExport } from '@wsrt/resolve'

export function discoverWorkspacePackages(
  root: string,
  config: WsrtConfig,
  diagnostics: WsrtDiagnostic[],
): WorkspacePackage[] {
  const patterns = config.workspace?.packages ?? ['packages/*']
  const packageDirs = new Set<string>()
  for (const pattern of patterns) {
    for (const dir of expandPackagePattern(root, pattern)) packageDirs.add(dir)
  }
  const packages: WorkspacePackage[] = []
  for (const dir of [...packageDirs].sort()) {
    const packageJson = path.join(dir, 'package.json')
    if (!fs.existsSync(packageJson)) continue
    try {
      const manifest = JSON.parse(fs.readFileSync(packageJson, 'utf8')) as Record<string, unknown>
      if (typeof manifest.name !== 'string') {
        diagnostics.push(warning('package.invalid', `Package manifest has no name: ${packageJson}`, { source: packageJson }))
        continue
      }
      const exports = exportMap(manifest)
      const sourceEntry = resolvePackageEntry(dir, exports)
      const resolvedExports = Object.fromEntries(
        Object.keys(exports)
          .map((subpath) => [subpath, resolvePackageExport(dir, exports, subpath)] as const)
          .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string'),
      )
      packages.push({
        name: manifest.name,
        root: dir,
        packageJson,
        sourceEntry,
        version: typeof manifest.version === 'string' ? manifest.version : undefined,
        private: typeof manifest.private === 'boolean' ? manifest.private : undefined,
        dependencies: dependencyNames(manifest),
        exports,
        resolvedExports,
        metadata: metadataForPackage(manifest.name, config),
      })
      diagnostics.push({
        level: 'info',
        code: 'package.discovered',
        message: `Discovered workspace package ${manifest.name}`,
        source: packageJson,
        detail: {
          name: manifest.name,
          root: dir,
          packageJson,
          sourceEntry,
          exports,
          resolvedExports,
        },
      })
    } catch (cause) {
      diagnostics.push(warning('package.invalid_json', `Could not read ${packageJson}: ${cause instanceof Error ? cause.message : String(cause)}`, { source: packageJson }))
    }
  }
  diagnostics.push({ level: 'info', code: 'packages.discovered', message: `Discovered ${packages.length} workspace packages` })
  return packages
}

function expandPackagePattern(root: string, pattern: string): string[] {
  const normalized = path.resolve(root, pattern)
  if (!pattern.includes('*')) return [normalized]
  const beforeStar = normalized.slice(0, normalized.indexOf('*'))
  const base = beforeStar.endsWith(path.sep) ? beforeStar.slice(0, -1) : path.dirname(beforeStar)
  if (!fs.existsSync(base)) return []
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const candidate = path.join(base, entry.name)
      return fs.existsSync(path.join(candidate, 'package.json')) ? [candidate] : nestedPackageDirs(candidate)
    })
}

function nestedPackageDirs(dir: string): string[] {
  const packageJson = path.join(dir, 'package.json')
  if (fs.existsSync(packageJson)) return [dir]
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => nestedPackageDirs(path.join(dir, entry.name)))
}

function dependencyNames(manifest: Record<string, unknown>): string[] {
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .flatMap((key) => Object.keys(asRecord(manifest[key])))
}

function exportMap(manifest: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  const exportsField = manifest.exports
  if (typeof exportsField === 'string') result['.'] = exportsField
  if (exportsField && typeof exportsField === 'object' && !Array.isArray(exportsField)) {
    for (const [key, value] of Object.entries(exportsField)) {
      const target = exportTarget(value)
      if (target) result[key] = target
    }
  }
  const main = typeof manifest.main === 'string' ? manifest.main : undefined
  if (!result['.'] && main) result['.'] = main
  return result
}

function exportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    return exportTarget(record.import ?? record.default ?? record.types)
  }
  return undefined
}

function metadataForPackage(name: string, config: WsrtConfig): Record<string, unknown> {
  return {
    ...(config.packageDefaults ?? {}),
    ...(config.packageConfigOverrides?.[name] ?? {}),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
