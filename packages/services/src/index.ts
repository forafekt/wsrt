import type {
  RuntimeResolvedEnvironment,
  RuntimeEventBus,
  RuntimeService,
  RuntimeServiceDefinition,
  RuntimeServiceRegistry,
  ServiceHealth,
  ServiceLogEntry,
  ServiceMetric,
} from '@wsrt/types'
import { resolveRuntimeEnvironment } from '@wsrt/environment'

type ServiceHooks = Pick<RuntimeServiceDefinition, 'start' | 'stop' | 'health' | 'logs' | 'metrics'>

export function createServiceRegistry(events: RuntimeEventBus): RuntimeServiceRegistry {
  const services = new Map<string, RuntimeService>()
  const hooks = new Map<string, ServiceHooks>()

  return {
    register(definition) {
      const existing = services.get(definition.id)
      const metadata = definition.metadata ?? {}
      const environment = isRuntimeResolvedEnvironment(metadata.environment)
        ? metadata.environment
        : resolveRuntimeEnvironment(definition.environment)
      const service: RuntimeService = {
        id: definition.id,
        name: definition.name ?? definition.id,
        kind: definition.kind,
        project: definition.project,
        adapter: definition.adapter,
        root: definition.root,
        command: definition.command,
        environment,
        url: definition.url,
        metadata: {
          ...metadata,
          environment,
        },
        state: existing?.state ?? 'registered',
        health: existing?.health ?? unknownHealth(),
        logs: existing?.logs ?? [],
        metrics: existing?.metrics ?? [],
        handle: existing?.handle,
        error: existing?.error,
      }
      services.set(service.id, service)
      hooks.set(service.id, definition)
      events.emit('service:registered', { service })
      return service
    },
    list() {
      return [...services.values()]
    },
    get(id) {
      return services.get(id)
    },
    async start(id) {
      const service = requireService(services, id)
      const definition = hooks.get(id)
      if (service.state === 'running') return service
      service.state = 'starting'
      service.error = undefined
      events.emit('service:starting', { service })
      try {
        const handle = await definition?.start?.()
        if (handle) {
          service.handle = handle
          service.url = handle.url ?? service.url
          service.metadata = { ...service.metadata, ...handle.metadata }
        }
        service.state = service.handle?.status === 'exited' ? 'stopped' : 'running'
        service.health = healthyHealth()
        events.emit('service:started', { service, handle: service.handle })
        return service
      } catch (cause) {
        service.state = 'failed'
        service.error = cause instanceof Error ? cause.message : String(cause)
        service.health = unhealthyHealth(service.error)
        events.emit('service:failed', { service, error: service.error })
        throw cause
      }
    },
    async stop(id) {
      const service = requireService(services, id)
      const definition = hooks.get(id)
      if (service.state === 'stopped' || service.state === 'registered') return service
      service.state = 'stopping'
      events.emit('service:stopping', { service })
      await definition?.stop?.()
      if (service.handle) await service.handle.close()
      service.handle = undefined
      service.state = 'stopped'
      service.health = unknownHealth('Service is stopped')
      events.emit('service:stopped', { service })
      return service
    },
    async restart(id) {
      await this.stop(id)
      return this.start(id)
    },
    async health(id) {
      if (id) return refreshHealth(requireService(services, id), hooks.get(id), events)
      const entries = await Promise.all([...services.values()].map(async (service) => [service.id, await refreshHealth(service, hooks.get(service.id), events)] as const))
      return Object.fromEntries(entries)
    },
    async logs(id) {
      const service = requireService(services, id)
      const next = await hooks.get(id)?.logs?.()
      if (next) service.logs = next
      return service.logs
    },
    async metrics(id) {
      const service = requireService(services, id)
      const next = await hooks.get(id)?.metrics?.()
      if (next) service.metrics = next
      return service.metrics
    },
  }
}

function isRuntimeResolvedEnvironment(value: unknown): value is RuntimeResolvedEnvironment {
  return value !== null && typeof value === 'object' && 'values' in value && 'entries' in value
}

export function serviceKindForAdapter(adapter: string): RuntimeService['kind'] {
  if (adapter === 'vite') return 'dev-server'
  if (adapter === 'node') return 'worker'
  if (adapter === 'command') return 'job'
  if (adapter === 'composite') return 'custom'
  return 'custom'
}

function requireService(services: Map<string, RuntimeService>, id: string): RuntimeService {
  const service = services.get(id)
  if (!service) throw new Error(`Unknown runtime service "${id}"`)
  return service
}

async function refreshHealth(service: RuntimeService, definition: ServiceHooks | undefined, events: RuntimeEventBus): Promise<ServiceHealth> {
  const next = await definition?.health?.()
  if (next) service.health = next
  else if (service.state === 'running') service.health = healthyHealth()
  else if (service.state === 'failed') service.health = unhealthyHealth(service.error)
  events.emit('service:health', { service, health: service.health })
  return service.health
}

function unknownHealth(message?: string): ServiceHealth {
  return { status: 'unknown', checkedAt: new Date().toISOString(), message }
}

function healthyHealth(): ServiceHealth {
  return { status: 'healthy', checkedAt: new Date().toISOString() }
}

function unhealthyHealth(message?: string): ServiceHealth {
  return { status: 'unhealthy', checkedAt: new Date().toISOString(), message }
}

export type { ServiceHealth, ServiceLogEntry, ServiceMetric }
