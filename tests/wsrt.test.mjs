import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { createServer } from 'vite'
import { createOrchestratedViteConfig } from '@wsrt/adapter-vite'
import { loadWsrtConfig } from '@wsrt/config'
import { environmentForSpawn } from '@wsrt/environment'
import { runMcpTool } from '@wsrt/mcp'
import { createWorkspaceRuntime } from '@wsrt/runtime'
import { startDashboard } from '@wsrt/plugin-dashboard'
import { hasWsrtVitePlugin, wsrt } from '@wsrt/plugin-vite'

const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

test('loads root config with extends and detects circular extends as diagnostics', async () => {
  const root = fixture()
  fs.writeFileSync(
    path.join(root, 'base.config.mjs'),
    'export default { workspace: { packages: ["packages/*"] }, extraAliases: { "@base": "./packages/pkg-a/src/index.ts" } }\n',
  )
  fs.writeFileSync(
    path.join(root, 'wsrt.config.mjs'),
    'export default { extends: "./base.config.mjs", projects: { webapp: { root: "./apps/webapp", adapter: "vite", vite: { configFile: "./apps/webapp/vite.config.mjs" } } } }\n',
  )

  const loaded = await loadWsrtConfig(root)
  assert.equal(loaded.sources.length, 2)
  assert.deepEqual(loaded.config.workspace.packages, ['packages/*'])
  assert.equal(loaded.config.extraAliases['@base'], './packages/pkg-a/src/index.ts')

  fs.writeFileSync(path.join(root, 'loop-a.mjs'), 'export default { extends: "./loop-b.mjs" }\n')
  fs.writeFileSync(path.join(root, 'loop-b.mjs'), 'export default { extends: "./loop-a.mjs" }\n')
  const circular = await loadWsrtConfig(root, './loop-a.mjs')
  assert.equal(
    circular.diagnostics.some((item) => item.code === 'config.circular_extends'),
    true,
  )

  const jsoncRoot = fixture()
  fs.writeFileSync(
    path.join(jsoncRoot, 'wsrt.jsonc'),
    '{ // comment\n "workspace": { "packages": ["packages/*"] }, "mcp": { "enabled": true } }\n',
  )
  const jsonc = await loadWsrtConfig(jsoncRoot)
  assert.deepEqual(jsonc.config.workspace.packages, ['packages/*'])
  assert.equal(jsonc.config.mcp.enabled, true)

  const yamlRoot = fixture()
  fs.writeFileSync(
    path.join(yamlRoot, 'wsrt.yaml'),
    'workspace:\n  packages: ["packages/*"]\nruntime:\n  profile: yaml\n',
  )
  const yaml = await loadWsrtConfig(yamlRoot)
  assert.deepEqual(yaml.config.workspace.packages, ['packages/*'])
  assert.equal(yaml.config.runtime.profile, 'yaml')
})

test('runtime discovers packages, aliases, exports, graph, and inspect state', async () => {
  const root = fixture()
  writeWsrtConfig(root, { dashboard: 'true' })
  const runtime = await createWorkspaceRuntime({ root })

  assert.equal(runtime.profile.environment, 'development')
  assert.equal(runtime.state.projects.find((project) => project.name === 'webapp').adapter, 'vite')
  assert.equal(
    runtime.state.projects.find((project) => project.name === 'desktop').adapter,
    'composite',
  )
  assert.equal(
    runtime.state.packages.some((pkg) => pkg.name === '@scope/pkg-a'),
    true,
  )
  assert.equal(runtime.resolve('@scope/pkg-a/feature').source, 'export')
  assert.equal(
    path.relative(root, runtime.resolve('@extra').resolved),
    'packages/pkg-b/src/index.ts',
  )
  assert.equal(
    runtime.state.graph.edges.some(
      (edge) => edge.from === '@scope/pkg-a' && edge.to === '@scope/pkg-b',
    ),
    true,
  )
  assert.equal(runtime.state.mcp.enabled, true)
  assert.equal(
    runtime.state.mcp.tools.some((tool) => tool.id === 'workspace.resolveImport'),
    true,
  )
  assert.equal(
    runtime.state.virtualImports.imports.some((item) => item.id === 'virtual:wsrt/packages'),
    true,
  )
  assert.equal(
    runtime.state.dashboard.routes.some((route) => route.id === 'plugins'),
    true,
  )
  assert.equal(
    runtime.state.services.some(
      (service) => service.id === 'project:webapp' && service.kind === 'dev-server',
    ),
    true,
  )
  assert.equal(runtime.services.get('project:webapp').state, 'registered')
  assert.equal(runtime.config.get('mcp').enabled, true)
  assert.equal(runtime.config.raw.mcp.enabled, true)
  assert.equal(runtime.graph.node('@scope/pkg-a').kind, 'package')
  assert.deepEqual(runtime.graph.dependencies('@scope/pkg-a').map((pkg) => pkg.name), [
    '@scope/pkg-b',
  ])
  assert.equal(runtime.graph.forProject('webapp').project.name, 'webapp')
  assert.equal(runtime.graph.forPackage('@scope/pkg-a').dependents.length, 0)
  assert.equal(runtime.query.overview().counts.packages, 2)
  assert.equal(runtime.query.projects().some((project) => project.name === 'webapp'), true)
  assert.equal(runtime.query.packages({ search: 'pkg-b' })[0].name, '@scope/pkg-b')
  assert.equal(runtime.query.graph().nodes.some((node) => node.id === '@scope/pkg-a'), true)
  assert.equal(runtime.query.config().root, root)
  assert.equal(runtime.query.timeline().some((entry) => entry.name === 'runtime:created'), true)
  assert.equal(runtime.query.cli().some((group) => group.id === 'run'), true)
  assert.equal(runtime.query.tasks().some((task) => task.id === 'validate'), true)
})

