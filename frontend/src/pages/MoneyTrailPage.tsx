import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import { Sankey, Tooltip, Layer, Rectangle } from 'recharts'
import { api } from '../api/client'
import type { CaseOut, Trail, TrailStopRule, TransactionOut } from '../api/types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DownloadChoice } from '../components/ui/DownloadChoice'
import { downloadTrailReportPdf, svgToPng } from '../lib/analysisPdf'
import { downloadTrailReportXlsx } from '../lib/analysisXlsx'
import { deriveRoles, type NodeRole } from '../lib/graphRoles'
import { formatDateIST, formatINR } from '../lib/format'
import { fadeIn, staggerContainer } from '../theme/motion'

export function MoneyTrailPage() {
  const [cases, setCases] = useState<CaseOut[] | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const caseId = searchParams.get('case')
  const [credits, setCredits] = useState<TransactionOut[] | null>(null)
  const [selectedCredit, setSelectedCredit] = useState<TransactionOut | null>(null)
  const [stopRule, setStopRule] = useState<TrailStopRule>('tranche')
  const [trail, setTrail] = useState<Trail | null>(null)
  const [loadingTrail, setLoadingTrail] = useState(false)
  const [exporting, setExporting] = useState(false)
  const sankeyRef = useRef<HTMLDivElement>(null)
  const [roles, setRoles] = useState<Map<string, NodeRole>>(new Map())

  // Account roles (mule/suspect/victim) so the trail PDF can label each layer.
  useEffect(() => {
    if (!caseId) return
    setRoles(new Map())
    api
      .getGraph(caseId)
      .then((g) => setRoles(deriveRoles(g.nodes, g.edges)))
      .catch(() => setRoles(new Map()))
  }, [caseId])

  async function exportTrailReport(format: 'pdf' | 'excel') {
    if (!trail || !selectedCredit) return
    setExporting(true)
    try {
      const caseLabel = cases?.find((c) => c.id === caseId)?.fir_number ?? caseId ?? 'case'
      if (format === 'pdf') {
        const svg = sankeyRef.current?.querySelector('svg') ?? null
        const sankeyPng = svg ? await svgToPng(svg) : null
        downloadTrailReportPdf({ caseLabel, credit: selectedCredit, trail, sankeyPng, roles })
      } else {
        downloadTrailReportXlsx({ caseLabel, credit: selectedCredit, trail, roles })
      }
    } finally {
      setExporting(false)
    }
  }

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
    setCredits(null)
    setSelectedCredit(null)
    setTrail(null)
    api
      .listTransactions(caseId, { limit: 200 })
      .then((page) => {
        const list = page.items.filter((t) => t.direction === 'CREDIT' && !t.excluded)
        // Flagged credits first — those are the ones officers trace.
        list.sort((a, b) => b.flags.length - a.flags.length || Number(b.amount_inr) - Number(a.amount_inr))
        setCredits(list)
      })
      .catch(() => setCredits([]))
  }, [caseId])

  useEffect(() => {
    if (!caseId || !selectedCredit) return
    setLoadingTrail(true)
    setTrail(null)
    api
      .getTrail(caseId, selectedCredit.id, stopRule)
      .then(setTrail)
      .catch(() => setTrail(null))
      .finally(() => setLoadingTrail(false))
  }, [caseId, selectedCredit, stopRule])

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible">
      <motion.header variants={fadeIn} className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-display text-text-primary">Money Trail</h1>
          <p className="text-body text-text-secondary mt-1">
            Pick a credit and follow that exact money until it leaves the account
          </p>
        </div>
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
      </motion.header>

      <div className="grid grid-cols-[340px_1fr] gap-6">
        {/* Credit picker */}
        <Card title="Incoming credits" className="h-fit max-h-[640px] overflow-y-auto">
          {credits === null && <p className="text-body text-text-secondary">Loading…</p>}
          {credits?.length === 0 && (
            <p className="text-body text-text-secondary">
              No credits found — upload statements first.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {credits?.slice(0, 50).map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setSelectedCredit(t)}
                  className={`w-full rounded-control border px-3 py-2 text-left transition-colors ${
                    selectedCredit?.id === t.id
                      ? 'border-primary bg-primary-soft'
                      : 'border-border hover:border-primary'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-body font-semibold text-success tabular-nums">
                      {formatINR(t.amount_inr)}
                    </span>
                    {t.flags.length > 0 && (
                      <span className="tag bg-danger-soft text-danger">flagged</span>
                    )}
                  </div>
                  <div className="text-label text-text-secondary truncate">
                    {formatDateIST(t.txn_date)} · {t.narration_raw}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {/* Trail result */}
        <div>
          {!selectedCredit && (
            <Card>
              <p className="text-body text-text-secondary">
                ← Choose a credit on the left. Flagged ones (usually the victim's money arriving)
                are listed first.
              </p>
            </Card>
          )}

          {selectedCredit && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-body text-text-primary">
                  Following <span className="font-semibold">{formatINR(selectedCredit.amount_inr)}</span>{' '}
                  received {formatDateIST(selectedCredit.txn_date)}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant={stopRule === 'tranche' ? 'primary' : 'secondary'}
                    onClick={() => setStopRule('tranche')}
                    title="Strict FIFO: stop when this credit's money is fully spent"
                  >
                    Until fully spent
                  </Button>
                  <Button
                    variant={stopRule === 'balance' ? 'primary' : 'secondary'}
                    onClick={() => setStopRule('balance')}
                    title="Stop when the balance returns to its level before this credit"
                  >
                    Until balance recovers
                  </Button>
                  {trail && (
                    <DownloadChoice
                      label="⬇ Download report"
                      busy={exporting}
                      onPdf={() => exportTrailReport('pdf')}
                      onExcel={() => exportTrailReport('excel')}
                    />
                  )}
                </div>
              </div>

              {loadingTrail && <p className="text-body text-text-secondary">Tracing…</p>}

              {trail && (
                <motion.div variants={fadeIn} initial="hidden" animate="visible">
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <Card className="!p-4">
                      <div className="text-label uppercase text-text-secondary">Traced</div>
                      <div className="stat-number text-text-primary">{formatINR(trail.credit_amount)}</div>
                    </Card>
                    <Card className="!p-4">
                      <div className="text-label uppercase text-text-secondary">Spent / moved on</div>
                      <div className="stat-number text-danger">{formatINR(trail.spent)}</div>
                    </Card>
                    <Card className="!p-4">
                      <div className="text-label uppercase text-text-secondary">Still resting</div>
                      <div className="stat-number text-success">{formatINR(trail.resting)}</div>
                    </Card>
                  </div>

                  {Number(trail.resting) > 0 && (
                    <p className="text-body text-warning font-medium mb-4">
                      {formatINR(trail.resting)} of this credit was still in the account at the end
                      of the statement period — freezing the account can still recover it.
                    </p>
                  )}

                  {trail.hops.length > 0 && (
                    <Card title="Where the money went" className="mb-4 overflow-x-auto">
                      <div ref={sankeyRef}>
                        <TrailSankey trail={trail} />
                      </div>
                    </Card>
                  )}

                  <Card title="Debit-by-debit trail" className="!p-0 overflow-hidden">
                    <table className="w-full text-body">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th className="px-4 py-3 text-label uppercase text-text-secondary">Date</th>
                          <th className="px-4 py-3 text-label uppercase text-text-secondary">Narration</th>
                          <th className="px-4 py-3 text-label uppercase text-text-secondary">Channel</th>
                          <th className="px-4 py-3 text-label uppercase text-text-secondary text-right">
                            From this credit
                          </th>
                          <th className="px-4 py-3 text-label uppercase text-text-secondary text-right">
                            Debit total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {trail.hops.map((h) => (
                          <tr key={h.txn_id} className="border-b border-border last:border-0">
                            <td className="px-4 py-2 whitespace-nowrap">{formatDateIST(h.txn_date)}</td>
                            <td className="px-4 py-2 max-w-sm truncate">{h.narration}</td>
                            <td className="px-4 py-2">
                              <span className="tag bg-primary-soft text-primary">{h.channel}</span>
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums font-medium text-danger">
                              {formatINR(h.attributed)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                              {formatINR(h.debit_total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                </motion.div>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}

const SANKEY_COLORS = ['#2f6fed', '#8b7cf6', '#f5a623', '#2fc5a0', '#e5484d', '#6b7280']

/** Credit on the left → each destination (counterparty or channel) on the right. */
function TrailSankey({ trail }: { trail: Trail }) {
  const data = useMemo(() => {
    const nodes: Array<{ name: string }> = [{ name: 'Credit received' }]
    const links: Array<{ source: number; target: number; value: number }> = []
    const indexByName = new Map<string, number>()
    for (const hop of trail.hops) {
      const label = hop.counterparty ?? `${hop.channel} — ${hop.narration.slice(0, 24)}`
      let idx = indexByName.get(label)
      if (idx === undefined) {
        idx = nodes.length
        nodes.push({ name: label })
        indexByName.set(label, idx)
      }
      links.push({ source: 0, target: idx, value: Number(hop.attributed) })
    }
    if (Number(trail.resting) > 0) {
      nodes.push({ name: 'Still in account' })
      links.push({ source: 0, target: nodes.length - 1, value: Number(trail.resting) })
    }
    return { nodes, links }
  }, [trail])

  if (data.links.length === 0) return null
  return (
    <Sankey
      width={720}
      height={90 + data.nodes.length * 28}
      data={data}
      nodePadding={24}
      margin={{ top: 8, right: 160, bottom: 8, left: 8 }}
      link={{ stroke: '#2f6fed', strokeOpacity: 0.25 }}
      node={<SankeyNode />}
    >
      <Tooltip formatter={(value) => formatINR(String(value))} />
    </Sankey>
  )
}

/* Recharts Sankey custom node: colored block + readable label. */
function SankeyNode(props: {
  x?: number
  y?: number
  width?: number
  height?: number
  index?: number
  payload?: { name: string; value: number }
}) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, payload } = props
  return (
    <Layer key={`node-${index}`}>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={SANKEY_COLORS[index % SANKEY_COLORS.length]}
        fillOpacity={0.9}
      />
      <text
        x={x + width + 8}
        y={y + height / 2}
        dy="0.35em"
        fontSize={12}
        fill="#16161d"
      >
        {payload?.name}
      </text>
    </Layer>
  )
}
