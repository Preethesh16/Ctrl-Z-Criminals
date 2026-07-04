import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useSearchParams } from 'react-router-dom'
import cytoscape from 'cytoscape'
import type { Core, EventObject } from 'cytoscape'
import { api } from '../api/client'
import type { CaseGraph, CaseOut, GraphEdgeData, GraphNodeData, RoundTrip } from '../api/types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { NodeDrawer, EdgeDrawer } from '../components/GraphDrawers'
import { downloadGraphReportPdf } from '../lib/analysisPdf'
import { formatINR } from '../lib/format'
import {
  buildGraphStylesheet,
  deriveRoles,
  graphElements,
  SUSPICION_ORDER,
  type NodeConnection,
  type NodeRole,
} from '../lib/graphRoles'
import { fadeIn, staggerContainer } from '../theme/motion'

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
  /** Bottom-bar add-on filters: minimum edge amount + selected txn types. */
  const [minAmount, setMinAmount] = useState(0)
  const [channelFilter, setChannelFilter] = useState<Set<string>>(new Set())

  const roles = useMemo(
    () => (graph ? deriveRoles(graph.nodes, graph.edges) : new Map<string, NodeRole>()),
    [graph],
  )

  /** Accounts list for the side panel, in suspicion order: mules first, then
   *  suspects, the victim, then everyone else — most suspicious on top. */
  const accountList = useMemo(() => {
    if (!graph) return []
    const q = accountQuery.trim().toLowerCase()
    return graph.nodes
      .map((n) => ({ ...n.data, role: roles.get(n.data.id) ?? ('other' as NodeRole) }))
      .filter((n) => !q || n.label.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          SUSPICION_ORDER[a.role] - SUSPICION_ORDER[b.role] ||
          Number(b.inflow) + Number(b.outflow) - (Number(a.inflow) + Number(a.outflow)),
      )
  }, [graph, roles, accountQuery])

  /** Largest single transfer in the graph — the slider's upper bound. */
  const maxEdgeAmount = useMemo(
    () => Math.max(0, ...(graph?.edges ?? []).map((e) => Number(e.data.amount))),
    [graph],
  )

  /** Distinct transaction types present in this case's transfers. */
  const channelOptions = useMemo(
    () => [...new Set((graph?.edges ?? []).map((e) => e.data.channel))].sort(),
    [graph],
  )

  // Reset the add-on filters whenever a different case's graph loads.
  useEffect(() => {
    setMinAmount(0)
    setChannelFilter(new Set())
  }, [graph])

  // Apply the bottom-bar filters: hide edges below the chosen amount or of
  // unselected types; hide accounts left with no visible transfers. Purely
  // additive — clearing the filters restores the graph exactly as it was.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      cy.elements().removeClass('filter-hidden')
      if (minAmount <= 0 && channelFilter.size === 0) return
      cy.edges().forEach((e) => {
        const amountOk = Number(e.data('amount')) >= minAmount
        const channelOk = channelFilter.size === 0 || channelFilter.has(e.data('channel'))
        if (!amountOk || !channelOk) e.addClass('filter-hidden')
      })
      cy.nodes().forEach((n) => {
        const visible = n.connectedEdges().not('.filter-hidden').nonempty()
        if (!visible) n.addClass('filter-hidden')
      })
    })
  }, [minAmount, channelFilter, graph])

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
    const cy = cytoscape({
      container: containerRef.current,
      elements: graphElements(graph.nodes, graph.edges, roles),
      style: buildGraphStylesheet(),
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

  /** Graph report PDF: full graph image + accounts + round trips; when a node
   *  is selected, its incoming/outgoing transfers are appended. */
  const exportGraphPdf = useCallback(() => {
    downloadGraphReportPdf({
      caseLabel: cases?.find((c) => c.id === caseId)?.fir_number ?? caseId ?? 'case',
      graphPng: cyRef.current?.png({ full: true, scale: 2, bg: '#ffffff' }) ?? null,
      // all accounts, not just the search-filtered list
      nodes: (graph?.nodes ?? []).map((n) => ({
        ...n.data,
        role: roles.get(n.data.id) ?? ('other' as NodeRole),
      })),
      roundTrips,
      focused: selectedNode ? { node: selectedNode, connections } : null,
    })
  }, [cases, caseId, graph, roles, roundTrips, selectedNode, connections])

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
              <Button variant="secondary" onClick={exportGraphPdf}>
                ⬇ Download PDF
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
        <div className="flex-1 min-w-0">
          <div className="relative">
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

          {/* Add-on filters: amount slider + transaction-type multi-select */}
          {graph && (
            <Card className="!p-4 mt-4">
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                <div className="min-w-[300px] flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-label uppercase text-text-secondary">
                      Minimum transfer amount
                    </span>
                    <span className="text-body font-medium text-text-primary tabular-nums">
                      {minAmount > 0 ? `≥ ${formatINR(String(minAmount))}` : 'showing all amounts'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={maxEdgeAmount}
                    step={Math.max(1, Math.round(maxEdgeAmount / 200))}
                    value={minAmount}
                    onChange={(e) => setMinAmount(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>

                <div>
                  <span className="block text-label uppercase text-text-secondary mb-1">
                    Transaction types
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {channelOptions.map((ch) => {
                      const on = channelFilter.has(ch)
                      return (
                        <button
                          key={ch}
                          onClick={() =>
                            setChannelFilter((prev) => {
                              const next = new Set(prev)
                              if (next.has(ch)) next.delete(ch)
                              else next.add(ch)
                              return next
                            })
                          }
                          className={`tag transition-colors ${
                            on
                              ? 'bg-primary text-text-inverse'
                              : 'bg-primary-soft text-primary hover:bg-primary/20'
                          }`}
                        >
                          {ch}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {(minAmount > 0 || channelFilter.size > 0) && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setMinAmount(0)
                      setChannelFilter(new Set())
                    }}
                  >
                    ✕ Clear filters
                  </Button>
                )}
              </div>
            </Card>
          )}
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
            onDownloadPdf={exportGraphPdf}
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
