import type cytoscape from 'cytoscape'
import type { EdgeTier, GraphEdgeData, GraphNodeData } from '../api/types'

/** Design-token palette for the graph (sanctioned hexes from theme.css). */
export const GRAPH_COLORS = {
  victim: '#2f6fed',
  mule: '#e5484d',
  suspect: '#f5a623',
  other: '#6b7280',
  edge: '#9ca3af',
  loop: '#e5484d',
  label: '#16161d',
  ownBorder: '#16161d',
}

export type NodeRole = 'victim' | 'mule' | 'suspect' | 'other'

export const ROLE_LABEL: Record<NodeRole, string> = {
  victim: 'Victim',
  mule: 'Mule',
  suspect: 'Suspect',
  other: '—',
}

/** Sort weight: most suspicious first (mule → suspect → victim → other). */
export const SUSPICION_ORDER: Record<NodeRole, number> = {
  mule: 0,
  suspect: 1,
  victim: 2,
  other: 3,
}

/** One neighbouring account and every transfer between it and the clicked node. */
export interface NodeConnection {
  account: string
  totalIn: number
  totalOut: number
  transfers: Array<{
    dir: 'in' | 'out'
    amount: string
    when: string
    tier: EdgeTier
    channel: string
    reference: string | null
  }>
}

/**
 * Officer-facing roles derived from analysis fields the backend already
 * publishes: mule = high suspicion (round-trip member or accumulator),
 * suspect = medium suspicion (3+ flags), victim = the unsuspicious own
 * account that sends the most money toward mule/suspect accounts.
 */
export function deriveRoles(
  nodes: Array<{ data: GraphNodeData }>,
  edges: Array<{ data: GraphEdgeData }>,
): Map<string, NodeRole> {
  const roles = new Map<string, NodeRole>()
  for (const { data } of nodes) {
    if (data.suspicion === 'high') roles.set(data.id, 'mule')
    else if (data.suspicion === 'medium') roles.set(data.id, 'suspect')
    else roles.set(data.id, 'other')
  }
  // Money each clean own-account sends into suspicious hands.
  const sentToSuspicious = new Map<string, number>()
  for (const { data } of edges) {
    const targetRole = roles.get(data.target)
    if (targetRole === 'mule' || targetRole === 'suspect') {
      sentToSuspicious.set(
        data.source,
        (sentToSuspicious.get(data.source) ?? 0) + Number(data.amount),
      )
    }
  }
  let victimId: string | null = null
  let victimSent = 0
  for (const { data } of nodes) {
    if (!data.own_account || data.suspicion !== 'low' || data.accumulator) continue
    const sent = sentToSuspicious.get(data.id) ?? 0
    if (sent > victimSent) {
      victimSent = sent
      victimId = data.id
    }
  }
  if (victimId) roles.set(victimId, 'victim')
  return roles
}

