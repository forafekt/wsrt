import type { DashboardGraph } from '../types.js'
import { esc, escAttr, kv, list } from '../lib/html.js'
import { state } from '../state.js'

export class WSRTGraph extends HTMLElement {
  private layoutCacheKey = ''
  private layoutCache: Record<string, { x: number; y: number }> = {}
  private delegatedBound = false

  connectedCallback(): void {
    this.render()
    this.bind()
  }

  render(): void {
    const graph = (state.data.graph || { nodes: [], edges: [] }) as DashboardGraph
    this.innerHTML = '<div class="filters graph-filters"><input id="graph-filter" value="' + esc(state.graph.filter) + '" placeholder="Search nodes by name or type"><button class="icon-button" id="graph-fit" title="Fit graph">⌖</button><button class="control-button" data-action="graph:export" data-id="graph">Export</button></div><div class="graph-shell"><div class="graph-stage"><div class="graph-toolbar"><button id="zoom-in">+</button><button id="zoom-out">−</button><button id="zoom-reset">Reset</button></div><svg class="graph" id="graph-svg" role="img" aria-label="Dependency graph">' + this.graphSvg(graph) + '</svg></div><div class="card graph-panel"><h3>Inspector</h3><div class="legend">' + this.legend(graph) + '</div><div id="graph-details">' + this.graphDetails(graph) + '</div></div></div>'
  }

  bind(): void {
    if (!this.delegatedBound) {
      this.delegatedBound = true
      this.addEventListener('click', (event) => {
        const target = event.target as Element
        const nodeButton = target.closest?.('.link-button[data-node]') as HTMLElement | null
        if (nodeButton?.dataset.node) {
          event.preventDefault()
          this.selectGraphNode(nodeButton.dataset.node)
          return
        }
        const routeButton = target.closest?.('[data-go]') as HTMLElement | null
        if (routeButton?.dataset.go) {
          event.preventDefault()
          window.dispatchEvent(new CustomEvent('wsrt:go', { detail: routeButton.dataset.go }))
        }
      })
    }

    this.querySelector<HTMLInputElement>('#graph-filter')?.addEventListener('input', (event) => {
      state.graph.filter = (event.target as HTMLInputElement).value.toLowerCase()
      state.graph.selected = null
      this.render()
      this.bind()
    })

    this.querySelector('#graph-fit')?.addEventListener('click', () => this.resetTransform())
    this.querySelector('#zoom-in')?.addEventListener('click', () => { state.graph.scale *= 1.18; this.applyGraphTransform() })
    this.querySelector('#zoom-out')?.addEventListener('click', () => { state.graph.scale /= 1.18; this.applyGraphTransform() })
    this.querySelector('#zoom-reset')?.addEventListener('click', () => this.resetTransform())

    const svg = this.querySelector<SVGSVGElement>('#graph-svg')
    if (!svg) return

    svg.addEventListener('click', (event) => {
      const target = (event.target as Element).closest?.('[data-node]') as HTMLElement | null
      if (target) {
        event.stopPropagation()
        this.selectGraphNode(target.dataset.node || '')
        return
      }
      this.clearGraphSelection()
    })

    let start: null | { x: number; y: number; gx: number; gy: number } = null

    svg.addEventListener('pointerdown', (event) => {
      if ((event.target as Element).closest?.('[data-node]')) return
      start = { x: event.clientX, y: event.clientY, gx: state.graph.x, gy: state.graph.y }
      svg.setPointerCapture(event.pointerId)
    })

    svg.addEventListener('pointermove', (event) => {
      if (!start) return
      state.graph.x = start.gx + event.clientX - start.x
      state.graph.y = start.gy + event.clientY - start.y
      this.applyGraphTransform()
    })

    svg.addEventListener('pointerup', () => { start = null })
    svg.addEventListener('pointercancel', () => { start = null })
    svg.addEventListener('wheel', (event) => {
      event.preventDefault()
      state.graph.scale *= event.deltaY > 0 ? 0.9 : 1.1
      this.applyGraphTransform()
    }, { passive: false })
  }

  resetTransform(): void {
    state.graph.scale = 1
    state.graph.x = 0
    state.graph.y = 0
    this.applyGraphTransform()
  }

  clearGraphSelection(): void {
    state.graph.selected = null
    this.querySelectorAll('[data-node]').forEach((node) => {
      node.classList.remove('selected')
      node.setAttribute('opacity', '1')
    })
    this.querySelectorAll('[data-edge] .edge').forEach((edge) => edge.classList.remove('highlight'))

    const graph = (state.data.graph || { nodes: [], edges: [] }) as DashboardGraph
    const details = this.querySelector('#graph-details')
    if (details) details.innerHTML = this.graphDetails(graph)
  }

  applyGraphTransform(): void {
    const viewport = this.querySelector('#graph-viewport')
    if (viewport) viewport.setAttribute('transform', 'translate(' + state.graph.x + ' ' + state.graph.y + ') scale(' + state.graph.scale + ')')
  }

  selectGraphNode(id: string): void {
    state.graph.selected = id
    const graph = (state.data.graph || { nodes: [], edges: [] }) as DashboardGraph
    const related = new Set(graph.edges.filter((edge) => edge.from === id || edge.to === id).flatMap((edge) => [edge.from, edge.to]))

    this.querySelectorAll<HTMLElement>('[data-node]').forEach((node) => {
      const active = node.dataset.node === id
      node.classList.toggle('selected', active)
      node.setAttribute('opacity', id && !active && !related.has(node.dataset.node || '') ? '0.35' : '1')
    })

    this.querySelectorAll<HTMLElement>('[data-edge]').forEach((edge) => {
      edge.querySelector('.edge')?.classList.toggle('highlight', edge.dataset.from === id || edge.dataset.to === id)
    })

    const details = this.querySelector('#graph-details')
    if (details) details.innerHTML = this.graphDetails(graph)
  }

