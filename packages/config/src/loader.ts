import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { transform } from 'esbuild'
import { parse as parseYaml } from 'yaml'
import { error, info } from '@wsrt/diagnostics'
import type {
  ConfigSource,
  LoadedWsrtConfig,
  WsrtConfig,
  WsrtDiagnostic,
} from '@wsrt/types'
import { mergeWsrtConfig } from './merge.js'
import { resolveWsrtConfig } from './resolver.js'
import { normalizeSystemDefinition, type NormalizedSystemDefinition, type SystemDiagnostic, type WorkspaceDefinitionInput } from './system.js'

const configNames = [
  'wsrt.config.ts',
  'wsrt.config.mts',
  'wsrt.config.cts',
  'wsrt.config.js',
  'wsrt.config.mjs',
  'wsrt.config.cjs',
  'wsrt.json',
  'wsrt.jsonc',
  'wsrt.yaml',
  'wsrt.yml',
]

export async function loadWsrtConfig(
  root = process.cwd(),
  explicitFile?: string,
): Promise<LoadedWsrtConfig> {
  const absoluteRoot = path.resolve(root)
  const diagnostics: WsrtDiagnostic[] = []
  const sources: ConfigSource[] = []
  const stack: string[] = []
  const configFile = discoverConfigFile(absoluteRoot, explicitFile)

  if (!configFile) {
    diagnostics.push(
      info('config.not_found', 'No root wsrt config file found', {
        source: absoluteRoot,
      }),
    )

    return {
      root: absoluteRoot,
      config: {},
      sources,
      diagnostics,
    }
  }

  const loadedConfig = await loadConfigRecursive(
    configFile,
    absoluteRoot,
    diagnostics,
    sources,
    stack,
    'root',
  )
  const config = await resolveWsrtConfig(loadedConfig as Record<string, unknown>, {
    source: configFile,
    baseDir: path.dirname(configFile),
    root: absoluteRoot,
    diagnostics,
  }) as WsrtConfig

  diagnostics.push(
    info('config.loaded', `Loaded root config ${configFile}`, {
      source: configFile,
    }),
  )

  return {
    root: absoluteRoot,
    configFile,
    config,
    sources,
    diagnostics,
  }
}

export async function loadSystemDefinition(root=process.cwd(),explicitFile?:string):Promise<{definition?:NormalizedSystemDefinition;diagnostics:SystemDiagnostic[];file?:string}>{
  const absoluteRoot=path.resolve(root),file=discoverConfigFile(absoluteRoot,explicitFile)
  if(!file)return{diagnostics:[{code:'config.not_found',severity:'error',message:'No WSRT configuration file found',source:{file:absoluteRoot,path:''}}]}
  try{const input=normalizeConfig(await importConfigFile(file)) as unknown as WorkspaceDefinitionInput;const result=normalizeSystemDefinition(input,{root:absoluteRoot,file});return{...result,file}}
  catch(cause){return{file,diagnostics:[{code:'config.invalid',severity:'error',message:cause instanceof Error?cause.message:String(cause),source:{file,path:''}}]}}
}

export function discoverConfigFile(root: string, explicitFile?: string): string | undefined {
  if (explicitFile) {
    const file = path.resolve(root, explicitFile)
    return fs.existsSync(file) ? file : undefined
  }

  for (const name of configNames) {
    const file = path.join(root, name)
    if (fs.existsSync(file)) return file
  }

  return undefined
}

async function loadConfigRecursive(
  file: string,
  root: string,
  diagnostics: WsrtDiagnostic[],
  sources: ConfigSource[],
  stack: string[],
  kind: ConfigSource['kind'],
): Promise<WsrtConfig> {
  const normalized = path.resolve(file)

  if (stack.includes(normalized)) {
    diagnostics.push(
      error(
        'config.circular_extends',
        `Circular config extends detected: ${[...stack, normalized].join(' -> ')}`,
        { source: normalized },
      ),
    )

    return {}
  }

  stack.push(normalized)

  const loaded = await loadSingleConfig(normalized, diagnostics)

  sources.push({
    file: normalized,
    kind,
  })

  let merged: WsrtConfig = {}

  for (const item of toArray(loaded.extends)) {
    const extendedFile = resolveExtendedConfig(normalized, item)

    if (!fs.existsSync(extendedFile)) {
      diagnostics.push(
        error('config.extends_missing', `Extended config not found: ${extendedFile}`, {
          source: normalized,
        }),
      )

      continue
    }

    const extended = await loadConfigRecursive(
      extendedFile,
      root,
      diagnostics,
      sources,
      stack,
      'extends',
    )

    merged = mergeWsrtConfig(merged, extended)
  }

  stack.pop()

  return mergeWsrtConfig(merged, await normalizePluginsConfig(loaded))
}

