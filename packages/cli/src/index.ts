#!/usr/bin/env node
import process from 'node:process'
import { createWorkspaceRuntime } from '@wsrt/runtime'

type ParsedArgs = {
  command: string
  args: string[]
  options: {
    root?: string
    config?: string
    json?: boolean
    host?: string
    port?: number
    alias?: string
  }
}

type CliLifecycleResult = {
  kind: 'lifecycle'
  message: string
  close: () => Promise<void>
  value?: unknown
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv)
  const runtime = await createWorkspaceRuntime({
    root: parsed.options.root,
    config: parsed.options.config,
  })

  if (parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
    printHelp(runtime)
    return
  }

  const group = runtime.cli.getGroup(parsed.command)
  if (!group) {
    printHelp(runtime)
    process.exitCode = parsed.command ? 1 : 0
    return
  }

  const result = await runtime.cli.run(parsed.command, {
    args: parsed.args,
    options: {
      ...parsed.options,
      alias: group.id === parsed.command ? undefined : parsed.command,
    },
  })
  await output(parsed, result)
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'query', ...rest] = argv
  const args: string[] = []
  const options: ParsedArgs['options'] = {}
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    const next = rest[index + 1]
    if (arg === '--root' && next) {
      options.root = next
      index += 1
    } else if (arg === '--config' && next) {
      options.config = next
      index += 1
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--host' && next) {
      options.host = next
      index += 1
    } else if (arg === '--port' && next) {
      options.port = Number(next)
      index += 1
    } else {
      args.push(arg)
    }
  }
  return { command, args, options }
}

async function output(parsed: ParsedArgs, value: unknown): Promise<void> {
  if (isLifecycleResult(value)) {
    if (parsed.options.json) console.log(JSON.stringify(stripFunctions(value), null, 2))
    else console.log(value.message)
    await untilInterrupted(value.close)
    return
  }

  if (parsed.options.json) {
    console.log(JSON.stringify(stripFunctions(value), null, 2))
    return
  }

  printText(value)
}

function printText(value: unknown): void {
  if (Array.isArray(value)) {
    console.log(`${value.length} item(s)`)
    for (const item of value) console.log(formatListItem(item))
    return
  }
  if (value && typeof value === 'object' && 'task' in value && 'result' in value) {
    const taskResult = value as { task: string; result: unknown }
    console.log(`Task "${taskResult.task}" completed`)
    printText(taskResult.result)
    return
  }
  if (value && typeof value === 'object') {
    console.log(JSON.stringify(stripFunctions(value), null, 2))
    return
  }
  if (value !== undefined) console.log(String(value))
}

function formatListItem(value: unknown): string {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const id = record.id ?? record.name ?? record.file ?? record.code
    const title = record.title ?? record.status ?? record.kind ?? record.level
    if (id && title) return `- ${String(id)} (${String(title)})`
    if (id) return `- ${String(id)}`
  }
  return `- ${String(value)}`
}

function stripFunctions(value: unknown): unknown {
  const serialized = JSON.stringify(value, (_key, item) =>
    typeof item === 'function' ? undefined : item,
  )
  return serialized === undefined ? undefined : JSON.parse(serialized)
}

function isLifecycleResult(value: unknown): value is CliLifecycleResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { kind?: unknown }).kind === 'lifecycle' &&
      typeof (value as { close?: unknown }).close === 'function',
  )
}

function printHelp(runtime: Awaited<ReturnType<typeof createWorkspaceRuntime>>): void {
  console.log('Usage: wsrt <run|task|exec|query> [args] [--root dir] [--config file] [--json]')
  console.log('')
  console.log('Runtime command groups:')
  for (const group of runtime.cli.listGroups()) {
    const aliases = group.aliases?.length ? ` aliases: ${group.aliases.join(', ')}` : ''
    console.log(`- ${group.id}${group.description ? `: ${group.description}` : ''}${aliases}`)
  }
}

function untilInterrupted(close: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    let closing = false
    const shutdown = async () => {
      if (closing) return
      closing = true
      await close()
      resolve()
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}

main(process.argv.slice(2)).catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : String(cause))
  process.exitCode = 1
})
