import path from 'node:path'
import { warning } from '@wsrt/diagnostics'
import type { AdapterName, ProjectConfig, RuntimeProject, WsrtConfig, WsrtDiagnostic } from '@wsrt/types'
import { mergeEnvironmentConfig, resolveRuntimeEnvironment } from '@wsrt/environment'

export function resolveProjects(root: string, config: WsrtConfig, diagnostics: WsrtDiagnostic[]): RuntimeProject[] {
  return Object.entries(config.projects ?? {}).map(([name, project]) =>
    resolveProject(root, name, project, diagnostics),
  )
}

function resolveProject(
  root: string,
  name: string,
  config: ProjectConfig,
  diagnostics: WsrtDiagnostic[],
  inheritedEnvironment?: ProjectConfig['environment'],
): RuntimeProject {
  const adapter = selectAdapter(name, config, diagnostics)
  const projectRoot = path.resolve(root, config.root ?? '.')
  const environment = mergeEnvironmentConfig(inheritedEnvironment, config.environment)
  return {
    name,
    root: projectRoot,
    adapter,
    config,
    environment: resolveRuntimeEnvironment(environment),
    processes: normalizeProcesses(root, name, config.processes, diagnostics, environment),
  }
}

function normalizeProcesses(
  root: string,
  parentName: string,
  processes: ProjectConfig['processes'],
  diagnostics: WsrtDiagnostic[],
  inheritedEnvironment?: ProjectConfig['environment'],
): RuntimeProject[] {
  if (!processes) return []
  const entries = Array.isArray(processes)
    ? processes.map((processConfig, index) => [processConfig.name ?? `process-${index + 1}`, processConfig] as const)
    : Object.entries(processes)
  return entries.map(([name, config]) =>
    resolveProject(root, `${parentName}:${name}`, config, diagnostics, inheritedEnvironment),
  )
}

function selectAdapter(name: string, config: ProjectConfig, diagnostics: WsrtDiagnostic[]): AdapterName {
  const adapter = config.adapter ?? (config.processes ? 'composite' : config.vite ? 'vite' : 'command')
  if ((adapter === 'node' || adapter === 'command') && config.vite?.configFile) {
    diagnostics.push(warning(
      'project.vite_config_unused',
      `Project "${name}" declares vite.configFile but adapter "${adapter}" cannot consume it; use adapter "vite" or "composite" for renderer+node projects.`,
      { project: name },
    ))
  }
  diagnostics.push({ level: 'info', code: 'project.adapter', message: `Project "${name}" uses ${adapter} adapter`, project: name })
  return adapter
}