test('inline config deep merges with loaded config', async () => {
  const root = fixture()
  writeWsrtConfig(root, {
    runtime: '{ environment: "test", profile: "file" }',
    mcp: '{ enabled: true, name: "from-file" }',
  })

  const runtime = await createWorkspaceRuntime({
    root,
    inlineConfig: {
      runtime: { profile: 'inline' },
      mcp: { maxResults: 5 },
    },
  })

  assert.equal(runtime.profile.environment, 'test')
  assert.equal(runtime.profile.name, 'inline')
  assert.equal(runtime.config.raw.mcp.enabled, true)
  assert.equal(runtime.config.raw.mcp.name, 'fixture')
  assert.equal(runtime.config.raw.mcp.maxResults, 5)
  assert.equal(runtime.query.projects().some((project) => project.name === 'webapp'), true)
  assert.equal(runtime.query.packages().some((pkg) => pkg.name === '@scope/pkg-a'), true)
})

test('dashboard is optional unless enabled by config or plugin', async () => {
  const root = fixture()
  writeWsrtConfig(root)
  const runtime = await createWorkspaceRuntime({ root })

  assert.equal(runtime.services.get('dashboard'), undefined)
  assert.equal(runtime.state.dashboard.routes.length, 0)
  assert.equal(runtime.state.dashboard.pages.length, 0)
  await assert.rejects(
    () => runtime.cli.run('dashboard', { args: [], options: { alias: 'dashboard' } }),
    /Unknown runtime service "dashboard"/,
  )
})

test('runtime CLI groups, tasks, commands, and timeline are registry driven', async () => {
  const root = fixture()
  writeWsrtConfig(root)
  const runtime = await createWorkspaceRuntime({ root })

  runtime.tasks.register({
    id: 'fixture',
    title: 'Fixture task',
    run: ({ args }) => ({ ok: true, args }),
  })
  runtime.commands.register({
    id: 'fixture:command',
    title: 'Fixture command',
    run: ({ args }) => ({ command: true, args }),
  })
  runtime.cli.registerGroup({
    id: 'fixture',
    title: 'Fixture group',
    run: ({ runtime: currentRuntime, args }) => currentRuntime.tasks.run('fixture', { args }),
  })

  assert.deepEqual(await runtime.tasks.run('fixture', { args: ['a'] }), {
    ok: true,
    args: ['a'],
  })
  assert.deepEqual(await runtime.commands.run('fixture:command', { args: ['b'] }), {
    command: true,
    args: ['b'],
  })
  assert.deepEqual(await runtime.cli.run('fixture', { args: ['c'], options: {} }), {
    ok: true,
    args: ['c'],
  })
  assert.equal(
    (await runtime.cli.run('query', { args: ['overview'], options: {} })).counts.packages,
    2,
  )
  assert.equal(
    (await runtime.cli.run('inspect', { args: [], options: { alias: 'inspect' } })).counts.projects,
    4,
  )
  assert.equal(
    runtime.query.events({ name: 'task:completed' }).some((entry) => entry.summary.includes('fixture')),
    true,
  )
  assert.equal(
    runtime.query.events({ name: 'command:completed' }).some((entry) => entry.summary.includes('fixture:command')),
    true,
  )
})

test('runtime diagnostics and service failures update canonical state through events', async () => {
  const root = fixture()
  writeWsrtConfig(root)
  const runtime = await createWorkspaceRuntime({
    root,
    adapters: [
      {
        name: 'failing',
        async start() {
          throw new Error('fixture start failed')
        },
      },
    ],
    inlineConfig: {
      projects: {
        broken: { root: '.', adapter: 'failing' },
      },
    },
  })

  const diagnostics = []
  const failed = []
  runtime.events.on('diagnostic:added', ({ diagnostic }) => diagnostics.push(diagnostic))
  runtime.events.on('service:failed', ({ service }) => failed.push(service))

  runtime.diagnostics.add({
    level: 'warning',
    code: 'fixture.project',
    message: 'project warning',
    project: 'broken',
  })
  assert.equal(diagnostics[0].code, 'fixture.project')
  assert.equal(
    runtime.diagnostics.byProject('broken').some((item) => item.code === 'fixture.project'),
    true,
  )

  await assert.rejects(() => runtime.runProject('broken'), /fixture start failed/)
  assert.equal(failed[0].id, 'project:broken')
  assert.equal(runtime.state.services.find((service) => service.id === 'project:broken').state, 'failed')
})

test('runtime plugins can add diagnostics, dashboard routes, and MCP tools', async () => {
  const root = fixture()
  fs.writeFileSync(
    path.join(root, 'wsrt.config.mjs'),
    `export default {
    workspace: { packages: ["packages/*"] },
    dashboard: true,
    plugins: [{
      name: "fixture-plugin",
      runtimeCreated({ runtime }) {
        runtime.diagnostics.add({ level: "info", code: "plugin.fixture", message: "plugin ran" })
      },
      dashboardRoutes(routes) {
        routes.push({ id: "fixture", label: "Fixture", path: "#fixture" })
      },
      mcpTools(tools) {
        tools.push({ id: "fixture.tool", title: "Fixture", description: "Fixture tool", kind: "tool" })
      }
    }]
  }\n`,
  )

  const runtime = await createWorkspaceRuntime({ root })
  assert.deepEqual(runtime.state.plugins.names, ['workspace', 'git', 'typescript', 'dashboard', 'fixture-plugin'])
  assert.equal(
    runtime.state.diagnostics.some((item) => item.code === 'plugin.fixture'),
    true,
  )
  assert.equal(
    runtime.state.dashboard.routes.some((route) => route.id === 'fixture'),
    true,
  )
  assert.equal(
    runtime.state.mcp.tools.some((tool) => tool.id === 'fixture.tool'),
    true,
  )
  assert.equal(runtime.query.plugin('workspace').packages.length >= 2, true)
  assert.equal(
    runtime.state.dashboard.pages.some((page) => page.id === 'workspace'),
    true,
  )
  assert.equal(
    runtime.state.mcp.tools.some((tool) => tool.id === 'plugin.workspace'),
    true,
  )
})

