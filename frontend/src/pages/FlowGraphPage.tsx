import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useSearchParams } from 'react-router-dom'
import cytoscape from 'cytoscape'
import type { Core, EventObject } from 'cytoscape'
import { api } from '../api/client'
import type {
  CaseGraph,
  CaseOut,
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
        'line-style': (el: cytoscape.EdgeSingular) =>
          el.data('tier') === 'probable' ? 'dashed' : 'solid',
      },
    },
    {
      selector: '.loop-highlight',
      style: {
        'line-color': COLORS.loop,
        'target-arrow-color': COLORS.loop,
        width: 6,
        'z-index': 10,
      },
    },
    {
      selector: '.loop-node',
      style: { 'background-color': COLORS.loop },
    },
    { selector: '.dimmed', style: { opacity: 0.15 } },
  ]
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
  const [showLoops, setShowLoops] = useState(false)
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeData | null>(null)

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
    const roles = deriveRoles(graph.nodes, graph.edges)
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
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [graph])

  // Round-trip highlighting.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().removeClass('loop-highlight loop-node dimmed')
    if (!showLoops || roundTrips.length === 0) return
    const loopNodeIds = new Set(roundTrips.flatMap((lp) => lp.path))
    const loopEdgeKeys = new Set(
      roundTrips.flatMap((lp) => lp.edges.map((e) => `${e.source}→${e.target}`)),
    )
    cy.nodes().forEach((n) => {
      if (loopNodeIds.has(n.id())) n.addClass('loop-node')
      else n.addClass('dimmed')
    })
    cy.edges().forEach((e) => {
      if (loopEdgeKeys.has(`${e.data('source')}→${e.data('target')}`))
        e.addClass('loop-highlight')
      else e.addClass('dimmed')
    })
  }, [showLoops, roundTrips, graph])

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
                variant={showLoops ? 'primary' : 'secondary'}
                onClick={() => setShowLoops((v) => !v)}
                disabled={roundTrips.length === 0}
                title={roundTrips.length === 0 ? 'No round trips detected' : ''}
              >
                {showLoops ? '● ' : ''}Show round trips ({roundTrips.length})
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

      <div className={graph ? 'relative' : 'hidden'}>
        <div
          ref={containerRef}
          className="card !p-0 h-[560px] w-full overflow-hidden"
          data-testid="cy-container"
        />
        {showLoops && roundTrips.length > 0 && (
          <div className="absolute top-4 left-4 w-72">
            {roundTrips.map((lp) => (
              <Card key={lp.loop_id} className="!p-4 mb-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="tag bg-danger-soft text-danger">Round trip</span>
                  <span className="text-label text-text-secondary">
                    score {lp.score.toFixed(1)}
                  </span>
                </div>
                <p className="text-label text-text-secondary break-words">
                  {lp.path.map((p) => p.replace('ext:', '')).join(' → ')}
                </p>
                <p className="text-body text-text-primary mt-1">
                  {formatINR(lp.amount_out)} sent out · {formatINR(lp.amount_back)} came back (
                  {lp.pct_returned}%) in {lp.elapsed_hours}h
                </p>
              </Card>
            ))}
          </div>
        )}
        <div className="absolute bottom-4 left-4 card !p-3 text-label text-text-secondary flex gap-4">
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
            suspect / watch
          </span>
          <span className="border-b-2 border-dashed border-text-secondary self-center pb-0">
            dashed = probable link
          </span>
        </div>
      </div>

      <AnimatePresence>
        {selectedNode && caseId && (
          <NodeDrawer caseId={caseId} node={selectedNode} onClose={() => setSelectedNode(null)} />
        )}
        {selectedEdge && (
          <EdgeDrawer edge={selectedEdge} onClose={() => setSelectedEdge(null)} />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
