import type {
  RuntimeEnvironmentEntry,
  RuntimeResolvedEnvironment,
  WsrtEnvironment,
} from '@wsrt/types'

const sensitiveKeyPattern = /(SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|KEY)/i

export function resolveRuntimeEnvironment(
  environment: WsrtEnvironment | undefined,
): RuntimeResolvedEnvironment {
  const values: Record<string, string> = {}
  const entries: RuntimeEnvironmentEntry[] = []

  for (const [key, value] of Object.entries(environment ?? {})) {
    const resolved = stringifyEnvironmentValue(value)
    const sensitive = isSensitiveEnvironmentKey(key)
    if (resolved === undefined) {
      entries.push({ key, masked: false, omitted: true, sensitive })
      continue
    }
    values[key] = resolved
    entries.push({
      key,
      value: sensitive ? maskEnvironmentValue(resolved) : resolved,
      masked: sensitive,
      sensitive,
    })
  }

  return { values, entries }
}

export function mergeEnvironmentConfig(
  ...layers: Array<WsrtEnvironment | undefined>
): WsrtEnvironment | undefined {
  const merged: WsrtEnvironment = {}
  let hasValues = false
  for (const layer of layers) {
    if (!layer) continue
    for (const [key, value] of Object.entries(layer)) {
      merged[key] = value
      hasValues = true
    }
  }
  return hasValues ? merged : undefined
}

export function environmentForSpawn(
  environment: RuntimeResolvedEnvironment,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const entry of environment.entries) {
    if (entry.omitted) delete env[entry.key]
  }
  for (const [key, value] of Object.entries(environment.values)) {
    env[key] = value
  }
  return env
}

export function stringifyEnvironmentValue(
  value: WsrtEnvironment[string],
): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  return value
}

export function isSensitiveEnvironmentKey(key: string): boolean {
  return sensitiveKeyPattern.test(key)
}

function maskEnvironmentValue(value: string): string {
  return value.length === 0 ? '' : '********'
}