test('data-only configs resolve module references for runtime extension points', async () => {
  const root = fixture()
  fs.mkdirSync(path.join(root, 'extensions'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'extensions/plugin.ts'),
    `export default function fixturePlugin(options) {
      return {
        name: "fixture-data-plugin",
        runtimeCreated({ runtime }) {
          runtime.diagnostics.add({ level: "info", code: "plugin.data", message: String(options.message) })
        }
      }
    }\n`,
  )
  fs.writeFileSync(
    path.join(root, 'extensions/adapter.ts'),
    `export function fixtureAdapter(options) {
      return {
        name: "fixture-adapter",
        async start({ project }) {
          return {
            name: project.name,
            adapter: "fixture-adapter",
            status: "running",
            metadata: { port: options.port },
            close: async () => {}
          }
        }
      }
    }\n`,
  )
  fs.writeFileSync(
    path.join(root, 'extensions/task.ts'),
    `export const dataTask = {
      id: "data:task",
      title: "Data task",
      run: ({ args }) => ({ ok: true, args })
    }\n`,
  )
  fs.writeFileSync(
    path.join(root, 'extensions/action.ts'),
    `export default {
      id: "data:action",
      title: "Data action",
      run: ({ input }) => ({ input })
    }\n`,
  )
  fs.writeFileSync(
    path.join(root, 'extensions/service.ts'),
    `export default {
      id: "data:service",
      name: "Data service",
      kind: "custom",
      health: () => ({ status: "healthy", checkedAt: new Date(0).toISOString() })
    }\n`,
  )
  fs.writeFileSync(
    path.join(root, 'wsrt.yaml'),
    `workspace:
  packages: []
projects:
  fixture:
    root: .
    adapter: fixture-adapter
plugins:
  - path: ./extensions/plugin
    options:
      message: from-yaml
adapters:
  - path: ./extensions/adapter
    export: fixtureAdapter
    options:
      port: 4321
tasks:
  - path: ./extensions/task
    export: dataTask
actions:
  - ./extensions/action
services:
  - ./extensions/service
`,
  )

  const runtime = await createWorkspaceRuntime({ root })
  assert.equal(
    runtime.state.diagnostics.some((item) => item.code === 'plugin.data' && item.message === 'from-yaml'),
    true,
  )
  assert.deepEqual(await runtime.tasks.run('data:task', { args: ['x'] }), {
    ok: true,
    args: ['x'],
  })
  assert.deepEqual(await runtime.commands.run('data:action', { input: { value: 1 } }), {
    input: { value: 1 },
  })
  assert.equal(runtime.services.get('data:service').kind, 'custom')
  const handle = await runtime.runProject('fixture')
  assert.equal(handle.metadata.port, 4321)
})

test('data-only configs share interpolation, environment, runtime, and profile override resolution', async () => {
  const previousProfile = process.env.WSRT_PROFILE
  const previousDashboardUrl = process.env.WSRT_DASHBOARD_URL
  process.env.WSRT_PROFILE = 'local'
  process.env.WSRT_DASHBOARD_URL = 'https://dashboard.local'

  try {
    for (const [file, contents] of [
      [
        'wsrt.yaml',
        `workspace:
  packages: []
runtime:
  profile: \${env.WSRT_PROFILE}
dashboard:
  enabled: true
projects:
  dashboard:
    root: .
    adapter: node
    command: open \${dashboard.url} as \${runtime.profile}
mcp:
  enabled: true
  name: \${runtime.profile}-dashboard
profiles:
  local:
    dashboard:
      url: \${env.WSRT_DASHBOARD_URL}
`,
      ],
      [
        'wsrt.json',
        JSON.stringify({
          workspace: { packages: [] },
          runtime: { profile: '${env.WSRT_PROFILE}' },
          dashboard: { enabled: true },
          projects: {
            dashboard: {
              root: '.',
              adapter: 'node',
              command: 'open ${dashboard.url} as ${runtime.profile}',
            },
          },
          mcp: {
            enabled: true,
            name: '${runtime.profile}-dashboard',
          },
          profiles: {
            local: {
              dashboard: {
                url: '${env.WSRT_DASHBOARD_URL}',
              },
            },
          },
        }, null, 2),
      ],
    ]) {
      const root = fixture()
      fs.rmSync(path.join(root, 'wsrt.config.mjs'), { force: true })
      fs.writeFileSync(path.join(root, file), contents)

      const runtime = await createWorkspaceRuntime({ root })
      const project = runtime.state.projects.find((item) => item.name === 'dashboard')
      assert.equal(runtime.profile.name, 'local')
      assert.equal(runtime.config.raw.dashboard.url, 'https://dashboard.local')
      assert.equal(runtime.config.raw.mcp.name, 'local-dashboard')
      assert.equal(project.config.command, 'open https://dashboard.local as local')
    }
  } finally {
    if (previousProfile === undefined) delete process.env.WSRT_PROFILE
    else process.env.WSRT_PROFILE = previousProfile
    if (previousDashboardUrl === undefined) delete process.env.WSRT_DASHBOARD_URL
    else process.env.WSRT_DASHBOARD_URL = previousDashboardUrl
  }
})

