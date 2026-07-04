import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useSearchParams } from 'react-router-dom'
import cytoscape from 'cytoscape'
import type { Core, EventObject } from 'cytoscape'
import { api } from '../api/client'
import type {
  CaseGraph,
  CaseOut,
  EdgeTier,
  GraphEdgeData,
  GraphNodeData,
  RoundTrip,
} from '../api/types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { NodeDrawer, EdgeDrawer } from '../components/GraphDrawers'
import { formatINR } from '../lib/format'
import { fadeIn, staggerContainer } from '../theme/motion'

/** Design-token palette for the graph (sanctioned hexes from theme.css). */
const COLORS = {
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

/**
 * Officer-facing roles derived from analysis fields the backend already
 * publishes: mule = high suspicion (round-trip member or accumulator),
 * suspect = medium suspicion (3+ flags), victim = the unsuspicious own
 * account that sends the most money toward mule/suspect accounts.
 */
function deriveRoles(
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

function buildStylesheet(): cytoscape.StylesheetJson {
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'font-size': 11,
        color: COLORS.label,
        'text-valign': 'bottom',
        'text-margin-y': 6,
        width: 'data(size)',
        height: 'data(size)',
        shape: (el: cytoscape.NodeSingular) =>
          el.data('role') === 'victim' ? 'star' : 'ellipse',
        'background-color': (el: cytoscape.NodeSingular) =>
          COLORS[el.data('role') as NodeRole] ?? COLORS.other,
        'border-width': (el: cytoscape.NodeSingular) => (el.data('own_account') ? 4 : 0),
        'border-color': COLORS.ownBorder,
      },
    },
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier',
        'target-arrow-shape': 'triangle',
        width: 'data(width)',
        'line-color': COLORS.edge,
        'target-arrow-color': COLORS.edge,
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
        'line-color': COLORS.loop,
        'target-arrow-color': COLORS.loop,
        width: 6,
        'z-index': 10,
        // marching-ants animation: dash pattern whose offset is advanced on a
        // timer so the officer literally sees the money travel around the loop
        'line-style': 'dashed',
        'line-dash-pattern': [10, 5],
        label: 'data(hopOrder)',
        'font-size': 16,
        'font-weight': 'bold',
        color: COLORS.loop,
        'text-background-color': '#ffffff',
        'text-background-opacity': 1,
        'text-background-padding': '3px',
        'text-background-shape': 'roundrectangle',
      },
    },
    {
      selector: '.loop-node',
      style: { 'background-color': COLORS.loop },
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
  ]
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

