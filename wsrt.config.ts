import { defineWorkspace } from '@wsrt/core'
import dashboardPlugin from '@wsrt/plugin-dashboard'
import gitPlugin from '@wsrt/plugin-git'
import typeScriptPlugin from '@wsrt/plugin-typescript'
import workspacePlugin from '@wsrt/plugin-workspace'

export default defineWorkspace({
  projects: {},
  workspace: {
    packages: [
      './packages/*',
    ],
  },
  graph: {
    includeExternal: false,
  },
  analyze: {
    circularDependencies: true,
    deadPackages: true,
    deadExports: true,
    missingDependencies: true,
    duplicateDependencies: true,
    versionDrift: true,
    importStyle: true,
    health: true,
    impact: true,
  },
  imports: {
    validateRelativeWorkspaceImports: true,
    fixRelativeWorkspaceImports: false,
  },
  artifacts: {
    dir: './.wsrt',
    report: true,
    graph: true,
    packages: true,
    aliases: true,
    diagnostics: true,
  },
  mcp: {
    enabled: true,
    name: 'wsrt',
    exposeSourcePaths: true,
    exposeReports: true,
    exposeDiagnostics: true,
    maxResults: 100,
  },
  tsconfig: {
    enabled: true,
    mode: 'check',
    paths: true,
    root: false,
    projects: true,
  },
  manifests: {
    enabled: true,
    mode: 'check',
    targets: ['package-json'],
  },
  report: {
    file: './.vitem/report.json',
    pretty: true,
  },
  plugins: [
    dashboardPlugin({
      enabled: true,
      host: '0.0.0.0',
      port: 5177,
      path: '/wsrt',
    }),
    gitPlugin(),
    typeScriptPlugin(),
    workspacePlugin(),
  ],
})


    // "@wsrt/plugin-dashboard?enabled=true&host=0.0.0.0&port=5177&path=/wsrt",
    // "@wsrt/plugin-git",
    // "@wsrt/plugin-typescript",
    // "@wsrt/plugin-workspace",