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
  high: '#e5484d',
  medium: '#f5a623',
  low: '#6b7280',
  own: '#2f6fed',
  edge: '#9ca3af',
  loop: '#e5484d',
  label: '#16161d',
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
        'background-color': (el: cytoscape.NodeSingular) =>
          COLORS[el.data('suspicion') as 'high' | 'medium' | 'low'] ?? COLORS.low,
        'border-width': (el: cytoscape.NodeSingular) => (el.data('own_account') ? 4 : 0),
        'border-color': COLORS.own,
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
    const cy = cytoscape({
      container: containerRef.current,
      elements: {
        nodes: graph.nodes.map((n) => ({
          data: {
            ...n.data,
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
            Who sent money to whom — thicker arrows carry more money, red accounts are suspicious
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
            <span className="inline-block w-3 h-3 rounded-pill bg-danger mr-1 align-middle" />
            suspicious
          </span>
          <span>
            <span className="inline-block w-3 h-3 rounded-pill bg-warning mr-1 align-middle" />
            watch
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