test('project process environment resolves, inherits, masks, and spawns without shell prefixes', async () => {
  const root = fixture()
  fs.writeFileSync(
    path.join(root, 'print-env.mjs'),
    [
      'import fs from "node:fs"',
      'const keys = ["FROM_PARENT", "OVERRIDE_ME", "BOOL_TRUE", "BOOL_FALSE", "COUNT", "OMITTED_NULL", "OMITTED_UNDEFINED", "SECRET_TOKEN"]',
      'const values = Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]))',
      'fs.writeFileSync("env-output.json", JSON.stringify(values))',
    ].join('\n'),
  )
  const runtime = await createWorkspaceRuntime({
    root,
    inlineConfig: {
      workspace: { packages: [] },
      projects: {
        desktop: {
          root: '.',
          adapter: 'composite',
          environment: {
            FROM_PARENT: 'parent',
            OVERRIDE_ME: 'parent',
            OMITTED_UNDEFINED: 'remove-me',
          },
          processes: {
            electron: {
              root: '.',
              adapter: 'node',
              command: 'node ./print-env.mjs',
              environment: {
                OVERRIDE_ME: 'child',
                BOOL_TRUE: true,
                BOOL_FALSE: false,
                COUNT: 7,
                OMITTED_NULL: null,
                OMITTED_UNDEFINED: undefined,
                SECRET_TOKEN: 'top-secret',
              },
            },
          },
        },
      },
    },
  })

  const electron = runtime.query.projects().find((project) => project.name === 'desktop:electron')
  assert.equal(electron.config.command, 'node ./print-env.mjs')
  assert.equal(electron.config.environment, undefined)
  assert.equal(electron.environment.values.FROM_PARENT, 'parent')
  assert.equal(electron.environment.values.OVERRIDE_ME, 'child')
  assert.equal(electron.environment.values.BOOL_TRUE, '1')
  assert.equal(electron.environment.values.BOOL_FALSE, '0')
  assert.equal(electron.environment.values.COUNT, '7')
  assert.equal('OMITTED_NULL' in electron.environment.values, false)
  assert.equal('OMITTED_UNDEFINED' in electron.environment.values, false)
  assert.deepEqual(
    electron.environment.entries.find((entry) => entry.key === 'SECRET_TOKEN'),
    { key: 'SECRET_TOKEN', value: '********', masked: true, sensitive: true },
  )

  const spawnEnv = environmentForSpawn(electron.environment, {
    FROM_PARENT: 'base',
    OMITTED_NULL: 'base-null',
    OMITTED_UNDEFINED: 'base-undefined',
  })
  assert.equal(spawnEnv.FROM_PARENT, 'parent')
  assert.equal(spawnEnv.OMITTED_NULL, undefined)
  assert.equal(spawnEnv.OMITTED_UNDEFINED, undefined)

  const handle = await runtime.runProject('desktop')
  await waitForFile(path.join(root, 'env-output.json'))
  assert.equal(
    handle.metadata.processes[0].metadata.environment.entries.find(
      (entry) => entry.key === 'SECRET_TOKEN',
    ).value,
    '********',
  )
  await handle.close()
  const output = JSON.parse(fs.readFileSync(path.join(root, 'env-output.json'), 'utf8'))
  assert.deepEqual(output, {
    FROM_PARENT: 'parent',
    OVERRIDE_ME: 'child',
    BOOL_TRUE: '1',
    BOOL_FALSE: '0',
    COUNT: '7',
    OMITTED_NULL: null,
    OMITTED_UNDEFINED: null,
    SECRET_TOKEN: 'top-secret',
  })
})

test('JSON and YAML project environment interpolation resolves and reports unresolved tokens', async () => {
  for (const [file, contents] of [
    [
      'wsrt.yaml',
      `dashboardUrl: http://127.0.0.1:5177/__wsrt
projects:
  electron:
    root: .
    adapter: node
    command: node ./noop.mjs
    environment:
      DASHBOARD_URL: \${dashboardUrl}
      API_URL: http://localhost:\${server.port}
      MISSING_VALUE: \${services.api.port}
server:
  port: 8123
`,
    ],
    [
      'wsrt.json',
      JSON.stringify({
        dashboardUrl: 'http://127.0.0.1:5177/__wsrt',
        projects: {
          electron: {
            root: '.',
            adapter: 'node',
            command: 'node ./noop.mjs',
            environment: {
              DASHBOARD_URL: '${dashboardUrl}',
              API_URL: 'http://localhost:${server.port}',
              MISSING_VALUE: '${services.api.port}',
            },
          },
        },
        server: { port: 8123 },
      }, null, 2),
    ],
  ]) {
    const root = fixture()
    fs.rmSync(path.join(root, 'wsrt.config.mjs'), { force: true })
    fs.writeFileSync(path.join(root, file), contents)

    const runtime = await createWorkspaceRuntime({ root })
    const project = runtime.query.projects().find((item) => item.name === 'electron')
    assert.equal(project.environment.values.DASHBOARD_URL, 'http://127.0.0.1:5177/__wsrt')
    assert.equal(project.environment.values.API_URL, 'http://localhost:8123')
    assert.equal(project.environment.values.MISSING_VALUE, '')

    const diagnostic = runtime.state.diagnostics.find(
      (item) => item.code === 'config.environment_reference_unresolved',
    )
    assert.equal(diagnostic.project, 'electron')
    assert.equal(diagnostic.source, path.join(root, file))
    assert.equal(diagnostic.detail.key, 'MISSING_VALUE')
    assert.equal(diagnostic.detail.token, '${services.api.port}')
  }
})

test('module references resolve local plugin directories and package plugins with metadata', async () => {
  const root = fixture()
  fs.mkdirSync(path.join(root, 'plugins/local-plugin/src'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'plugins/local-plugin/package.json'),
    JSON.stringify({
      name: 'local-plugin-package',
      version: '1.2.3',
      description: 'Local plugin package',
      wsrt: {
        type: 'plugin',
        name: 'local-plugin',
        entry: './src/index.ts',
        capabilities: ['local'],
      },
    }, null, 2),
  )
  fs.writeFileSync(
    path.join(root, 'plugins/local-plugin/src/index.ts'),
    `export default function localPlugin(options) {
      return {
        name: "local-plugin",
        metadata: { description: "Local runtime plugin" },
        runtimeCreated({ runtime }) {
          runtime.diagnostics.add({ level: "info", code: "plugin.local", message: String(options.enabled) })
        }
      }
    }\n`,
  )
  fs.mkdirSync(path.join(root, 'node_modules/wsrt-plugin-package/dist'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'node_modules/wsrt-plugin-package/package.json'),
    JSON.stringify({
      name: 'wsrt-plugin-package',
      version: '4.5.6',
      description: 'Package plugin',
      type: 'module',
      exports: { '.': './dist/index.js' },
      wsrt: {
        type: 'plugin',
        name: 'package-plugin',
        entry: './dist/index.js',
        capabilities: ['package'],
      },
    }, null, 2),
  )
  fs.writeFileSync(
    path.join(root, 'node_modules/wsrt-plugin-package/dist/index.js'),
    `export default {
      name: "package-plugin",
      runtimeCreated({ runtime }) {
        runtime.diagnostics.add({ level: "info", code: "plugin.package", message: "package plugin ran" })
      }
    }\n`,
  )
  fs.writeFileSync(
    path.join(root, 'wsrt.yaml'),
    `workspace:
  packages: []
plugins:
  - path: ./plugins/local-plugin
    options:
      enabled: true
  - wsrt-plugin-package
`,
  )

  const runtime = await createWorkspaceRuntime({ root })
  assert.equal(
    runtime.state.diagnostics.some((item) => item.code === 'plugin.local' && item.message === 'true'),
    true,
  )
  assert.equal(
    runtime.state.diagnostics.some((item) => item.code === 'plugin.package'),
    true,
  )
  assert.equal(runtime.plugins.list().some((plugin) => plugin.name === 'local-plugin' && plugin.version === '1.2.3'), true)
  assert.equal(runtime.query.plugins().some((plugin) => plugin.name === 'package-plugin' && plugin.version === '4.5.6'), true)
  assert.deepEqual(runtime.query.plugins().find((plugin) => plugin.name === 'package-plugin').capabilities, ['package'])
})

