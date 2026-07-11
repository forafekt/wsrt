import { spawnSync } from 'node:child_process'
import path from 'node:path'
import type { WsrtPlugin, WorkspaceRuntime } from '@wsrt/types'

type GitState = {
  detected: boolean
  root: string
  branch?: string
  latestCommit?: { hash: string; shortHash: string; subject: string; author?: string; date?: string }
  remoteUrl?: string
  changedFiles: string[]
  stagedFiles: string[]
  untrackedFiles: string[]
  recentCommits: Array<{ hash: string; shortHash: string; subject: string; author?: string; date?: string }>
}

export default function gitPlugin(): WsrtPlugin {
  return {
    name: 'git',
    runtimeCreated({ runtime }) {
      refreshGit(runtime)
      runtime.commands.register({
        id: 'git.refresh',
        title: 'Refresh Git status',
        description: 'Refresh read-only Git repository metadata.',
        run: ({ runtime: currentRuntime }) => refreshGit(currentRuntime),
      })
      runtime.tasks.register({
        id: 'git:status',
        title: 'Refresh Git status',
        description: 'Refresh and return branch, commit, and working tree metadata.',
        run: ({ runtime: currentRuntime }) => refreshGit(currentRuntime),
      })
    },
    custom({ runtime }) {
      runtime.state.dashboard.routes.push({ id: 'git', label: 'Git', path: '#git' })

    const state = runtime.query.plugin('git') as GitState | undefined
      if (!state?.detected) return
      runtime.state.dashboard.pages.push(gitDashboardPage(state))
    },
    mcpTools(entries) {
      entries.push({
        id: 'plugin.git',
        title: 'Git status',
        description: 'Return Git branch, commit, and working tree status.',
        kind: 'tool',
      })
    },
  }
}

export { gitPlugin }

function refreshGit(runtime: WorkspaceRuntime): GitState {
  const root = git(['rev-parse', '--show-toplevel'], runtime.root)
  const detected = Boolean(root)
  const state: GitState = detected
    ? {
        detected,
        root: root ?? runtime.root,
        branch: git(['branch', '--show-current'], runtime.root) || git(['rev-parse', '--short', 'HEAD'], runtime.root),
        latestCommit: parseCommit(git(['log', '-1', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%cI'], runtime.root)),
        remoteUrl: git(['config', '--get', 'remote.origin.url'], runtime.root),
        ...parseStatus(git(['status', '--porcelain=v1'], runtime.root)),
        recentCommits: (git(['log', '-8', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%cI'], runtime.root) ?? '')
          .split('\n')
          .map(parseCommit)
          .filter((commit): commit is NonNullable<GitState['latestCommit']> => Boolean(commit)),
      }
    : {
        detected,
        root: runtime.root,
        changedFiles: [],
        stagedFiles: [],
        untrackedFiles: [],
        recentCommits: [],
      }
  runtime.setPluginData('git', 'state', state)
  if (state.detected) {
    runtime.events.emit('git:repository-detected', { root: state.root, branch: state.branch })
    runtime.events.emit('git:status-refreshed', {
      root: state.root,
      changed: state.changedFiles.length,
      staged: state.stagedFiles.length,
      untracked: state.untrackedFiles.length,
    })
    upsertGraph(runtime, state)
  }
  return state
}

function parseStatus(output?: string): Pick<GitState, 'changedFiles' | 'stagedFiles' | 'untrackedFiles'> {
  const changedFiles: string[] = []
  const stagedFiles: string[] = []
  const untrackedFiles: string[] = []
  for (const line of (output ?? '').split('\n').filter(Boolean)) {
    const index = line[0]
    const worktree = line[1]
    const file = line.slice(3)
    if (line.startsWith('??')) untrackedFiles.push(file)
    else {
      if (index !== ' ') stagedFiles.push(file)
      if (worktree !== ' ') changedFiles.push(file)
    }
  }
  return { changedFiles, stagedFiles, untrackedFiles }
}

function parseCommit(line?: string): GitState['latestCommit'] | undefined {
  if (!line) return undefined
  const [hash, shortHash, subject, author, date] = line.split('\x1f')
  return hash ? { hash, shortHash, subject, author, date } : undefined
}

function git(args: string[], cwd: string): string | undefined {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) return undefined
  return result.stdout.trim() || undefined
}

function upsertGraph(runtime: WorkspaceRuntime, state: GitState): void {
  const id = `git:${state.branch ?? 'repository'}`
  if (!runtime.state.graph.nodes.some((node) => node.id === id))
    runtime.state.graph.nodes.push({ id, root: state.root, kind: 'git', metadata: { branch: state.branch, commit: state.latestCommit?.shortHash } })
  for (const pkg of runtime.state.packages) {
    if (path.relative(state.root, pkg.root).startsWith('..')) continue
    const edge = { from: id, to: pkg.name, type: 'git:tracks', metadata: { root: pkg.root } }
    if (!runtime.state.graph.edges.some((item) => item.from === edge.from && item.to === edge.to && item.type === edge.type))
      runtime.state.graph.edges.push(edge)
  }
}

type DashboardPluginPage = Record<string, unknown>
function gitDashboardPage(state: GitState): DashboardPluginPage {
  return {
    id: 'git',
    title: 'Git',
    subtitle: state.remoteUrl || state.root,
    plugin: 'git',
    widgets: [
      { kind: 'metric', label: 'Changed', value: state.changedFiles.length },
      { kind: 'metric', label: 'Staged', value: state.stagedFiles.length },
      { kind: 'metric', label: 'Untracked', value: state.untrackedFiles.length },
      {
        kind: 'key-values',
        title: 'Repository',
        values: {
          Branch: state.branch,
          Commit: state.latestCommit?.shortHash,
          Subject: state.latestCommit?.subject,
          Remote: state.remoteUrl || 'none',
        },
      },
      {
        kind: 'actions',
        title: 'Actions',
        actions: [
          { label: 'Refresh', action: 'command:run', id: 'git.refresh' },
          { label: 'Copy branch', action: 'copy', value: state.branch },
          { label: 'Copy commit', action: 'copy', value: state.latestCommit?.hash },
        ],
      },
      { kind: 'table', title: 'Working tree', headers: ['Kind', 'File'], rows: fileRows(state) },
      {
        kind: 'table',
        title: 'Recent commits',
        headers: ['Commit', 'Subject', 'Author', 'Date'],
        rows: state.recentCommits.map((commit) => [commit.shortHash, commit.subject, commit.author ?? '', commit.date ?? '']),
      },
      { kind: 'json', title: 'Advanced', data: state },
    ],
  }
}

function fileRows(state: GitState): unknown[][] {
  return [
    ...state.stagedFiles.map((file) => ['staged', file]),
    ...state.changedFiles.map((file) => ['changed', file]),
    ...state.untrackedFiles.map((file) => ['untracked', file]),
  ]
}
