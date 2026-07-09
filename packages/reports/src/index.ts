import type { WorkspaceRuntime, WorkspaceRuntimeState } from '@wsrt/types'

export function createWsrtReport(runtime: WorkspaceRuntime): WorkspaceRuntimeState {
  return runtime.inspect()
}
