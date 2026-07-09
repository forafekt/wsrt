import fs from 'node:fs'
import path from 'node:path'
import type { RuntimeArtifact, WorkspaceRuntime } from '@wsrt/types'
import { createWsrtReport } from '@wsrt/reports'

export async function generateArtifacts(runtime: WorkspaceRuntime): Promise<RuntimeArtifact[]> {
  const config = runtime.config.raw
  const dir = path.resolve(
    runtime.state.root,
    typeof config.artifacts?.dir === 'string' ? config.artifacts.dir : '.wsrt',
  )
  const pretty = config.report?.pretty !== false
  const artifacts: RuntimeArtifact[] = []
  if (config.artifacts?.report !== false)
    artifacts.push(
      writeArtifact(
        'report',
        config.report?.file
          ? path.resolve(runtime.state.root, config.report.file)
          : path.join(dir, 'report.json'),
        createWsrtReport(runtime),
        pretty,
      ),
    )
  if (config.artifacts?.graph !== false)
    artifacts.push(
      writeArtifact('graph', path.join(dir, 'graph.json'), runtime.state.graph, pretty),
    )
  if (config.artifacts?.packages !== false)
    artifacts.push(
      writeArtifact('packages', path.join(dir, 'packages.json'), runtime.state.packages, pretty),
    )
  if (config.artifacts?.aliases !== false)
    artifacts.push(
      writeArtifact('aliases', path.join(dir, 'aliases.json'), runtime.state.aliases, pretty),
    )
  if (config.artifacts?.diagnostics !== false)
    artifacts.push(
      writeArtifact(
        'diagnostics',
        path.join(dir, 'diagnostics.json'),
        runtime.state.diagnostics,
        pretty,
      ),
    )
  for (const virtualImport of runtime.state.virtualImports.imports) {
    if (!virtualImport.file) continue
    artifacts.push(
      writeTextArtifact(
        `virtual:${virtualImport.id}`,
        virtualImport.file,
        virtualImport.contents,
        'virtual',
      ),
    )
  }
  runtime.state.artifacts = artifacts
  return artifacts
}

function writeArtifact(id: string, file: string, value: unknown, pretty: boolean): RuntimeArtifact {
  return writeTextArtifact(
    id,
    file,
    `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`,
    artifactKind(id),
  )
}

function writeTextArtifact(
  id: string,
  file: string,
  contents: string,
  kind: RuntimeArtifact['kind'],
): RuntimeArtifact {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
    return { id, file, kind, status: 'written', bytes: Buffer.byteLength(contents) }
  } catch (cause) {
    return {
      id,
      file,
      kind,
      status: 'error',
      message: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

function artifactKind(id: string): RuntimeArtifact['kind'] {
  if (
    id === 'report' ||
    id === 'graph' ||
    id === 'packages' ||
    id === 'aliases' ||
    id === 'diagnostics'
  )
    return id
  return 'manifest'
}
