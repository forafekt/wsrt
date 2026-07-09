import { build, createServer } from 'vite'
import { createOrchestratedViteConfig, viteCommand } from './config.js'
import type { ProjectAdapter } from '@wsrt/types'

export function viteAdapter(): ProjectAdapter {
  return {
    name: 'vite',
    async start({ runtime, project }) {
      const orchestrated = await createOrchestratedViteConfig({ runtime, project })
      const command = viteCommand({ runtime, project })
      if (command === 'build' || command === 'build-watch') {
        const config = {
          ...orchestrated.config,
          build: {
            ...orchestrated.config.build,
            watch: command === 'build-watch' ? (orchestrated.config.build?.watch ?? {}) : undefined,
          },
        }
        const result = await build(config)
        return {
          name: project.name,
          adapter: 'vite',
          status: command === 'build-watch' ? 'running' : 'exited',
          metadata: {
            vite: orchestrated.status,
            command,
            resultType: Array.isArray(result) ? 'array' : typeof result,
          },
          close: async () => {
            if (
              result &&
              typeof result === 'object' &&
              'close' in result &&
              typeof result.close === 'function'
            ) {
              result.close()
            }
          },
        }
      }
      const server = await createServer(orchestrated.config)
      await server.listen()
      const urls = server.resolvedUrls?.local ?? server.resolvedUrls?.network ?? []
      return {
        name: project.name,
        adapter: 'vite',
        url: urls[0],
        status: 'running',
        metadata: { vite: orchestrated.status },
        close: async () => {
          await server.close()
        },
      }
    },
  }
}

export { createOrchestratedViteConfig } from './config.js'
