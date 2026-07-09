import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transform } from 'esbuild'
import { error } from '@wsrt/diagnostics'
import type {
  WsrtModuleReference,
  WsrtModuleReferenceContext,
  WsrtPluginMetadata,
} from '@wsrt/types'

const executableConfigKeys = new Set([
  'plugins',
  'adapters',
  'tasks',
  'services',
  'actions',
  'hooks',
  'generators',
  'validators',
])

export async function resolveWsrtModuleReference<T = unknown>(
  reference: WsrtModuleReference,
  context: WsrtModuleReferenceContext,
): Promise<T | undefined> {
  const descriptor = normalizeModuleReference(reference)
  const expectedExport = descriptor.exportName ?? 'default'
  let resolved: ResolvedModuleReference | undefined

  try {
    if (descriptor.path) {
      resolved = resolvePathReference(descriptor.path, context.baseDir)
    } else if (descriptor.package) {
      resolved = resolvePackageReference(descriptor.package, context.baseDir)
    } else if (descriptor.url) {
      resolved = resolveUrlReference(descriptor.url, context)
    } else {
      throw new Error('Expected a path, package, or url reference')
    }

    const imported = await importReferencedModule(resolved.specifier)
    const value = selectExport(imported, descriptor.exportName)
    return attachReferenceMetadata(
      applyReferenceOptions(value, descriptor.options),
      resolved.metadata,
    ) as T
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    context.diagnostics.push(
      error(
        'config.module_reference_failed',
        `Could not load ${context.field} module reference from ${context.source}: ${formatModuleReference(reference)} (${message})`,
        {
          source: context.source,
          detail: {
            field: context.field,
            reference,
            attempted: descriptor.path ? 'path' : descriptor.package ? 'package' : descriptor.url ? 'url' : undefined,
            attemptedValue: descriptor.path ?? descriptor.package ?? descriptor.url,
            specifier: resolved?.specifier,
            metadataFound: Boolean(resolved?.metadata),
            expectedExport,
            error: message,
          },
        },
      ),
    )
    return undefined
  }
}

export async function resolveConfigModuleReferences<T extends Record<string, unknown>>(
  config: T,
  context: Omit<WsrtModuleReferenceContext, 'field'>,
): Promise<T> {
  const resolved: Record<string, unknown> = { ...config }

  for (const field of executableConfigKeys) {
    if (!(field in resolved)) continue
    resolved[field] = await resolveReferenceField(resolved[field], {
      ...context,
      field,
    })
  }

  return resolved as T
}

export function isWsrtModuleReference(value: unknown): value is WsrtModuleReference {
  if (typeof value === 'string') return true
  if (!isRecord(value)) return false
  return typeof value.path === 'string' || typeof value.package === 'string' || typeof value.url === 'string'
}

async function resolveReferenceField(
  value: unknown,
  context: WsrtModuleReferenceContext,
): Promise<unknown> {
  if (Array.isArray(value)) {
    const resolved = await Promise.all(
      value.map((item) => resolveReferenceFieldItem(item, context)),
    )
    return resolved.filter((item) => item !== undefined)
  }

  return resolveReferenceFieldItem(value, context)
}

async function resolveReferenceFieldItem(
  value: unknown,
  context: WsrtModuleReferenceContext,
): Promise<unknown> {
  if (isWsrtModuleReference(value)) return resolveWsrtModuleReference(value, context)
  return value
}

function normalizeModuleReference(reference: WsrtModuleReference): {
  path?: string
  package?: string
  url?: string
  exportName?: string
  options?: Record<string, unknown>
} {
  if (typeof reference === 'string') {
    if (isUrlLike(reference)) return { url: reference }
    return isPathLike(reference) ? { path: reference } : { package: reference }
  }

  return {
    path: reference.path,
    package: reference.package,
    url: reference.url,
    exportName: reference.export,
    options: reference.options,
  }
}

type ResolvedModuleReference = {
  specifier: string
  metadata?: WsrtPluginMetadata
}

type PackageJson = Record<string, unknown> & {
  name?: string
  version?: string
  description?: string
  homepage?: string
  repository?: unknown
  main?: string
  module?: string
  exports?: unknown
  wsrt?: unknown
}

function resolvePathReference(specifier: string, baseDir: string): ResolvedModuleReference {
  const filePath = specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath)
  if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
    return resolveDirectoryEntry(absolute)
  }
  if (fs.existsSync(absolute)) return { specifier: absolute }

  for (const extension of ['.ts', '.mts', '.cts', '.mjs', '.js', '.cjs', '.json']) {
    const candidate = `${absolute}${extension}`
    if (fs.existsSync(candidate)) return { specifier: candidate }
  }

  throw new Error(`Module path not found: ${absolute}`)
}

