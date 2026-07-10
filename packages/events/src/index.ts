import type {
  RuntimeEventBus,
  RuntimeEventMap,
  RuntimeEventName,
  RuntimeTimeline,
  RuntimeTimelineEntry,
} from '@wsrt/types'

export function createRuntimeTimeline(): RuntimeTimeline {
  const entries: RuntimeTimelineEntry[] = []
  let nextId = 1

  return {
    record(name, event) {
      const entry = {
        id: nextId,
        timestamp: new Date().toISOString(),
        name,
        ...summarizeEvent(name, event),
      }
      nextId += 1
      entries.push(entry)
      return entry
    },
    list() {
      return entries
    },
    recent(limit = 50) {
      return entries.slice(Math.max(0, entries.length - limit))
    },
    clear() {
      entries.length = 0
    },
  }
}

export function createRuntimeEventBus(timeline = createRuntimeTimeline()): RuntimeEventBus {
  const listeners = new Map<RuntimeEventName, Set<(event: RuntimeEventMap[RuntimeEventName]) => void>>()

  return {
    on(name, listener) {
      const bucket = listeners.get(name) ?? new Set()
      bucket.add(listener)
      listeners.set(name, bucket)
      return () => bucket.delete(listener)
    },
    once(name, listener) {
      const off = this.on(name, (event) => {
        off()
        listener(event)
      })
      return off
    },
    emit(name, event) {
      timeline.record(name, event)
      for (const listener of listeners.get(name) ?? []) listener(event as RuntimeEventMap[RuntimeEventName])
    },
  }
}

function summarizeEvent<Name extends RuntimeEventName>(
  name: Name,
  event: RuntimeEventMap[Name],
): Pick<RuntimeTimelineEntry, 'summary' | 'detail'> {
  if ('service' in event) {
    return {
      summary: `${name} ${event.service.id}`,
      detail: {
        id: event.service.id,
        state: event.service.state,
        kind: event.service.kind,
        project: event.service.project,
      },
    }
  }
  if ('task' in event) {
    return { summary: `${name} ${event.task.id}`, detail: { id: event.task.id } }
  }
  if ('command' in event) {
    return {
      summary: `${name} ${event.command.id}`,
      detail: { id: event.command.id, args: 'args' in event ? event.args : undefined },
    }
  }
  if ('action' in event) {
    return {
      summary: `${name} ${event.action}${event.id ? ` ${event.id}` : ''}`,
      detail: event,
    }
  }
  if ('diagnostic' in event) {
    return {
      summary: `${name} ${event.diagnostic.code}`,
      detail: {
        code: event.diagnostic.code,
        level: event.diagnostic.level,
        message: event.diagnostic.message,
      },
    }
  }
  if ('project' in event) {
    return { summary: `${name} ${event.project.name}`, detail: { name: event.project.name } }
  }
  if ('package' in event) {
    return { summary: `${name} ${event.package.name}`, detail: { name: event.package.name } }
  }
  if ('artifacts' in event) {
    return { summary: `${name} ${event.artifacts.length} artifact(s)`, detail: event.artifacts }
  }
  if ('graph' in event) {
    return {
      summary: `${name} ${event.graph.nodes.length} node(s), ${event.graph.edges.length} edge(s)`,
      detail: { nodes: event.graph.nodes.length, edges: event.graph.edges.length },
    }
  }
  if ('root' in event) {
    return { summary: `${name} ${event.root}`, detail: event }
  }
  return { summary: name.toString() }
}
