import path from 'node:path'
import {
  type ConfigEnv,
  type InlineConfig,
  loadConfigFromFile,
  mergeConfig,
  type UserConfig,
} from 'vite'
import { info, warning } from '@wsrt/diagnostics'
import { createViteAliasEntries, hasWsrtVitePlugin, wsrt } from '@wsrt/plugin-vite'
import type {
  OrchestratedViteConfig,
  OrchestratedViteConfigOptions,
  ServerConfig,
} from '@wsrt/types'

export async function createOrchestratedViteConfig(
  options: OrchestratedViteConfigOptions,
): Promise<OrchestratedViteConfig> {
  const configFile = resolveConfigFile(options)
  const command = viteCommand(options)
  const loaded =
    configFile === false
      ? null
      : await loadConfigFromFile(
          env(command, options.project.config.vite?.mode),
          configFile,
          options.project.root,
        )
  const userConfig = (loaded?.config ?? {}) as UserConfig
  const manualPluginDetected = hasWsrtVitePlugin(userConfig.plugins)
  const internalPlugin = manualPluginDetected ? undefined : [wsrt({ runtime: options.runtime })]
  const inlineConfig: InlineConfig = {
    root: options.project.root,
    configFile: false,
    mode: options.project.config.vite?.mode,
    clearScreen: false,
    server: command === 'serve' ? serverOptions(options.project.config.server) : undefined,
    resolve: {
      alias: createViteAliasEntries(options.runtime.state.aliases),
    },
    plugins: internalPlugin,
  }
  const config = mergeConfig(userConfig, inlineConfig)
  config.configFile = false

  options.runtime.diagnostics.add(
    info(
      'vite.config.loaded',
      loaded?.path ? `Loaded Vite config ${loaded.path}` : 'No Vite config loaded',
      { project: options.project.name, source: loaded?.path },
    ),
  )
  if (manualPluginDetected) {
    options.runtime.diagnostics.add(
      info('vite.plugin.manual', 'Manual WSRT plugin detected; automatic injection skipped', {
        project: options.project.name,
      }),
    )
  } else {
    options.runtime.diagnostics.add(
      info('vite.plugin.injected', 'WSRT plugin auto-injected', { project: options.project.name }),
    )
  }
  for (const specifier of inspectSpecifiers(options.runtime.state.aliases)) {
    const resolved = options.runtime.resolve(specifier)
    options.runtime.diagnostics.add(
      resolved.resolved
        ? info(`vite.resolve.inspect.${specifier}`, `WSRT resolver maps ${specifier} to ${resolved.resolved}`, {
            project: options.project.name,
            detail: {
              specifier,
              resolved: resolved.resolved,
              source: resolved.source,
              aliasInjected: Boolean(options.runtime.state.aliases[specifier]),
            },
          })
        : warning(`vite.resolve.inspect.${specifier}`, `WSRT resolver cannot map ${specifier}`, {
            project: options.project.name,
            detail: { specifier, source: resolved.source },
          }),
    )
  }

  return {
    config,
    userConfig,
    status: {
      configFile: loaded?.path,
      autoInjected: !manualPluginDetected,
      manualPluginDetected,
      duplicateInjectionAvoided: manualPluginDetected,
      userPluginCount: Array.isArray(userConfig.plugins)
        ? userConfig.plugins.length
        : userConfig.plugins
          ? 1
          : 0,
    },
  }
}

function inspectSpecifiers(aliases: Record<string, string>): string[] {
  return Object.keys(aliases).sort()
}

function resolveConfigFile(options: OrchestratedViteConfigOptions): string | false | undefined {
  const configured = options.project.config.vite?.configFile
  if (configured === false) return false
  if (typeof configured === 'string') return path.resolve(options.runtime.state.root, configured)
  options.runtime.diagnostics.add(
    warning(
      'vite.config_missing',
      `Project "${options.project.name}" has no explicit Vite config file`,
      { project: options.project.name },
    ),
  )
  return undefined
}

function serverOptions(server: ServerConfig | undefined): InlineConfig['server'] {
  return server
    ? { host: server.host, port: server.port, strictPort: server.strictPort, open: server.open }
    : undefined
}

export function viteCommand(options: OrchestratedViteConfigOptions): 'serve' | 'build' | 'build-watch' {
  const command = options.project.config.vite?.command ?? options.project.config.command
  if (command === 'build' || command === 'build-watch') return command
  return 'serve'
}

function env(command: 'serve' | 'build' | 'build-watch', mode = 'development'): ConfigEnv {
  return { command: command === 'serve' ? 'serve' : 'build', mode, isSsrBuild: false, isPreview: false }
}
