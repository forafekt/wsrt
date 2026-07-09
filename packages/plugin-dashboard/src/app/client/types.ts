declare global {
  interface Window {
    __WSRT_BASE__?: string
  }
}

export type DashboardRoute = string

export type GraphNode = {
  id: string
  label: string
  kind: 'project' | 'package' | string
  root?: string
  diagnostics?: string | number | boolean
}

export type GraphEdge = {
  from: string
  to: string
}

export type DashboardGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type DashboardState = {
  data: Record<string, any>
  route: DashboardRoute
  query: string
  theme: 'dark' | 'light'
  connected: boolean
  liveSignature: string
  refreshTimer: number
  severity?: string
  eventType?: string
  graph: {
    selected: string | null
    filter: string
    scale: number
    x: number
    y: number
  }
}

export {}