async function loadSingleConfig(
  file: string,
  diagnostics: WsrtDiagnostic[],
): Promise<WsrtConfig> {
  try {
    const config = await importConfigFile(file)
    return normalizeConfig(config)
  } catch (cause) {
    diagnostics.push(
      error(
        'config.invalid',
        `Could not load config ${file}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { source: file },
      ),
    )

    return {}
  }
}

async function importConfigFile(file: string): Promise<unknown> {
  if (file.endsWith('.json')) {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }

  if (file.endsWith('.jsonc')) {
    return JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8')))
  }

  if (file.endsWith('.yaml') || file.endsWith('.yml')) {
    return parseYaml(fs.readFileSync(file, 'utf8')) ?? {}
  }

  if (file.endsWith('.cjs')) {
    const require = createRequire(import.meta.url)
    return require(file)
  }

  if (file.endsWith('.ts') || file.endsWith('.mts') || file.endsWith('.cts')) {
    return importTypeScriptConfig(file)
  }

  const imported = await import(pathToFileURL(file).href)
  return imported.default ?? imported
}

async function importTypeScriptConfig(file: string): Promise<unknown> {
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
    `.wsrt-loader-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}${file.endsWith('.cts') ? '.cjs' : '.mjs'}`,
  )

  fs.writeFileSync(tempFile, transformed.code)

  try {
    if (file.endsWith('.cts')) {
      const require = createRequire(import.meta.url)
      return require(tempFile)
    }

    const imported = await import(`${pathToFileURL(tempFile).href}?t=${Date.now()}`)
    return imported.default ?? imported
  } finally {
    fs.rmSync(tempFile, { force: true })
  }
}

function normalizeConfig(value: unknown): WsrtConfig {
  if (typeof value === 'function') {
    return normalizeConfig(value({ command: 'serve', mode: 'development' }))
  }

  return value && typeof value === 'object' && !Array.isArray(value) ? (value as WsrtConfig) : {}
}

function resolveExtendedConfig(declaringFile: string, extended: string): string {
  return path.resolve(path.dirname(declaringFile), extended)
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function stripJsonComments(source: string): string {
  let output = ''
  let inString = false
  let quote = ''

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]
    const next = source[index + 1]
    const previous = source[index - 1]

    if (inString) {
      output += current

      if (current === quote && previous !== '\\') {
        inString = false
        quote = ''
      }

      continue
    }

    if (current === '"' || current === "'") {
      inString = true
      quote = current
      output += current
      continue
    }

    if (current === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      output += '\n'
      continue
    }

    if (current === '/' && next === '*') {
      index += 2

      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') output += '\n'
        index += 1
      }

      index += 1
      continue
    }

    output += current
  }

  return output
}
async function normalizePluginsConfig(config: WsrtConfig): Promise<WsrtConfig> {
  const plugins = config.plugins ?? []
  for (let index = 0; index < plugins.length; index += 1) {
    const plugin = plugins[index]
    const isRemoteHttp = typeof plugin === 'string' && (plugin.startsWith('http://') || plugin.startsWith('https://'))
    const isWsrt = typeof plugin === 'string' && plugin.startsWith('wsrt:') && !isRemoteHttp 
    const isModule = typeof plugin === 'string' && !isRemoteHttp && !isWsrt

    if (isWsrt) {
      const pluginNameQuery = plugin.slice('wsrt:'.length)
      const pluginName = plugin.split('?')[0].slice('wsrt:'.length).trim();
      plugins[index] = await import(`@wsrt/${pluginName}`).catch(() => {
        throw new Error(`Plugin not found: ${pluginName}. Please try installing '${pluginName}'`)
      }).then((plugin) => {
        if (typeof plugin?.default !== 'function') {
          throw new Error('Plugin must export default a function')
        }
        return plugin.default(parseOptionsFromQueryString(pluginNameQuery))
      })
    }

    if (isModule) {
      const pluginNameQuery = plugin
       const pluginName = plugin.split('?')[0].trim();
      plugins[index] = await import(pluginName).catch(() => {
        throw new Error(`Plugin not found: ${pluginName}. Please try installing '${pluginName}'`)
      }).then((plugin) => {
        if (typeof plugin?.default !== 'function') {
          throw new Error('Plugin must export default a function')
        }
        return plugin.default(parseOptionsFromQueryString(pluginNameQuery))
      })
    }
  }
  return config
}

function parseOptionsFromQueryString(search: string) {
  const options: Record<string, any> = {}
  const url = new URL(search, 'http://localhost')
  for (const [key, value] of url.searchParams) {
    options[key] = value
  }
  return options
}