function resolveDirectoryEntry(directory: string): ResolvedModuleReference {
  const packageJson = readPackageJson(path.join(directory, 'package.json'))
  if (packageJson) {
    const entry = resolvePackageJsonEntry(packageJson, directory)
    if (entry) return { specifier: entry, metadata: packageMetadata(packageJson) }
  }

  for (const file of ['index.ts', 'index.mts', 'index.cts', 'index.mjs', 'index.js', 'index.cjs']) {
    const candidate = path.join(directory, file)
    if (fs.existsSync(candidate)) return { specifier: candidate, metadata: packageJson ? packageMetadata(packageJson) : undefined }
  }
  throw new Error(`Module directory has no supported index file: ${directory}`)
}

function resolvePackageReference(specifier: string, baseDir: string): ResolvedModuleReference {
  const require = createRequire(path.join(baseDir, 'wsrt.config.js'))
  const packageJsonFile = findPackageJsonForPackageName(specifier, baseDir)
  const packageJson = packageJsonFile ? readPackageJson(packageJsonFile) : undefined
  if (packageJson && packageJsonFile) {
    const packageRoot = path.dirname(packageJsonFile)
    const entry = resolvePackageJsonEntry(packageJson, packageRoot)
    if (entry) return { specifier: entry, metadata: packageMetadata(packageJson) }
  }

  const resolved = require.resolve(specifier)
  const resolvedPackageJsonFile = findPackageJsonForModule(resolved)
  const resolvedPackageJson = resolvedPackageJsonFile ? readPackageJson(resolvedPackageJsonFile) : undefined
  if (resolvedPackageJson && resolvedPackageJsonFile) {
    const packageRoot = path.dirname(resolvedPackageJsonFile)
    const entry = resolvePackageJsonEntry(resolvedPackageJson, packageRoot)
    return { specifier: entry ?? resolved, metadata: packageMetadata(resolvedPackageJson) }
  }
  return { specifier: resolved }
}

function resolveUrlReference(specifier: string, context: WsrtModuleReferenceContext): ResolvedModuleReference {
  const cacheDir = path.join(context.baseDir, '.wsrt/cache/remote-modules')
  throw new Error(
    `Remote module references are not enabled yet for ${specifier}. Download and cache support should use ${cacheDir}; install the module locally or use a path/package reference for now.`,
  )
}

async function importReferencedModule(file: string): Promise<unknown> {
  if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'))
  if (file.endsWith('.cjs')) {
    const require = createRequire(import.meta.url)
    return require(file)
  }
  if (file.endsWith('.ts') || file.endsWith('.mts') || file.endsWith('.cts')) {
    return importTypeScriptModule(file)
  }
  return import(pathToFileURL(file).href)
}

async function importTypeScriptModule(file: string): Promise<unknown> {
  const source = fs.readFileSync(file, 'utf8')
  const transformed = await transform(source, {
    sourcefile: file,
    loader: 'ts',
    format: file.endsWith('.cts') ? 'cjs' : 'esm',
    target: 'node20',
    platform: 'node',
    sourcemap: false,
  })
  const tempFile = path.join(
    path.dirname(file),
    `.wsrt-reference-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}${file.endsWith('.cts') ? '.cjs' : '.mjs'}`,
  )
  fs.writeFileSync(tempFile, transformed.code)

  try {
    if (file.endsWith('.cts')) {
      const require = createRequire(import.meta.url)
      return require(tempFile)
    }
    return import(`${pathToFileURL(tempFile).href}?t=${Date.now()}`)
  } finally {
    delayedRemove(tempFile)
  }
}

function delayedRemove(file: string): void {
  const timer = setTimeout(() => fs.rmSync(file, { force: true }), 1000)
  timer.unref?.()
}

function selectExport(imported: unknown, exportName?: string): unknown {
  if (exportName) {
    if (isRecord(imported) && exportName in imported) return imported[exportName]
    throw new Error(`Expected export "${exportName}" was not found`)
  }

  return isRecord(imported) && 'default' in imported ? imported.default : imported
}

function applyReferenceOptions(value: unknown, options: Record<string, unknown> | undefined): unknown {
  if (!options || typeof value !== 'function') return value
  return value(options)
}

