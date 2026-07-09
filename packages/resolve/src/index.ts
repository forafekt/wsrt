import fs from 'node:fs'
import path from 'node:path'
import type { ResolutionResult, WorkspacePackage } from '@wsrt/types'

const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.json', '.css']
const entryNames = ['index', 'main', 'mod']

export function buildAliasMap(
  root: string,
  packages: WorkspacePackage[],
  extraAliases: Record<string, string> = {},
): Record<string, string> {
  const aliases: Record<string, string> = {}
  for (const pkg of packages) {
    const entry = pkg.sourceEntry ?? resolvePackageEntry(pkg.root, pkg.exports)
    if (entry) aliases[pkg.name] = entry
    for (const [subpath, resolved] of Object.entries(pkg.resolvedExports)) {
      if (subpath === '.') continue
      aliases[`${pkg.name}/${subpath.replace(/^\.\//, '')}`] = resolved
    }
  }
  for (const [specifier, target] of Object.entries(extraAliases)) {
    aliases[specifier] = path.resolve(root, target)
  }
  return aliases
}

export function resolveSpecifier(
  specifier: string,
  aliases: Record<string, string>,
  packages: WorkspacePackage[],
): ResolutionResult {
  const pkg = packages.find(
    (item) => item.name === specifier || specifier.startsWith(`${item.name}/`),
  )
  const exactAlias = aliases[specifier]
  if (exactAlias && (!pkg || !isPackageGeneratedAlias(specifier, exactAlias, pkg))) {
    const resolved = resolveFileLike(exactAlias)
    return { specifier, resolved: resolved ?? exactAlias, source: 'alias' }
  }

  if (pkg) {
    const subpath = specifier === pkg.name ? '.' : `./${specifier.slice(pkg.name.length + 1)}`
    const resolvedExport = resolvePackageExport(pkg.root, pkg.exports, subpath)
    if (resolvedExport) {
      return {
        specifier,
        resolved: resolvedExport,
        source: 'export',
        packageName: pkg.name,
      }
    }
    const resolvedSubpath = resolvePackageSubpath(pkg.root, subpath)
    if (resolvedSubpath) {
      return {
        specifier,
        resolved: resolvedSubpath,
        source: 'package',
        packageName: pkg.name,
      }
    }
    return {
      specifier,
      resolved: path.join(pkg.root, specifier.slice(pkg.name.length + 1)),
      source: 'package',
      packageName: pkg.name,
    }
  }

  const aliasPrefix = Object.keys(aliases)
    .filter((alias) => specifier.startsWith(`${alias}/`))
    .sort((a, b) => b.length - a.length)[0]
  if (!aliasPrefix) return { specifier, source: 'unresolved' }
  const aliasTarget = path.join(aliases[aliasPrefix], specifier.slice(aliasPrefix.length + 1))
  return {
    specifier,
    resolved: resolveFileLike(aliasTarget) ?? aliasTarget,
    source: 'alias',
  }
}

function isPackageGeneratedAlias(specifier: string, alias: string, pkg: WorkspacePackage): boolean {
  if (specifier === pkg.name) return alias === pkg.sourceEntry
  const subpath = `./${specifier.slice(pkg.name.length + 1)}`
  return alias === pkg.resolvedExports[subpath] || alias === pkg.resolvedExports[subpath.replace(/^\.\//, '')]
}

export function resolvePackageEntry(root: string, exports: Record<string, string> = {}): string | undefined {
  return (
    resolvePackageExport(root, exports, '.') ??
    firstExisting([
      path.join(root, 'src/index.ts'),
      path.join(root, 'src/index.tsx'),
      path.join(root, 'src/index.js'),
      path.join(root, 'src/index.vue'),
      path.join(root, 'index.ts'),
      path.join(root, 'index.tsx'),
      path.join(root, 'index.js'),
      path.join(root, 'index.vue'),
      path.join(root, 'src/mod.ts'),
      path.join(root, 'src/mod.js'),
      path.join(root, 'mod.ts'),
      path.join(root, 'mod.js'),
    ])
  )
}

export function resolvePackageExport(
  root: string,
  exports: Record<string, string>,
  subpath: string,
): string | undefined {
  const normalized = subpath === '' ? '.' : subpath
  const exported = exports[normalized] ?? exports[normalized.replace(/^\.\//, '')]
  if (!exported) return undefined
  return resolveSourceFirstTarget(root, exported)
}

export function resolvePackageSubpath(root: string, subpath: string): string | undefined {
  const cleanSubpath = subpath.replace(/^\.\//, '')
  if (!cleanSubpath || cleanSubpath === '.') return resolvePackageEntry(root)
  return resolveFileLike(path.join(root, 'src', cleanSubpath)) ?? resolveFileLike(path.join(root, cleanSubpath))
}

export function resolveFileLike(candidate: string): string | undefined {
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  const extension = path.extname(candidate)
  if (!extension) {
    for (const sourceExtension of sourceExtensions) {
      const file = `${candidate}${sourceExtension}`
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file
    }
  }
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    for (const entryName of entryNames) {
      for (const sourceExtension of sourceExtensions) {
        const file = path.join(candidate, `${entryName}${sourceExtension}`)
        if (fs.existsSync(file) && fs.statSync(file).isFile()) return file
      }
    }
  }
  return undefined
}

function resolveSourceFirstTarget(root: string, target: string): string | undefined {
  const absoluteTarget = path.resolve(root, target)
  const sourceCandidates = sourceFirstCandidates(root, target)
  return firstExisting(sourceCandidates) ?? resolveFileLike(absoluteTarget)
}

function sourceFirstCandidates(root: string, target: string): string[] {
  const withoutPrefix = target.replace(/^\.\//, '')
  const candidates: string[] = []
  if (withoutPrefix.startsWith('dist/')) {
    const sourceRelative = withoutPrefix.replace(/^dist\//, 'src/')
    candidates.push(...withSourceExtensions(path.resolve(root, sourceRelative)))
    if (sourceRelative.endsWith('/index.js') || sourceRelative.endsWith('/index.mjs')) {
      candidates.push(...withSourceExtensions(path.resolve(root, sourceRelative.replace(/\/index\.[cm]?js$/, ''))))
    }
    if (sourceRelative.endsWith('.css')) {
      const cssBase = sourceRelative.replace(/\.css$/, '')
      candidates.push(path.resolve(root, `${cssBase}/index.css`))
      candidates.push(path.resolve(root, `${cssBase}.css`))
    }
  }
  if (withoutPrefix.startsWith('src/')) candidates.push(...withSourceExtensions(path.resolve(root, withoutPrefix)))
  return candidates
}

function withSourceExtensions(candidate: string): string[] {
  const extension = path.extname(candidate)
  if (!extension) return sourceExtensions.map((sourceExtension) => `${candidate}${sourceExtension}`)
  const withoutExtension = candidate.slice(0, -extension.length)
  return [candidate, ...sourceExtensions.map((sourceExtension) => `${withoutExtension}${sourceExtension}`)]
}

function firstExisting(files: string[]): string | undefined {
  return files.find((file) => fs.existsSync(file) && fs.statSync(file).isFile())
}
