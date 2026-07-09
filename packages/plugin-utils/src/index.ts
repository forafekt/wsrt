import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

export function relative(root: string, file: string): string {
  return path.relative(root, file) || '.'
}

export function walkFiles(
  root: string,
  predicate: (file: string) => boolean,
  options: { maxDepth?: number; ignore?: string[] } = {},
): string[] {
  const maxDepth = options.maxDepth ?? 6
  const ignore = new Set(['.git', 'node_modules', 'dist', 'build', '.wsrt', ...(options.ignore ?? [])])
  const result: string[] = []
  visit(root, 0)
  return result.sort()

  function visit(dir: string, depth: number): void {
    if (depth > maxDepth || !fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignore.has(entry.name)) continue
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(file, depth + 1)
      else if (predicate(file)) result.push(file)
    }
  }
}

export function runProcess(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ command: string; exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.once('error', reject)
    child.once('exit', (exitCode) => {
      resolve({ command: [command, ...args].join(' '), exitCode, stdout, stderr })
    })
  })
}

export function packageManagerCommand(manager?: string): string {
  if (manager === 'yarn') return 'yarn'
  if (manager === 'bun') return 'bun'
  if (manager === 'npm') return 'npm'
  return 'pnpm'
}
