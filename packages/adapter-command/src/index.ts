import { spawn } from 'node:child_process'
import type { CommandHandle, ProjectAdapter } from '@wsrt/types'
import { environmentForSpawn } from '@wsrt/environment'

export function commandAdapter(): ProjectAdapter {
  return {
    name: 'command',
    async start({ project }) {
      if (!project.config.command) throw new Error(`Project "${project.name}" requires a command`)
      const child = spawn(project.config.command, {
        cwd: project.root,
        shell: true,
        stdio: 'inherit',
        env: environmentForSpawn(project.environment),
      })
      const handle: CommandHandle = {
        name: project.name,
        adapter: 'command',
        status: 'running',
        process: child,
        metadata: { command: project.config.command, environment: project.environment },
        close: async () => {
          if (!child.killed) child.kill('SIGTERM')
        },
      }
      child.once('exit', () => {
        handle.status = 'exited'
      })
      return handle
    },
  }
}