  graphSvg(graph: DashboardGraph): string {
    const nodes = graph.nodes.filter((node) => !state.graph.filter || (node.label + node.kind).toLowerCase().includes(state.graph.filter))
    const nodeIds = new Set(nodes.map((node) => node.id))
    const edges = graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    if (!nodes.length) return '<text x="40" y="80" fill="currentColor">No matching graph nodes</text>'

    const positions = this.layout(nodes)
    const selected = state.graph.selected
    const related = new Set(edges.filter((edge) => edge.from === selected || edge.to === selected).flatMap((edge) => [edge.from, edge.to]))
    const edgeSvg = edges.map((edge) => {
      const a = positions[edge.from]
      const b = positions[edge.to]
      const mx = Math.round((a.x + b.x) / 2)
      const my = Math.round((a.y + b.y) / 2)
      return '<g data-edge data-from="' + escAttr(edge.from) + '" data-to="' + escAttr(edge.to) + '"><line class="edge ' + (edge.from === selected || edge.to === selected ? 'highlight' : '') + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"></line><text class="edge-label" x="' + mx + '" y="' + my + '">' + esc((edge as any).type || '') + '</text></g>'
    }).join('')

    const nodeSvg = nodes.map((node) => {
      const p = positions[node.id]
      const active = selected === node.id
      const dim = selected && !active && !related.has(node.id) ? ' opacity="0.35"' : ''
      const radius = node.kind === 'project' ? 20 : node.kind === 'service' ? 17 : 15
      return '<g class="node ' + node.kind + (node.diagnostics ? ' problem' : '') + (active ? ' selected' : '') + '" tabindex="0" role="button" transform="translate(' + p.x + ' ' + p.y + ')" data-node="' + escAttr(node.id) + '"' + dim + '><circle r="' + radius + '"></circle>' + (node.diagnostics ? '<text class="node-badge" x="-4" y="4">!</text>' : '') + '<text x="24" y="4">' + esc(node.label) + '</text></g>'
    }).join('')

    return '<g id="graph-viewport" transform="translate(' + state.graph.x + ' ' + state.graph.y + ') scale(' + state.graph.scale + ')">' + edgeSvg + nodeSvg + '</g>'
  }

  layout(nodes: DashboardGraph['nodes']): Record<string, { x: number; y: number }> {
    const key = nodes.map((node) => node.id + ':' + node.kind).join('|')
    if (key === this.layoutCacheKey) return this.layoutCache
    const positions: Record<string, { x: number; y: number }> = {}
    const centerX = 420
    const centerY = 300
    const byKind = nodes.reduce<Record<string, DashboardGraph['nodes']>>((acc, node) => {
      const kind = node.kind || 'node'
      acc[kind] = acc[kind] || []
      acc[kind].push(node)
      return acc
    }, {})
    const kindNames = Object.keys(byKind).sort()
    const baseRadius = Math.max(150, nodes.length * 12)
    kindNames.forEach((kind, kindIndex) => {
      const group = byKind[kind]
      const ring = kind === 'project' ? baseRadius * 0.38 : baseRadius * (0.7 + kindIndex * 0.22)
      group.forEach((node, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(group.length, 1) + kindIndex * 0.35
        positions[node.id] = { x: Math.round(centerX + Math.cos(angle) * ring), y: Math.round(centerY + Math.sin(angle) * ring) }
      })
    })
    this.layoutCacheKey = key
    this.layoutCache = positions
    return positions
  }

  graphDetails(graph: DashboardGraph): string {
    const id = state.graph.selected
    if (!id) return '<div class="empty">Select a node to inspect dependencies and dependents.</div>'

    const node = graph.nodes.find((item) => item.id === id)
    if (!node) return '<div class="empty">Selected node is filtered out.</div>'

    const dependencies = graph.edges.filter((edge) => edge.from === id).map((edge) => edge.to)
    const dependents = graph.edges.filter((edge) => edge.to === id).map((edge) => edge.from)
    const route = node.kind === 'project'
      ? '/projects/' + encodeURIComponent(node.label)
      : node.kind === 'package'
        ? '/packages/' + encodeURIComponent(node.id)
        : ''
    return kv({ Name: node.label, Kind: node.kind, Root: node.root, Diagnostics: node.diagnostics }) +
      (route ? '<div class="control-row"><button class="control-button" data-go="' + escAttr(route) + '">Open</button></div>' : '') +
      '<h4>Dependencies</h4>' + list(dependencies.map((id) => '<button class="link-button" data-node="' + escAttr(id) + '">' + esc(id) + '</button>')) +
      '<h4>Dependents</h4>' + list(dependents.map((id) => '<button class="link-button" data-node="' + escAttr(id) + '">' + esc(id) + '</button>'))
  }

  legend(graph: DashboardGraph): string {
    const counts = graph.nodes.reduce<Record<string, number>>((acc, node) => {
      acc[node.kind] = (acc[node.kind] || 0) + 1
      return acc
    }, {})
    return Object.entries(counts).map(([kind, count]) => '<span class="legend-item ' + esc(kind) + '"><i></i>' + esc(kind) + '<strong>' + count + '</strong></span>').join('')
  }
}

customElements.define('wsrt-graph', WSRTGraph)