test('data-only config module reference failures produce helpful diagnostics', async () => {
  const root = fixture()
  fs.writeFileSync(
    path.join(root, 'wsrt.json'),
    JSON.stringify({
      plugins: [{ path: './missing-plugin', export: 'missingExport' }],
    }),
  )

  const loaded = await loadWsrtConfig(root)
  const diagnostic = loaded.diagnostics.find(
    (item) => item.code === 'config.module_reference_failed',
  )
  assert.equal(Boolean(diagnostic), true)
  assert.equal(diagnostic.source, path.join(root, 'wsrt.json'))
  assert.equal(diagnostic.detail.field, 'plugins')
  assert.equal(diagnostic.detail.attempted, 'path')
  assert.equal(diagnostic.detail.expectedExport, 'missingExport')
  assert.match(diagnostic.detail.error, /Module path not found/)
})

test('remote module references fail with actionable diagnostics until remote loading is enabled', async () => {
  const root = fixture()
  fs.writeFileSync(
    path.join(root, 'wsrt.yaml'),
    'plugins:\n  - url: https://host.com/wsrt/plugins/my-plugin\n    options:\n      enabled: true\n',
  )

  const loaded = await loadWsrtConfig(root)
  const diagnostic = loaded.diagnostics.find(
    (item) => item.code === 'config.module_reference_failed',
  )
  assert.equal(Boolean(diagnostic), true)
  assert.equal(diagnostic.detail.attempted, 'url')
  assert.equal(diagnostic.detail.attemptedValue, 'https://host.com/wsrt/plugins/my-plugin')
  assert.match(diagnostic.detail.error, /Remote module references are not enabled yet/)
  assert.match(diagnostic.detail.error, /cache/)
})

test('tsconfig and manifest sync check drift and write configured files', async () => {
  const root = fixture()
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true } }, null, 2),
  )
  writeWsrtConfig(root, {
    tsconfig: '{ enabled: true, mode: "check", root: true, projects: false, paths: true }',
    manifests: '{ enabled: true, mode: "check", targets: ["wsrt"] }',
  })
  const runtime = await createWorkspaceRuntime({ root })

  const drift = await runtime.syncTsconfig('check')
  assert.equal(drift[0].status, 'drifted')
  const written = await runtime.syncTsconfig('write')
  assert.equal(written[0].status, 'written')
  const updatedTsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'))
  assert.equal(updatedTsconfig.compilerOptions.strict, true)
  assert.equal(
    updatedTsconfig.compilerOptions.paths['@scope/pkg-a'][0],
    './packages/pkg-a/src/index.ts',
  )

  const manifestDrift = await runtime.syncManifests('check')
  assert.equal(
    manifestDrift.some((item) => item.target === 'wsrt' && item.status === 'drifted'),
    true,
  )
  const manifestWritten = await runtime.syncManifests('write')
  assert.equal(
    manifestWritten.some((item) => item.target === 'wsrt' && item.status === 'written'),
    true,
  )
  assert.equal(fs.existsSync(path.join(root, '.wsrt/wsrt.manifest.json')), true)
})

test('artifacts and MCP tools use canonical runtime state', async () => {
  const root = fixture()
  writeWsrtConfig(root, {
    artifacts:
      '{ dir: "./.wsrt", report: true, graph: true, packages: true, aliases: true, diagnostics: true }',
  })
  const runtime = await createWorkspaceRuntime({ root })
  const artifacts = await runtime.generateArtifacts()

  assert.equal(
    artifacts.some((item) => item.kind === 'report' && item.status === 'written'),
    true,
  )
  assert.equal(fs.existsSync(path.join(root, '.wsrt/report.json')), true)
  assert.equal(fs.existsSync(path.join(root, '.wsrt/virtual/wsrt-packages.mjs')), true)
  assert.equal(
    runMcpTool(runtime, 'workspace.resolveImport', { specifier: '@scope/pkg-a' }).resolved,
    path.join(root, 'packages/pkg-a/src/index.ts'),
  )
  assert.equal(
    runMcpTool(runtime, 'workspace.packages', { query: 'pkg-b' })[0].name,
    '@scope/pkg-b',
  )
  assert.equal(runMcpTool(runtime, 'workspace.overview').packages, 2)
  assert.equal(
    runMcpTool(runtime, 'workspace.services').some((service) => service.id === 'project:webapp'),
    true,
  )
  assert.deepEqual(runMcpTool(runtime, 'workspace.dependencyQuery', { name: '@scope/pkg-a' }), [
    '@scope/pkg-b',
  ])
})

