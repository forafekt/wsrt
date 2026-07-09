export { defineWorkspace, defineProject } from './define.js'
export { discoverConfigFile, loadWsrtConfig } from './loader.js'
export { mergeWsrtConfig } from './merge.js'
export {
  isWsrtModuleReference,
  resolveConfigModuleReferences,
  resolveWsrtModuleReference,
} from './module-reference.js'
export { resolveConfigValues, resolveWsrtConfig } from './resolver.js'
