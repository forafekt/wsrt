import path from 'node:path'
import { error } from '@wsrt/diagnostics'
import type { WsrtConfig, WsrtDiagnostic } from '@wsrt/types'
import { mergeWsrtConfig } from './merge.js'
import { resolveConfigModuleReferences } from './module-reference.js'

export type WsrtConfigResolverContext = {
  source: string
  baseDir: string
  root?: string
  diagnostics: WsrtDiagnostic[]
  env?: NodeJS.ProcessEnv
}

type ConfigScope = {
  root: string
  environment: string
  profile: string
}

const interpolationPattern = /\$\{([^}]+)\}/g

export async function resolveWsrtConfig<T extends Record<string, unknown>>(
  config: T,
  context: WsrtConfigResolverContext,
): Promise<T> {
  const scopedConfig = applyProfileOverrides(config as WsrtConfig, context)
  const scope = createConfigScope(scopedConfig, context)
  const interpolated = resolveConfigValues(scopedConfig, {
    ...context,
    root: scope.root,
    env: context.env ?? process.env,
    scope,
  })

  return resolveConfigModuleReferences(interpolated as Record<string, unknown>, {
    source: context.source,
    baseDir: context.baseDir,
    diagnostics: context.diagnostics,
  }) as Promise<T>
}

export function resolveConfigValues<T>(
  value: T,
  context: WsrtConfigResolverContext & { root?: string; scope?: ConfigScope },
): T {
  const scope = context.scope ?? createConfigScope(value as WsrtConfig, context)
  let resolved: unknown = value
  for (let pass = 0; pass < 3; pass += 1) {
    const next = resolveValue(resolved, {
      ...context,
      root: scope.root,
      env: context.env ?? process.env,
      scope,
      config: resolved,
    }, [])
    if (JSON.stringify(next) === JSON.stringify(resolved)) return next as T
    resolved = next
  }
  return resolved as T
}

function applyProfileOverrides(
  config: WsrtConfig,
  context: WsrtConfigResolverContext,
): WsrtConfig {
  const scope = createConfigScope(config, context)
  let resolved = config
  const environmentOverrides = profileOverride(config, 'environments', scope.environment)
  if (environmentOverrides) resolved = mergeWsrtConfig(resolved, environmentOverrides)
  const profileScope = createConfigScope(resolved, context)
  const profileOverrides = profileOverride(resolved, 'profiles', profileScope.profile)
  if (profileOverrides) resolved = mergeWsrtConfig(resolved, profileOverrides)
  return resolved
}

function profileOverride(
  config: WsrtConfig,
  key: 'environments' | 'profiles',
  name: string,
): WsrtConfig | undefined {
  const overrides = (config as Record<string, unknown>)[key]
  if (!isRecord(overrides)) return undefined
  const override = overrides[name]
  return isRecord(override) ? (override as WsrtConfig) : undefined
}

function createConfigScope(
  config: WsrtConfig,
  context: Pick<WsrtConfigResolverContext, 'root' | 'baseDir' | 'env'>,
): ConfigScope {
  const env = context.env ?? process.env
  const environment = String(
    resolveScopeValue(config.runtime?.environment, env) ??
    (env.NODE_ENV === 'production' ? 'production' : 'development')
  )
  return {
    root: context.root ? path.resolve(context.root) : context.baseDir,
    environment,
    profile: String(resolveScopeValue(config.runtime?.profile, env) ?? env.WSRT_PROFILE ?? 'default'),
  }
}

function resolveScopeValue(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value !== 'string') return value
  const fullMatch = value.match(/^\$\{([^}]+)\}$/)
  if (!fullMatch) return value
  const expression = fullMatch[1].trim()
  if (expression.startsWith('env.')) return env[expression.slice(4)]
  return value
}

function resolveValue(
  value: unknown,
  context: WsrtConfigResolverContext & {
    root: string
    env: NodeJS.ProcessEnv
    scope: ConfigScope
    config: unknown
  },
  pathSegments: string[],
): unknown {
  if (typeof value === 'string') return resolveString(value, context, pathSegments)
  if (Array.isArray(value)) {
    return value.map((item, index) => resolveValue(item, context, [...pathSegments, String(index)]))
  }
  if (!isRecord(value)) return value

  const resolved: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    resolved[key] = resolveValue(item, context, [...pathSegments, key])
  }
  return resolved
}