test('dashboard serves routed app, runtime APIs, graph data, theme code, and live events', async () => {
  const root = fixture()
  writeWsrtConfig(root, { dashboard: 'true' })
  const runtime = await createWorkspaceRuntime({ root })
  const dashboard = await startDashboard(runtime, { port: 0, basePath: '/__wsrt' })
  try {
    const index = await httpGet(`${dashboard.url}/`)
    const projects = await httpGet(`${dashboard.url}/projects`)
    const project = await httpGet(`${dashboard.url}/projects/webapp`)
    const graphPage = await httpGet(`${dashboard.url}/graph`)
    const diagnostics = await httpGet(`${dashboard.url}/diagnostics`)
    const servicesPage = await httpGet(`${dashboard.url}/services`)
    const stateClient = await httpGet(`${dashboard.url}/client/state.js`)
    const graphClient = await httpGet(`${dashboard.url}/client/components/wsrt-graph.js`)
    const diagnosticsClient = await httpGet(`${dashboard.url}/client/pages/diagnostics-page.js`)
    assert.match(index.body, /Workspace Runtime Dashboard/)
    assert.equal(stateClient.body.includes("localStorage.getItem('wsrt.theme')"), true)
    assert.equal(projects.body.includes('window.__WSRT_BASE__ = "/__wsrt"'), true)
    assert.equal(project.body.includes('window.__WSRT_BASE__ = "/__wsrt"'), true)
    assert.equal(graphPage.statusCode, 200)
    assert.match(graphClient.body, /class="graph"/)
    assert.match(diagnostics.body, /Workspace Runtime Dashboard/)
    assert.match(diagnosticsClient.body, /Diagnostics/)
    assert.match(servicesPage.body, /Workspace Runtime Dashboard/)

    const overview = JSON.parse((await httpGet(`${dashboard.url}/api/overview`)).body)
    const graph = JSON.parse((await httpGet(`${dashboard.url}/api/graph`)).body)
    const projectApi = JSON.parse((await httpGet(`${dashboard.url}/api/projects/webapp`)).body)
    const servicesApi = JSON.parse((await httpGet(`${dashboard.url}/api/services`)).body)
    const timelineApi = JSON.parse((await httpGet(`${dashboard.url}/api/timeline`)).body)
    const tasksApi = JSON.parse((await httpGet(`${dashboard.url}/api/tasks`)).body)
    const mcpApi = (await httpGet(`${dashboard.url}/api/mcp`)).body
    assert.equal(overview.counts.packages, 2)
    assert.equal(overview.counts.services >= 2, true)
    assert.equal(overview.status.environment, 'development')
    assert.equal(graph.nodes.length > 0, true)
    assert.equal(graph.edges.length > 0, true)
    assert.equal(projectApi.name, 'webapp')
    assert.equal(
      servicesApi.some((service) => service.id === 'project:webapp'),
      true,
    )
    assert.equal(timelineApi.some((entry) => entry.name === 'runtime:created'), true)
    assert.equal(tasksApi.some((task) => task.id === 'validate'), true)
    assert.equal(mcpApi.includes('<span class="badge'), false)
    assert.equal(index.body.includes('&lt;span class=&quot;badge'), false)

    const eventHeaders = await httpGetHeaders(`${dashboard.url}/events`)
    assert.equal(String(eventHeaders['content-type']).includes('text/event-stream'), true)
  } finally {
    await dashboard.close()
  }
})

test('Vite adapter config auto-injects plugin when user config has no WSRT plugin', async () => {
  const root = fixture()
  writeWsrtConfig(root)
  const runtime = await createWorkspaceRuntime({ root })
  const project = runtime.state.projects.find((item) => item.name === 'webapp')
  const orchestrated = await createOrchestratedViteConfig({ runtime, project })

  assert.equal(orchestrated.status.autoInjected, true)
  assert.equal(orchestrated.status.manualPluginDetected, false)
  assert.equal(hasWsrtVitePlugin(orchestrated.config.plugins), true)
  assert.equal(
    runtime.state.diagnostics.some((item) => item.code === 'vite.plugin.injected'),
    true,
  )
})

test('direct Vite plugin is optional and duplicate injection is avoided', async () => {
  const root = fixture()
  const pluginUrl = pathToFileURL(path.join(packageRoot, 'packages/plugin-vite/dist/index.js')).href
  fs.writeFileSync(
    path.join(root, 'apps/webapp/vite.config.mjs'),
    `import { wsrt } from "${pluginUrl}"; export default { plugins: [wsrt()] }\n`,
  )
  writeWsrtConfig(root)
  const runtime = await createWorkspaceRuntime({ root })
  const project = runtime.state.projects.find((item) => item.name === 'webapp')
  const orchestrated = await createOrchestratedViteConfig({ runtime, project })

  assert.equal(wsrt().name, 'wsrt')
  assert.equal(orchestrated.status.autoInjected, false)
  assert.equal(orchestrated.status.manualPluginDetected, true)
  assert.equal(orchestrated.status.duplicateInjectionAvoided, true)
})

