import type { WorkspaceDescribeResponse } from "@wsrt/workspace-session";

export type WorkspaceSnapshot = WorkspaceDescribeResponse["result"];
export type WorkspaceCapability = WorkspaceSnapshot["capabilities"][number];
