import fs from 'node:fs'
import path from 'node:path'

export function readJsonFile(file: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(file)) return undefined
  const parsed = JSON.parse(toJson(fs.readFileSync(file, 'utf8'))) as unknown
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
}

export function writeJsonFile(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort(), 2)
}

function flattenKeys(value: unknown, keys: Record<string, true> = {}): Record<string, true> {
  if (!value || typeof value !== 'object') return keys
  if (Array.isArray(value)) {
    for (const item of value) flattenKeys(item, keys)
    return keys
  }
  for (const [key, child] of Object.entries(value)) {
    keys[key] = true
    flattenKeys(child, keys)
  }
  return keys
}

function toJson(source: string): string {
  return removeTrailingCommas(stripJsonComments(source))
}

function stripJsonComments(source: string): string {
  let result = ''
  let inString = false
  let quote = ''
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]
    const next = source[index + 1]
    if (inString) {
      result += current
      if (escaped) {
        escaped = false
      } else if (current === '\\') {
        escaped = true
      } else if (current === quote) {
        inString = false
        quote = ''
      }
      continue
    }
    if (current === '"' || current === "'") {
      inString = true
      quote = current
      result += current
      continue
    }
    if (current === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      result += '\n'
      continue
    }
    if (current === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1
      index += 1
      continue
    }
    result += current
  }
  return result
}

function removeTrailingCommas(source: string): string {
  let result = ''
  let inString = false
  let quote = ''
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]
    if (inString) {
      result += current
      if (escaped) {
        escaped = false
      } else if (current === '\\') {
        escaped = true
      } else if (current === quote) {
        inString = false
        quote = ''
      }
      continue
    }
    if (current === '"' || current === "'") {
      inString = true
      quote = current
      result += current
      continue
    }
    if (current === ',') {
      let nextIndex = index + 1
      while (/\s/.test(source[nextIndex] ?? '')) nextIndex += 1
      if (source[nextIndex] === '}' || source[nextIndex] === ']') continue
    }
    result += current
  }
  return result
}