test('Vite launched through WSRT resolves workspace imports without a manual WSRT plugin', async () => {
  const root = resolutionFixture()
  const runtime = await createWorkspaceRuntime({ root })
  const project = runtime.state.projects.find((item) => item.name === 'webapp')
  const orchestrated = await createOrchestratedViteConfig({ runtime, project })
  const importer = path.join(root, 'apps/webapp/src/main.ts')

  assert.equal(
    runtime.resolve('@workspace/runtime-api').resolved,
    path.join(root, 'packages/runtime-api/src/index.ts'),
  )
  assert.equal(
    runtime.resolve('@workspace/runtime-api/vue').resolved,
    path.join(root, 'packages/runtime-api/src/vue/index.ts'),
  )
  assert.equal(
    runtime.resolve('@workspace/ui/styles.css').resolved,
    path.join(root, 'packages/ui/src/styles/index.css'),
  )
  assert.equal(
    runtime.resolve('@workspace/server').resolved,
    path.join(root, 'packages/server/src/index.ts'),
  )
  assert.equal(orchestrated.status.autoInjected, true)

  const server = await createServer(orchestrated.config)
  try {
    await server.listen()
    const runtimeApi = await server.pluginContainer.resolveId(
      '@workspace/runtime-api',
      importer,
    )
    const runtimeApiVue = await server.pluginContainer.resolveId(
      '@workspace/runtime-api/vue',
      importer,
    )
    const styles = await server.pluginContainer.resolveId('@workspace/ui/styles.css', importer)
    const serverAlias = await server.pluginContainer.resolveId('@workspace/server', importer)

    assert.equal(runtimeApi?.id, path.join(root, 'packages/runtime-api/src/index.ts'))
    assert.equal(runtimeApiVue?.id, path.join(root, 'packages/runtime-api/src/vue/index.ts'))
    assert.equal(styles?.id, path.join(root, 'packages/ui/src/styles/index.css'))
    assert.equal(serverAlias?.id, path.join(root, 'packages/server/src/index.ts'))

    const transformed = await server.transformRequest('/src/main.ts')
    assert.equal(typeof transformed?.code, 'string')
    const virtualModule = await server.pluginContainer.resolveId('virtual:wsrt/packages', importer)
    assert.equal(virtualModule?.id, '\u0000virtual:wsrt/packages')
    const virtualLoaded = await server.pluginContainer.load('\u0000virtual:wsrt/packages')
    assert.match(
      typeof virtualLoaded === 'string' ? virtualLoaded : (virtualLoaded?.code ?? ''),
      /@workspace\/runtime-api/,
    )
    const viteUrl = server.resolvedUrls.local[0].replace(/\/$/, '')
    const dashboardResponse = await httpGet(`${viteUrl}/__wsrt/projects`)
    assert.equal(dashboardResponse.statusCode, 200)
    assert.match(dashboardResponse.body, /Workspace Runtime Dashboard/)
    const graphResponse = await httpGet(`${viteUrl}/__wsrt/api/graph`)
    assert.equal(graphResponse.statusCode, 200)
    assert.equal(JSON.parse(graphResponse.body).nodes.length > 0, true)
    assert.equal(
      runtime.state.diagnostics.some((item) => item.code === 'vite.alias.injected'),
      true,
    )
  } finally {
    await server.close()
  }
})