export function buildGraphStylesheet(): cytoscape.StylesheetJson {
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'font-size': 11,
        color: GRAPH_COLORS.label,
        'text-valign': 'bottom',
        'text-margin-y': 6,
        width: 'data(size)',
        height: 'data(size)',
        shape: (el: cytoscape.NodeSingular) =>
          el.data('role') === 'victim' ? 'star' : 'ellipse',
        'background-color': (el: cytoscape.NodeSingular) =>
          GRAPH_COLORS[el.data('role') as NodeRole] ?? GRAPH_COLORS.other,
        'border-width': (el: cytoscape.NodeSingular) => (el.data('own_account') ? 4 : 0),
        'border-color': GRAPH_COLORS.ownBorder,
      },
    },
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier',
        'target-arrow-shape': 'triangle',
        width: 'data(width)',
        'line-color': GRAPH_COLORS.edge,
        'target-arrow-color': GRAPH_COLORS.edge,
        // 3 evidence tiers, 3 line styles an officer can tell apart at a glance:
        // solid = confirmed (same UTR both statements), dashed = probable
        // (amount+time match), dotted = one-sided (only one statement in case)
        'line-style': (el: cytoscape.EdgeSingular) =>
          el.data('tier') === 'probable'
            ? 'dashed'
            : el.data('tier') === 'external'
              ? 'dotted'
              : 'solid',
      },
    },
    {
      selector: '.loop-highlight',
      style: {
        'line-color': GRAPH_COLORS.loop,
        'target-arrow-color': GRAPH_COLORS.loop,
        width: 6,
        'z-index': 10,
        // marching-ants animation: dash pattern whose offset is advanced on a
        // timer so the officer literally sees the money travel around the loop
        'line-style': 'dashed',
        'line-dash-pattern': [10, 5],
        label: 'data(hopOrder)',
        'font-size': 16,
        'font-weight': 'bold',
        color: GRAPH_COLORS.loop,
        'text-background-color': '#ffffff',
        'text-background-opacity': 1,
        'text-background-padding': '3px',
        'text-background-shape': 'roundrectangle',
      },
    },
    {
      selector: '.loop-node',
      style: { 'background-color': GRAPH_COLORS.loop },
    },
    // Clicked node + its neighbourhood: soft halo glow, green = money coming
    // in to the clicked account, red = money going out of it.
    {
      selector: '.focus-node',
      style: {
        'underlay-color': '#2f6fed',
        'underlay-opacity': 0.3,
        'underlay-padding': 12,
      },
    },
    {
      selector: '.neighbor-node',
      style: {
        'underlay-color': '#f5a623',
        'underlay-opacity': 0.35,
        'underlay-padding': 8,
      },
    },
    {
      selector: '.neighbor-in',
      style: {
        'line-color': '#2fc5a0',
        'target-arrow-color': '#2fc5a0',
        width: 4,
        'z-index': 9,
      },
    },
    {
      selector: '.neighbor-out',
      style: {
        'line-color': '#e5484d',
        'target-arrow-color': '#e5484d',
        width: 4,
        'z-index': 9,
      },
    },
    { selector: '.dimmed', style: { opacity: 0.15 } },
    // Bottom-bar filters (amount slider / txn-type chips) hide non-matching
    // elements entirely; removing the class restores them untouched.
    { selector: '.filter-hidden', style: { display: 'none' } },
    // "Show layers" view: hop-distance rings from the selected account.
    // Layer 1 violet, layer 2 amber, layer 3 grey; deeper nodes fade out.
    {
      selector: '.layer-1',
      style: { 'underlay-color': '#8b7cf6', 'underlay-opacity': 0.35, 'underlay-padding': 8 },
    },
    {
      selector: '.layer-2',
      style: { 'underlay-color': '#f5a623', 'underlay-opacity': 0.3, 'underlay-padding': 6 },
    },
    {
      selector: '.layer-3',
      style: { 'underlay-color': '#9ca3af', 'underlay-opacity': 0.3, 'underlay-padding': 5 },
    },
  ]
}

/** Cytoscape node elements (with role + size attached) from a CaseGraph. */
export function graphElements(
  nodes: Array<{ data: GraphNodeData }>,
  edges: Array<{ data: GraphEdgeData }>,
  roles: Map<string, NodeRole>,
) {
  const maxThroughput = Math.max(
    1,
    ...nodes.map((n) => Number(n.data.inflow) + Number(n.data.outflow)),
  )
  const maxAmount = Math.max(1, ...edges.map((e) => Number(e.data.amount)))
  return {
    nodes: nodes.map((n) => ({
      data: {
        ...n.data,
        role: roles.get(n.data.id) ?? 'other',
        size: 28 + 42 * ((Number(n.data.inflow) + Number(n.data.outflow)) / maxThroughput),
      },
    })),
    edges: edges.map((e) => ({
      data: { ...e.data, width: 1.5 + 4.5 * (Number(e.data.amount) / maxAmount) },
    })),
  }
}