function resolveString(
  value: string,
  context: WsrtConfigResolverContext & {
    root: string
    env: NodeJS.ProcessEnv
    scope: ConfigScope
    config: unknown
  },
  pathSegments: string[],
): unknown {
  const fullMatch = value.match(/^\$\{([^}]+)\}$/)
  if (fullMatch) return lookupExpression(fullMatch[1], context, pathSegments)

  return value.replace(interpolationPattern, (_match, expression: string) => {
    const resolved = lookupExpression(expression, context, pathSegments)
    return resolved == null ? '' : String(resolved)
  })
}

function lookupExpression(
  expression: string,
  context: WsrtConfigResolverContext & {
    root: string
    env: NodeJS.ProcessEnv
    scope: ConfigScope
    config: unknown
  },
  pathSegments: string[],
): unknown {
  const key = expression.trim()
  if (!key) return ''
  if (key === 'root') return context.root
  if (key === 'runtime.environment') return context.scope.environment
  if (key === 'runtime.profile') return context.scope.profile
  if (key.startsWith('env.')) return context.env[key.slice(4)] ?? ''
  if (key.startsWith('path.')) return path.resolve(context.root, String(readPath(context.config, key.slice(5)) ?? ''))

  const resolved = readPath(context.config, key)
  if (resolved !== undefined) return resolved

  const environmentReference = environmentReferenceContext(pathSegments, context.config)
  if (environmentReference) {
    context.diagnostics.push(
      error(
        'config.environment_reference_unresolved',
        `Could not resolve environment reference "\${${key}}" for ${environmentReference.kind} "${environmentReference.name}" key "${environmentReference.key}" in ${context.source}`,
        {
          source: context.source,
          project: environmentReference.kind === 'process' ? environmentReference.name : undefined,
          detail: {
            kind: environmentReference.kind,
            name: environmentReference.name,
            key: environmentReference.key,
            token: `\${${key}}`,
            path: pathSegments.join('.'),
          },
        },
      ),
    )
    return ''
  }

  context.diagnostics.push(
    error(
      'config.value_reference_unresolved',
      `Could not resolve config value reference "\${${key}}" in ${context.source}`,
      {
        source: context.source,
        detail: {
          path: pathSegments.join('.'),
          reference: key,
        },
      },
    ),
  )
  return ''
}

function environmentReferenceContext(
  pathSegments: string[],
  config: unknown,
): { kind: 'process' | 'service'; name: string; key: string } | undefined {
  const environmentIndex = pathSegments.lastIndexOf('environment')
  if (environmentIndex < 0 || environmentIndex === pathSegments.length - 1) return undefined
  const key = pathSegments[environmentIndex + 1]
  if (!key) return undefined

  if (pathSegments[0] === 'projects' && pathSegments.length > 2) {
    return {
      kind: 'process',
      name: projectPathName(pathSegments.slice(1, environmentIndex), config),
      key,
    }
  }

  if (pathSegments[0] === 'services' && pathSegments.length > 2) {
    const serviceName = String(readPath(config, `${pathSegments[0]}.${pathSegments[1]}.id`) ?? pathSegments[1])
    return { kind: 'service', name: serviceName, key }
  }

  return undefined
}

function projectPathName(pathSegments: string[], config: unknown): string {
  const names: string[] = []
  let configPath = 'projects'
  for (let index = 0; index < pathSegments.length; index += 1) {
    const segment = pathSegments[index]
    if (index === 0) {
      names.push(segment)
      configPath += `.${segment}`
      continue
    }
    if (segment !== 'processes') continue
    const processKey = pathSegments[index + 1]
    if (!processKey) break
    const configuredName = String(
      readPath(config, `${configPath}.processes.${processKey}.name`) ?? processKey,
    )
    names.push(configuredName)
    configPath += `.processes.${processKey}`
    index += 1
  }
  return names.join(':')
}

function readPath(value: unknown, key: string): unknown {
  if (!key) return value
  let current = value
  for (const segment of key.split('.')) {
    if (!segment) return undefined
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)]
      continue
    }
    if (!isRecord(current) || !(segment in current)) return undefined
    current = current[segment]
  }
  return current
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