test('Electron-style desktop project injects resolver into renderer, main, and preload Vite targets', async () => {
  const root = resolutionFixture()
  const runtime = await createWorkspaceRuntime({ root })
  const desktop = runtime.state.projects.find((item) => item.name === 'desktop')
  const targets = ['renderer', 'main', 'preload'].map((name) => {
    const target = desktop.processes.find(
      (processProject) => processProject.name === `desktop:${name}`,
    )
    assert.equal(target?.adapter, 'vite')
    return target
  })

  for (const target of targets) {
    const orchestrated = await createOrchestratedViteConfig({ runtime, project: target })
    assert.equal(orchestrated.status.autoInjected, true)
    assert.equal(orchestrated.status.manualPluginDetected, false)

    const server = await createServer(orchestrated.config)
    try {
      const importer = path.join(
        target.root,
        'src',
        target.name.replace('desktop:', ''),
        'index.ts',
      )
      const runtimeApi = await server.pluginContainer.resolveId(
        '@workspace/runtime-api',
        importer,
      )
      const serverAlias = await server.pluginContainer.resolveId('@workspace/server', importer)
      assert.equal(runtimeApi?.id, path.join(root, 'packages/runtime-api/src/index.ts'))
      assert.equal(serverAlias?.id, path.join(root, 'packages/server/src/index.ts'))
    } finally {
      await server.close()
    }
  }

  for (const name of ['desktop:renderer', 'desktop:main', 'desktop:preload']) {
    assert.equal(
      runtime.state.diagnostics.some(
        (item) => item.code === 'vite.plugin.injected' && item.project === name,
      ),
      true,
    )
  }
})

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsrt-'))
  fs.mkdirSync(path.join(root, 'apps/webapp'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps/desktop'), { recursive: true })
  fs.mkdirSync(path.join(root, 'packages/pkg-a/src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'packages/pkg-b/src'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'apps/webapp/vite.config.mjs'),
    'export default { plugins: [] }\n',
  )
  fs.writeFileSync(
    path.join(root, 'apps/desktop/vite.config.mjs'),
    'export default { plugins: [] }\n',
  )
  fs.writeFileSync(path.join(root, 'packages/pkg-a/src/index.ts'), 'export const a = 1\n')
  fs.writeFileSync(path.join(root, 'packages/pkg-a/src/feature.ts'), 'export const feature = 1\n')
  fs.writeFileSync(path.join(root, 'packages/pkg-b/src/index.ts'), 'export const b = 1\n')
  writeJson(path.join(root, 'packages/pkg-a/package.json'), {
    name: '@scope/pkg-a',
    version: '1.0.0',
    dependencies: { '@scope/pkg-b': 'workspace:*' },
    exports: { '.': './src/index.ts', './feature': './src/feature.ts' },
  })
  writeJson(path.join(root, 'packages/pkg-b/package.json'), {
    name: '@scope/pkg-b',
    version: '1.0.0',
    exports: { '.': './src/index.ts' },
  })
  return root
}

function resolutionFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsrt-resolution-'))
  fs.mkdirSync(path.join(root, 'apps/webapp/src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps/desktop/src/renderer'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps/desktop/src/main'), { recursive: true })
  fs.mkdirSync(path.join(root, 'apps/desktop/src/preload'), { recursive: true })
  fs.mkdirSync(path.join(root, 'packages/runtime-api/src/vue'), { recursive: true })
  fs.mkdirSync(path.join(root, 'packages/ui/src/styles'), { recursive: true })
  fs.mkdirSync(path.join(root, 'packages/server/src'), { recursive: true })

  fs.writeFileSync(
    path.join(root, 'apps/webapp/vite.config.mjs'),
    'export default { plugins: [] }\n',
  )
  fs.writeFileSync(
    path.join(root, 'apps/desktop/vite.config.mjs'),
    'export default { plugins: [] }\n',
  )
  fs.writeFileSync(
    path.join(root, 'apps/desktop/vite.main.config.mjs'),
    'export default { plugins: [], build: { ssr: "./src/main/index.ts", rollupOptions: { external: ["electron"] } } }\n',
  )
  fs.writeFileSync(
    path.join(root, 'apps/desktop/vite.preload.config.mjs'),
    'export default { plugins: [], build: { lib: { entry: "./src/preload/index.ts", formats: ["cjs"], fileName: () => "index.cjs" }, rollupOptions: { external: ["electron"] } } }\n',
  )
  fs.writeFileSync(
    path.join(root, 'apps/webapp/src/main.ts'),
    [
      'import { createProjectRuntimeClient } from "@workspace/runtime-api"',
      'import { vueApi } from "@workspace/runtime-api/vue"',
      'import "@workspace/ui/styles.css"',
      'import { serverValue } from "@workspace/server"',
      'console.log(createProjectRuntimeClient, vueApi, serverValue)',
    ].join('\n'),
  )
  fs.writeFileSync(
    path.join(root, 'apps/desktop/src/renderer/index.ts'),
    [
      'import { createProjectRuntimeClient } from "@workspace/runtime-api"',
      'import { serverValue } from "@workspace/server"',
      'console.log(createProjectRuntimeClient, serverValue)',
    ].join('\n'),
  )
  fs.writeFileSync(
    path.join(root, 'apps/desktop/src/main/index.ts'),
    [
      'import { createProjectRuntimeClient } from "@workspace/runtime-api"',
      'import { serverValue } from "@workspace/server"',
      'console.log(createProjectRuntimeClient, serverValue)',
    ].join('\n'),
  )
  fs.writeFileSync(
    path.join(root, 'apps/desktop/src/preload/index.ts'),
    [
      'import { createProjectRuntimeClient } from "@workspace/runtime-api"',
      'import { serverValue } from "@workspace/server"',
      'console.log(createProjectRuntimeClient, serverValue)',
    ].join('\n'),
  )
  fs.writeFileSync(
    path.join(root, 'packages/runtime-api/src/index.ts'),
    'export const createProjectRuntimeClient = () => ({})\n',
  )
  fs.writeFileSync(
    path.join(root, 'packages/runtime-api/src/vue/index.ts'),
    'export const vueApi = true\n',
  )
  fs.writeFileSync(
    path.join(root, 'packages/ui/src/styles/index.css'),
    'body { color: black; }\n',
  )
  fs.writeFileSync(
    path.join(root, 'packages/server/src/index.ts'),
    'export const serverValue = true\n',
  )
  writeJson(path.join(root, 'packages/runtime-api/package.json'), {
    name: '@workspace/runtime-api',
    version: '1.0.0',
    type: 'module',
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './vue': { types: './dist/vue/index.d.ts', import: './dist/vue/index.js' },
    },
  })
  writeJson(path.join(root, 'packages/ui/package.json'), {
    name: '@workspace/ui',
    version: '1.0.0',
    type: 'module',
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './styles.css': './dist/styles.css',
    },
  })
  writeJson(path.join(root, 'packages/server/package.json'), {
    name: '@workspace/server',
    version: '1.0.0',
    type: 'module',
    exports: { '.': './dist/index.js' },
  })
  fs.writeFileSync(
    path.join(root, 'wsrt.config.mjs'),
    `export default {
    workspace: { packages: ["./packages/*"] },
    projects: {
      webapp: {
        root: "./apps/webapp",
        adapter: "vite",
        vite: { configFile: "./apps/webapp/vite.config.mjs" },
        server: { host: "127.0.0.1", port: 0 }
      },
      desktop: {
        root: "./apps/desktop",
        adapter: "composite",
        processes: [
          {
            name: "renderer",
            root: "./apps/desktop",
            adapter: "vite",
            vite: { configFile: "./apps/desktop/vite.config.mjs" },
            server: { host: "127.0.0.1", port: 0 }
          },
          {
            name: "main",
            root: "./apps/desktop",
            adapter: "vite",
            command: "build",
            vite: { configFile: "./apps/desktop/vite.main.config.mjs", command: "build" }
          },
          {
            name: "preload",
            root: "./apps/desktop",
            adapter: "vite",
            command: "build",
            vite: { configFile: "./apps/desktop/vite.preload.config.mjs", command: "build" }
          },
          {
            name: "electron",
            root: "./apps/desktop",
            adapter: "command",
            command: "node -e \\"setTimeout(() => {}, 1000)\\"",
            dependsOn: ["renderer", "main", "preload"]
          }
        ]
      }
    },
    extraAliases: {
      "@workspace/server": "./packages/server/src/index.ts",
      "@workspace/ui/styles.css": "./packages/ui/src/styles/index.css"
    },
    dashboard: true
  }\n`,
  )
  return root
}

function writeWsrtConfig(root, extras = {}) {
  fs.writeFileSync(
    path.join(root, 'wsrt.config.mjs'),
    `export default {
    workspace: { packages: ["packages/*"] },
    projects: {
      webapp: { root: "./apps/webapp", adapter: "vite", vite: { configFile: "./apps/webapp/vite.config.mjs" }, server: { port: 0 } },
      desktop: {
        root: "./apps/desktop",
        adapter: "composite",
        processes: [
          { name: "renderer", root: "./apps/desktop", adapter: "vite", vite: { configFile: "./apps/desktop/vite.config.mjs" }, server: { port: 0 } },
          { name: "electron", root: "./apps/desktop", adapter: "command", command: "node -e \\"setTimeout(() => {}, 1000)\\"", dependsOn: ["renderer"] }
        ]
      }
    },
    extraAliases: { "@extra": "./packages/pkg-b/src/index.ts" },
    ${Object.entries(extras)
      .map(([key, value]) => `${key}: ${value},`)
      .join('\n    ')}
    mcp: { enabled: true, name: "fixture" }
  }\n`,
  )
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

async function waitForFile(file, timeoutMs = 3000) {
  const start = Date.now()
  while (!fs.existsSync(file)) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${file}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () =>
          resolve({ statusCode: response.statusCode, headers: response.headers, body }),
        )
      })
      .on('error', reject)
  })
}

function httpGetHeaders(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      resolve(response.headers)
      request.destroy()
    })
    request.on('error', (error) => {
      if (error.code === 'ECONNRESET') return
      reject(error)
    })
  })
}
