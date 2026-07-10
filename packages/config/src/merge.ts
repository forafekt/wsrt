import type { WsrtConfig } from '@wsrt/types'

const objectKeysToMerge = new Set([
  'workspace',
  'projects',
  'resolve',
  'extraAliases',
  'packageDefaults',
  'packageConfigOverrides',
  'imports',
  'graph',
  'analyze',
  'diagnostics',
  'server',
  'artifacts',
  'mcp',
  'runtime',
  'tsconfig',
  'manifests',
  'environments',
  'profiles',
  'report',
])

export function mergeWsrtConfig(base: WsrtConfig, override: WsrtConfig): WsrtConfig {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override) as Array<[keyof WsrtConfig, unknown]>) {
    if (key === 'extends' || value === undefined) continue
    const previous = merged[key]
    if (key === 'workspace' && isRecord(previous) && isRecord(value)) {
      merged[key] = {
        ...previous,
        ...value,
        packages: mergeStringArrays(previous.packages, value.packages),
      }
      continue
    }
    if (objectKeysToMerge.has(String(key)) && isRecord(previous) && isRecord(value)) {
      merged[key] = mergeObject(previous, value)
      continue
    }
    merged[key] = value
  }
  return merged as WsrtConfig
}

function mergeObject(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue
    const previous = merged[key]
    merged[key] = isRecord(previous) && isRecord(value) ? mergeObject(previous, value) : value
  }
  return merged
}

function mergeStringArrays(base: unknown, override: unknown): string[] | undefined {
  const values = [...toStringArray(base), ...toStringArray(override)]
  return values.length ? [...new Set(values)] : undefined
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
