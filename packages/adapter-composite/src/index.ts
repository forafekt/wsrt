import type { ProjectAdapter, ProjectHandle, RuntimeProject } from '@wsrt/types'

export function compositeAdapter(adapters: () => Record<string, ProjectAdapter>): ProjectAdapter {
  return {
    name: 'composite',
    async start({ runtime, project }) {
      const handles = new Map<string, ProjectHandle>()
      for (const processProject of orderedProcesses(project.processes)) {
        for (const dependency of processProject.config.dependsOn ?? []) {
          const dependencyName = dependency.includes(':')
            ? dependency
            : `${project.name}:${dependency}`
          if (!handles.has(dependencyName))
            throw new Error(
              `Composite process "${processProject.name}" depends on unknown process "${dependency}"`,
            )
        }
        const adapter = adapters()[processProject.adapter]
        if (!adapter) throw new Error(`No adapter registered for "${processProject.adapter}"`)
        handles.set(processProject.name, await adapter.start({ runtime, project: processProject }))
      }
      return {
        name: project.name,
        adapter: 'composite',
        status: 'running',
        metadata: {
          processes: [...handles.values()].map((handle) => ({
            name: handle.name,
            adapter: handle.adapter,
            url: handle.url,
            metadata: handle.metadata,
          })),
        },
        close: async () => {
          await Promise.all([...handles.values()].reverse().map((handle) => handle.close()))
        },
      }
    },
  }
}

function orderedProcesses(processes: RuntimeProject[]): RuntimeProject[] {
  const ordered: RuntimeProject[] = []
  const remaining = new Map(
    processes.map((processProject) => [processProject.name, processProject]),
  )
  while (remaining.size) {
    const ready = [...remaining.values()].find((processProject) =>
      (processProject.config.dependsOn ?? []).every((dependency) =>
        ordered.some((item) => item.name.endsWith(`:${dependency}`) || item.name === dependency),
      ),
    )
    if (!ready) throw new Error('Composite process dependency cycle detected')
    ordered.push(ready)
    remaining.delete(ready.name)
  }
  return ordered
}
