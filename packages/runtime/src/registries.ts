import type {
  RuntimeCliGroupDefinition,
  RuntimeCliRegistry,
  RuntimeCommandDefinition,
  RuntimeCommandRegistry,
  RuntimeEventBus,
  RuntimeTaskDefinition,
  RuntimeTaskRegistry,
  WorkspaceRuntime,
} from '@wsrt/types'

export function createRuntimeTaskRegistry(
  runtime: () => WorkspaceRuntime,
  events: RuntimeEventBus,
): RuntimeTaskRegistry {
  const tasks = new Map<string, RuntimeTaskDefinition>()

  return {
    register(definition) {
      tasks.set(definition.id, definition)
      return definition
    },
    list() {
      return [...tasks.values()]
    },
    get(id) {
      return tasks.get(id)
    },
    async run(id, context = {}) {
      const task = tasks.get(id)
      if (!task) throw new Error(`Unknown runtime task "${id}"`)
      events.emit('task:started', { task })
      try {
        const result = await task.run({
          runtime: runtime(),
          args: context.args ?? [],
          input: context.input,
        })
        events.emit('task:completed', { task, result })
        return result
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause)
        events.emit('task:failed', { task, error })
        throw cause
      }
    },
  }
}

export function createRuntimeCommandRegistry(
  runtime: () => WorkspaceRuntime,
  events: RuntimeEventBus,
): RuntimeCommandRegistry {
  const commands = new Map<string, RuntimeCommandDefinition>()

  return {
    register(definition) {
      commands.set(definition.id, definition)
      return definition
    },
    list() {
      return [...commands.values()]
    },
    get(id) {
      return commands.get(id)
    },
    async run(id, context = {}) {
      const command = commands.get(id)
      if (!command) throw new Error(`Unknown runtime command "${id}"`)
      const args = context.args ?? []
      events.emit('command:started', { command, args })
      try {
        const result = await command.run({
          runtime: runtime(),
          args,
          input: context.input,
        })
        events.emit('command:completed', { command, result })
        return result
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause)
        events.emit('command:failed', { command, error })
        throw cause
      }
    },
  }
}

export function createRuntimeCliRegistry(runtime: () => WorkspaceRuntime): RuntimeCliRegistry {
  const groups = new Map<string, RuntimeCliGroupDefinition>()
  const aliases = new Map<string, string>()

  return {
    registerGroup(definition) {
      groups.set(definition.id, definition)
      for (const alias of definition.aliases ?? []) aliases.set(alias, definition.id)
      return definition
    },
    listGroups() {
      return [...groups.values()]
    },
    getGroup(id) {
      return groups.get(id) ?? groups.get(aliases.get(id) ?? '')
    },
    async run(id, invocation) {
      const group = this.getGroup(id)
      if (!group) throw new Error(`Unknown runtime CLI group "${id}"`)
      return group.run({ runtime: runtime(), args: invocation.args, options: invocation.options })
    },
  }
}