export function FlowGraphPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [cases, setCases] = useState<CaseOut[] | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const caseId = searchParams.get('case')
  const [graph, setGraph] = useState<CaseGraph | null>(null)
  const [notAnalyzed, setNotAnalyzed] = useState(false)
  const [roundTrips, setRoundTrips] = useState<RoundTrip[]>([])
  /** Which round trip is lit up: a loop_id, 'all', or null (none). */
  const [activeLoop, setActiveLoop] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeData | null>(null)
  const [accountQuery, setAccountQuery] = useState('')

  const roles = useMemo(
    () => (graph ? deriveRoles(graph.nodes, graph.edges) : new Map<string, NodeRole>()),
    [graph],
  )

  /** Accounts list for the side panel: victim first, then mules, suspects, rest. */
  const accountList = useMemo(() => {
    if (!graph) return []
    const order: Record<NodeRole, number> = { victim: 0, mule: 1, suspect: 2, other: 3 }
    const q = accountQuery.trim().toLowerCase()
    return graph.nodes
      .map((n) => ({ ...n.data, role: roles.get(n.data.id) ?? ('other' as NodeRole) }))
      .filter((n) => !q || n.label.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          order[a.role] - order[b.role] ||
          Number(b.inflow) + Number(b.outflow) - (Number(a.inflow) + Number(a.outflow)),
      )
  }, [graph, roles, accountQuery])

  /** Same effect as tapping the node on the canvas, plus centre the graph on it. */
  const focusAccount = useCallback((id: string) => {
    const cy = cyRef.current
    if (!cy) return
    const el = cy.getElementById(id)
    if (el.empty()) return
    setSelectedEdge(null)
    setSelectedNode(el.data() as GraphNodeData)
    cy.animate({ center: { eles: el } }, { duration: 250 })
  }, [])

  useEffect(() => {
    api.listCases().then(setCases).catch(() => setCases([]))
  }, [])

  useEffect(() => {
    if (cases && cases.length > 0 && !caseId) {
      setSearchParams({ case: cases[0].id }, { replace: true })
    }
  }, [cases, caseId, setSearchParams])

  useEffect(() => {
    if (!caseId) return
    setGraph(null)
    setNotAnalyzed(false)
    api
      .getGraph(caseId)
      .then((g) => {
        setGraph(g)
        api.getRoundTrips(caseId).then(setRoundTrips).catch(() => setRoundTrips([]))
      })
      .catch(() => setNotAnalyzed(true))
  }, [caseId])

  // Mount / rebuild the cytoscape instance whenever graph data changes.
  useEffect(() => {
    if (!graph || !containerRef.current) return
    const maxThroughput = Math.max(
      1,
      ...graph.nodes.map((n) => Number(n.data.inflow) + Number(n.data.outflow)),
    )
    const maxAmount = Math.max(1, ...graph.edges.map((e) => Number(e.data.amount)))
    const cy = cytoscape({
      container: containerRef.current,
      elements: {
        nodes: graph.nodes.map((n) => ({
          data: {
            ...n.data,
            role: roles.get(n.data.id) ?? 'other',
            size:
              28 + 42 * ((Number(n.data.inflow) + Number(n.data.outflow)) / maxThroughput),
          },
        })),
        edges: graph.edges.map((e) => ({
          data: { ...e.data, width: 1.5 + 4.5 * (Number(e.data.amount) / maxAmount) },
        })),
      },
      style: buildStylesheet(),
      layout: {
        name: 'cose',
        animate: false,
        padding: 40,
        // Keep labels of small/disconnected nodes from overlapping each other.
        nodeDimensionsIncludeLabels: true,
        componentSpacing: 120,
      } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.2,
    })
    cy.on('tap', 'node', (evt: EventObject) => {
      setSelectedEdge(null)
      setSelectedNode(evt.target.data() as GraphNodeData)
    })
    cy.on('tap', 'edge', (evt: EventObject) => {
      setSelectedNode(null)
      setSelectedEdge(evt.target.data() as GraphEdgeData)
    })
    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        setSelectedNode(null)
        setSelectedEdge(null)
      }
    })
    cyRef.current = cy
    if (import.meta.env.DEV) (window as unknown as { __cy?: Core }).__cy = cy
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [graph, roles])

  // Highlighting: clicked-node neighbourhood glow takes priority, then
  // round-trip loops with the "money travelling" animation.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().removeClass(
      'loop-highlight loop-node dimmed focus-node neighbor-node neighbor-in neighbor-out',
    )
    cy.edges().data('hopOrder', '')

    if (selectedNode) {
      const node = cy.getElementById(selectedNode.id)
      if (node.nonempty()) {
        const hood = node.closedNeighborhood()
        cy.elements().not(hood).addClass('dimmed')
        node.addClass('focus-node')
        hood.nodes().not(node).addClass('neighbor-node')
        node.connectedEdges().forEach((e) => {
          e.addClass(e.data('target') === selectedNode.id ? 'neighbor-in' : 'neighbor-out')
        })
      }
      return
    }

    if (!activeLoop || roundTrips.length === 0) return
    const loops =
      activeLoop === 'all' ? roundTrips : roundTrips.filter((lp) => lp.loop_id === activeLoop)
    if (loops.length === 0) return

    const loopNodeIds = new Set(loops.flatMap((lp) => lp.path))
    // hop number per edge so the officer can follow 1 → 2 → 3 around the loop
    const hopByEdge = new Map<string, number>()
    for (const lp of loops) {
      lp.edges.forEach((e, i) => hopByEdge.set(`${e.source}→${e.target}`, i + 1))
    }
    cy.nodes().forEach((n) => {
      if (loopNodeIds.has(n.id())) n.addClass('loop-node')
      else n.addClass('dimmed')
    })
    const highlighted: cytoscape.EdgeSingular[] = []
    cy.edges().forEach((e) => {
      const hop = hopByEdge.get(`${e.data('source')}→${e.data('target')}`)
      if (hop !== undefined) {
        e.data('hopOrder', String(hop))
        e.addClass('loop-highlight')
        highlighted.push(e)
      } else {
        e.addClass('dimmed')
      }
    })
    // marching ants: advance the dash offset so the flow direction is visible
    let offset = 0
    const timer = window.setInterval(() => {
      offset -= 2
      highlighted.forEach((e) => e.style('line-dash-offset', offset))
    }, 80)
    return () => window.clearInterval(timer)
  }, [activeLoop, selectedNode, roundTrips, graph])

  // Neighbouring accounts of the clicked node, with every transfer — feeds
  // the "Connected accounts" section of the node drawer.
  const connections = useMemo<NodeConnection[]>(() => {
    if (!graph || !selectedNode) return []
    const byAccount = new Map<string, NodeConnection>()
    for (const { data } of graph.edges) {
      let dir: 'in' | 'out'
      let other: string
      if (data.source === selectedNode.id) {
        dir = 'out'
        other = data.target
      } else if (data.target === selectedNode.id) {
        dir = 'in'
        other = data.source
      } else {
        continue
      }
      const entry =
        byAccount.get(other) ?? { account: other, totalIn: 0, totalOut: 0, transfers: [] }
      if (dir === 'in') entry.totalIn += Number(data.amount)
      else entry.totalOut += Number(data.amount)
      entry.transfers.push({
        dir,
        amount: data.amount,
        when: data.when,
        tier: data.tier,
        channel: data.channel,
        reference: data.reference,
      })
      byAccount.set(other, entry)
    }
    return [...byAccount.values()].sort(
      (a, b) => b.totalIn + b.totalOut - (a.totalIn + a.totalOut),
    )
  }, [graph, selectedNode])

  const exportPng = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    const link = document.createElement('a')
    link.href = cy.png({ full: true, scale: 2, bg: '#ffffff' })
    link.download = `flow-graph-${caseId ?? 'case'}.png`
    link.click()
  }, [caseId])

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible">
      <motion.header variants={fadeIn} className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-display text-text-primary">Flow Graph</h1>
          <p className="text-body text-text-secondary mt-1">
            Who sent money to whom — blue star = victim, red = mule accounts, amber = under watch
          </p>
        </div>
        <div className="flex items-center gap-3">
          {cases && cases.length > 1 && (
            <select
              value={caseId ?? ''}
              onChange={(e) => setSearchParams({ case: e.target.value })}
              className="rounded-control border border-border bg-surface px-3 py-2 text-body"
            >
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fir_number}
                </option>
              ))}
            </select>
          )}
          {graph && (
            <>
              <Button
                variant={activeLoop === 'all' ? 'primary' : 'secondary'}
                onClick={() => setActiveLoop((v) => (v === 'all' ? null : 'all'))}
                disabled={roundTrips.length === 0}
                title={roundTrips.length === 0 ? 'No round trips detected' : ''}
              >
                {activeLoop === 'all' ? '● ' : ''}Show all round trips ({roundTrips.length})
              </Button>
              <Button variant="secondary" onClick={exportPng}>
                Export PNG
              </Button>
            </>
          )}
        </div>
      </motion.header>

      {notAnalyzed && caseId && (
        <Card className="max-w-xl">
          <p className="text-section text-text-primary mb-2">This case isn't analyzed yet</p>
          <p className="text-body text-text-secondary mb-4">
            Run the analysis first — it builds the money-flow picture from all uploaded
            statements.
          </p>
          <Link to={`/cases/${caseId}/wizard?step=analyze`}>
            <Button>Go to the case and press Analyze</Button>
          </Link>
        </Card>
      )}

      {!graph && !notAnalyzed && (
        <p className="text-body text-text-secondary">Loading the money-flow graph…</p>
      )}

      <div className={graph ? 'flex gap-4 items-start' : 'hidden'}>
        <div className="relative flex-1 min-w-0">
          <div
            ref={containerRef}
            className="card !p-0 h-[560px] w-full overflow-hidden"
            data-testid="cy-container"
          />
          <div className="absolute bottom-4 left-4 card !p-3 text-label text-text-secondary flex flex-wrap gap-x-4 gap-y-1 max-w-[calc(100%-2rem)]">
            <span>
              <span className="inline-block text-primary mr-1 align-middle">★</span>
              victim
            </span>
            <span>
              <span className="inline-block w-3 h-3 rounded-pill bg-danger mr-1 align-middle" />
              mule
            </span>
            <span>
              <span className="inline-block w-3 h-3 rounded-pill bg-warning mr-1 align-middle" />
              suspect
            </span>
            <span className="border-b-2 border-solid border-text-secondary self-center">
              confirmed (same UTR)
            </span>
            <span className="border-b-2 border-dashed border-text-secondary self-center">
              probable (amount + time)
            </span>
            <span className="border-b-2 border-dotted border-text-secondary self-center">
              one-sided (single statement)
            </span>
          </div>
        </div>

        <aside className="w-80 shrink-0 max-h-[560px] overflow-y-auto">
          <h2 className="text-card-title text-text-primary mb-2">
            All accounts ({accountList.length})
          </h2>
          <input
            type="search"
            value={accountQuery}
            onChange={(e) => setAccountQuery(e.target.value)}
            placeholder="Search account or name…"
            className="w-full rounded-control border border-border bg-surface px-3 py-2 text-body mb-2"
          />
          <ul className="flex flex-col mb-4 card !p-0 divide-y divide-border max-h-64 overflow-y-auto">
            {accountList.map((n) => {
              const isSelected = selectedNode?.id === n.id
              return (
                <li key={n.id}>
                  <button
                    onClick={() => focusAccount(n.id)}
                    className={`w-full text-left px-3 py-2 hover:bg-background transition-colors ${
                      isSelected ? 'bg-primary-soft' : ''
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {n.role === 'victim' ? (
                        <span className="text-primary shrink-0">★</span>
                      ) : (
                        <span
                          className={`inline-block w-2.5 h-2.5 rounded-pill shrink-0 ${
                            n.role === 'mule'
                              ? 'bg-danger'
                              : n.role === 'suspect'
                                ? 'bg-warning'
                                : 'bg-border'
                          }`}
                        />
                      )}
                      <span className="text-body text-text-primary truncate">
                        {n.label.replace('ext:', '')}
                      </span>
                    </span>
                    <span className="block text-label text-text-secondary pl-[18px]">
                      in {formatINR(n.inflow)} · out {formatINR(n.outflow)} · {n.txn_count} txns
                    </span>
                  </button>
                </li>
              )
            })}
            {accountList.length === 0 && (
              <li className="px-3 py-2 text-label text-text-secondary">No account matches.</li>
            )}
          </ul>

          {roundTrips.length > 0 && (
            <>
            <h2 className="text-card-title text-text-primary mb-2">
              Round trips found ({roundTrips.length})
            </h2>
            <p className="text-label text-text-secondary mb-3">
              Money that left an account and came back to it. Press "Watch the money move" —
              the numbered arrows show each step.
            </p>
            {roundTrips.map((lp, idx) => {
              const isActive = activeLoop === lp.loop_id
              return (
                <Card
                  key={lp.loop_id}
                  className={`!p-4 mb-3 ${isActive ? 'ring-2 ring-danger' : ''}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="tag bg-danger-soft text-danger">Round trip {idx + 1}</span>
                    <span className="text-label text-text-secondary">
                      score {lp.score.toFixed(1)}
                    </span>
                  </div>
                  <p className="text-body text-text-primary mb-2">
                    <span className="font-semibold">{formatINR(lp.amount_out)}</span> left ·{' '}
                    <span className="font-semibold">{formatINR(lp.amount_back)}</span> returned (
                    {lp.pct_returned}%) after {lp.hops} hops in {lp.elapsed_hours}h
                  </p>
                  <ol className="mb-3 flex flex-col gap-1">
                    {lp.edges.map((e, i) => (
                      <li key={i} className="text-label text-text-secondary flex gap-2">
                        <span className="tag bg-danger-soft text-danger shrink-0">{i + 1}</span>
                        <span className="break-all">
                          {e.source.replace('ext:', '')} → {e.target.replace('ext:', '')} ·{' '}
                          {formatINR(e.amount)}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <Button
                    variant={isActive ? 'primary' : 'secondary'}
                    onClick={() => setActiveLoop(isActive ? null : lp.loop_id)}
                  >
                    {isActive ? '■ Stop' : '▶ Watch the money move'}
                  </Button>
                </Card>
              )
            })}
            </>
          )}
        </aside>
      </div>

      <AnimatePresence>
        {selectedNode && caseId && (
          <NodeDrawer
            caseId={caseId}
            node={selectedNode}
            connections={connections}
            onClose={() => setSelectedNode(null)}
          />
        )}
        {selectedEdge && (
          <EdgeDrawer edge={selectedEdge} onClose={() => setSelectedEdge(null)} />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
