import type { WsrtPlugin, WsrtPluginContext } from "@wsrt/types";

export type DashboardPluginPageWidget =
  | {
      kind: "metric";
      label: string;
      value: unknown;
      tone?: "neutral" | "ok" | "warning" | "error";
    }
  | { kind: "key-values"; title: string; values: Record<string, unknown> }
  | { kind: "table"; title: string; headers: string[]; rows: unknown[][] }
  | { kind: "badges"; title: string; values: unknown[] }
  | {
      kind: "actions";
      title: string;
      actions: Array<{
        label: string;
        action: string;
        id?: string;
        value?: string;
        disabled?: boolean;
      }>;
    }
  | { kind: "json"; title: string; data: unknown };

export type DashboardPluginPage = {
  id: string;
  title: string;
  subtitle?: string;
  plugin: string;
  widgets: DashboardPluginPageWidget[];
};

export interface WsrtDashboardPlugin extends WsrtPlugin {
  dashboardRoutes?: (
    routes: DashboardRoute[],
    context: WsrtPluginContext,
  ) => void | Promise<void>;
  dashboardPages?: (
    pages: DashboardPluginPage[],
    context: WsrtPluginContext,
  ) => void | Promise<void>;
}


export type DashboardRoute = {
  id: string
  label: string
  path: string
}