function attachReferenceMetadata(value: unknown, metadata: WsrtPluginMetadata | undefined): unknown {
  if (!metadata || !isRecord(value)) return value
  const current = isRecord(value.metadata) ? value.metadata : {}
  Object.defineProperty(value, 'metadata', {
    value: { ...metadata, ...current, name: String(current.name ?? metadata.name ?? value.name) },
    enumerable: true,
    configurable: true,
    writable: true,
  })
  return value
}

function resolvePackageJsonEntry(packageJson: PackageJson, packageRoot: string): string | undefined {
  const wsrt = isRecord(packageJson.wsrt) ? packageJson.wsrt : undefined
  const wsrtEntry = typeof wsrt?.entry === 'string' ? wsrt.entry : undefined
  for (const entry of [
    wsrtEntry,
    exportEntry(packageJson.exports),
    typeof packageJson.module === 'string' ? packageJson.module : undefined,
    typeof packageJson.main === 'string' ? packageJson.main : undefined,
  ]) {
    if (!entry) continue
    const resolved = resolvePackageEntryFile(packageRoot, entry)
    if (resolved) return resolved
  }
  return undefined
}

function exportEntry(exportsField: unknown): string | undefined {
  if (typeof exportsField === 'string') return exportsField
  if (!isRecord(exportsField)) return undefined
  const rootExport = exportsField['.'] ?? exportsField
  if (typeof rootExport === 'string') return rootExport
  if (!isRecord(rootExport)) return undefined
  for (const key of ['import', 'default', 'module', 'require']) {
    const value = rootExport[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function resolvePackageEntryFile(packageRoot: string, entry: string): string | undefined {
  const absolute = path.resolve(packageRoot, entry)
  if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return absolute
  if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
    try {
      return resolveDirectoryEntry(absolute).specifier
    } catch {
      return undefined
    }
  }
  for (const extension of ['.ts', '.mts', '.cts', '.mjs', '.js', '.cjs', '.json']) {
    const candidate = `${absolute}${extension}`
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

function readPackageJson(file: string): PackageJson | undefined {
  try {
    if (!fs.existsSync(file)) return undefined
    return JSON.parse(fs.readFileSync(file, 'utf8')) as PackageJson
  } catch {
    return undefined
  }
}

function findPackageJsonForModule(moduleFile: string): string | undefined {
  let current = path.dirname(moduleFile)
  while (current !== path.dirname(current)) {
    const candidate = path.join(current, 'package.json')
    if (fs.existsSync(candidate)) return candidate
    if (path.basename(current) === 'node_modules') return undefined
    current = path.dirname(current)
  }
  return undefined
}

function findPackageJsonForPackageName(specifier: string, baseDir: string): string | undefined {
  let current = baseDir
  const parts = specifier.startsWith('@') ? specifier.split('/').slice(0, 2) : [specifier.split('/')[0]]
  const packagePath = path.join(...parts)
  while (current !== path.dirname(current)) {
    const candidate = path.join(current, 'node_modules', packagePath, 'package.json')
    if (fs.existsSync(candidate)) return candidate
    current = path.dirname(current)
  }
  return undefined
}

function packageMetadata(packageJson: PackageJson): WsrtPluginMetadata | undefined {
  const wsrt = isRecord(packageJson.wsrt) ? packageJson.wsrt : undefined
  const name = typeof wsrt?.name === 'string'
    ? wsrt.name
    : typeof packageJson.name === 'string'
      ? packageJson.name
      : undefined
  if (!name) return undefined
  const repository = typeof packageJson.repository === 'string'
    ? packageJson.repository
    : isRecord(packageJson.repository) && typeof packageJson.repository.url === 'string'
      ? packageJson.repository.url
      : undefined
  return {
    name,
    version: typeof packageJson.version === 'string' ? packageJson.version : undefined,
    description: typeof packageJson.description === 'string' ? packageJson.description : undefined,
    homepage: typeof packageJson.homepage === 'string' ? packageJson.homepage : undefined,
    repository,
    capabilities: Array.isArray(wsrt?.capabilities)
      ? wsrt.capabilities.filter((value): value is string => typeof value === 'string')
      : undefined,
  }
}

function isPathLike(value: string): boolean {
  return value.startsWith('.') || value.startsWith('/') || value.startsWith('file:')
}

function isUrlLike(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

function formatModuleReference(reference: WsrtModuleReference): string {
  if (typeof reference === 'string') return reference
  return reference.path ?? reference.package ?? reference.url ?? '<invalid reference>'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
