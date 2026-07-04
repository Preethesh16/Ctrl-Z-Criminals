/**
 * Excel (.xlsx) versions of the visual-analysis reports — same data as the
 * PDF versions in analysisPdf.ts, generated client-side with SheetJS so
 * nothing leaves the machine. Every workbook opens with a Summary sheet.
 */
import * as XLSX from 'xlsx'
import type {
  CaseGraph,
  Disposition,
  GraphNodeData,
  RoundTrip,
  Trail,
  TransactionOut,
} from '../api/types'
import {
  deriveRoles,
  ROLE_LABEL,
  SUSPICION_ORDER,
  type NodeConnection,
  type NodeRole,
} from './graphRoles'

type RoledNode = GraphNodeData & { role: NodeRole }

function safeStem(label: string): string {
  return label.replace(/[^A-Za-z0-9._-]+/g, '_')
}

function sheet(wb: XLSX.WorkBook, name: string, rows: Array<Record<string, unknown>>): void {
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31))
}

type ReportSection =
  | { title: string; facts: Array<[string, string]> }
  | { title: string; rows: Array<Record<string, unknown>> }

function rowsToAoa(rows: Array<Record<string, unknown>>): unknown[][] {
  if (rows.length === 0) return [['(none)']]
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  return [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))]
}

/**
 * First sheet of every workbook: the whole report stacked vertically in PDF
 * order (title, summary, then each section), so opening the file shows
 * everything the PDF shows. The per-section sheets that follow hold the
 * same tables again for sorting/filtering.
 */
function reportSheet(
  wb: XLSX.WorkBook,
  title: string,
  caseLabel: string,
  sections: ReportSection[],
): void {
  const aoa: unknown[][] = [
    [title],
    [`Case: ${caseLabel}`],
    [`Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`],
    [],
  ]
  for (const s of sections) {
    aoa.push([s.title])
    if ('facts' in s) aoa.push(...s.facts.map(([k, v]) => [k, v]))
    else aoa.push(...rowsToAoa(s.rows))
    aoa.push([])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Report')
}

function summarySheet(wb: XLSX.WorkBook, caseLabel: string, facts: Array<[string, string]>): void {
  sheet(wb, 'Summary', [
    { Item: 'Case', Value: caseLabel },
    {
      Item: 'Generated',
      Value: `${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
    },
    ...facts.map(([Item, Value]) => ({ Item, Value })),
  ])
}

function accountRows(nodes: RoledNode[]): Array<Record<string, unknown>> {
  return [...nodes]
    .sort((a, b) => SUSPICION_ORDER[a.role] - SUSPICION_ORDER[b.role])
    .map((n) => ({
      Account: n.label.replace('ext:', ''),
      Role: ROLE_LABEL[n.role],
      'Money in (INR)': Number(n.inflow),
      'Money out (INR)': Number(n.outflow),
      Transactions: n.txn_count,
    }))
}

function roundTripRows(roundTrips: RoundTrip[]): Array<Record<string, unknown>> {
  return roundTrips.flatMap((lp, i) =>
    lp.edges.map((e, j) => ({
      'Round trip': i + 1,
      Step: j + 1,
      From: e.source.replace('ext:', ''),
      To: e.target.replace('ext:', ''),
      'Amount (INR)': Number(e.amount),
      When: e.when.slice(0, 16).replace('T', ' '),
      Evidence: e.tier === 'external' ? 'one-sided' : e.tier,
      'Returned %': j === lp.edges.length - 1 ? lp.pct_returned : '',
    })),
  )
}

function trailRows(trail: Trail, roles: Map<string, NodeRole>): Array<Record<string, unknown>> {
  return trail.hops.map((h, i) => {
    const role =
      (h.counterparty && roles.get(`ext:${h.counterparty.toLowerCase()}`)) ||
      (h.counterparty && roles.get(h.counterparty)) ||
      null
    return {
      Layer: i + 1,
      Date: h.txn_date,
      Narration: h.narration,
      Counterparty: h.counterparty ?? '',
      Role: role ? ROLE_LABEL[role] : '',
      Channel: h.channel,
      'From this credit (INR)': Number(h.attributed),
      'Debit total (INR)': Number(h.debit_total),
    }
  })
}

/** Flow Graph page: accounts + round trips (+ focused account transfers). */
export function downloadGraphReportXlsx(opts: {
  caseLabel: string
  nodes: RoledNode[]
  roundTrips: RoundTrip[]
  focused?: { node: GraphNodeData; connections: NodeConnection[] } | null
}): void {
  const wb = XLSX.utils.book_new()
  const mules = opts.nodes.filter((n) => n.role === 'mule').length
  const suspects = opts.nodes.filter((n) => n.role === 'suspect').length
  const victim = opts.nodes.find((n) => n.role === 'victim')
  const summaryFacts: Array<[string, string]> = [
    ['Accounts in graph', String(opts.nodes.length)],
    ['Mule accounts', String(mules)],
    ['Suspect accounts', String(suspects)],
    ['Likely victim', victim ? victim.label.replace('ext:', '') : '—'],
    ['Round trips detected', String(opts.roundTrips.length)],
  ]
  const focusRows = opts.focused
    ? opts.focused.connections.flatMap((c) =>
        c.transfers.map((t) => ({
          Direction: t.dir === 'in' ? 'IN' : 'OUT',
          Account: opts.focused!.node.label.replace('ext:', ''),
          Counterparty: c.account.replace('ext:', ''),
          'Amount (INR)': Number(t.amount),
          When: t.when.slice(0, 16).replace('T', ' '),
          Channel: t.channel,
          Evidence: t.tier === 'external' ? 'one-sided' : t.tier,
        })),
      )
    : null
  reportSheet(wb, 'TraceNet — Money Flow Report', opts.caseLabel, [
    { title: 'Summary', facts: summaryFacts },
    { title: 'Accounts (most suspicious first)', rows: accountRows(opts.nodes) },
    {
      title: `Round-tripping — money returning to its origin (${opts.roundTrips.length})`,
      rows: roundTripRows(opts.roundTrips),
    },
    ...(focusRows
      ? [
          {
            title: `Account focus: ${opts.focused!.node.label.replace('ext:', '')}`,
            rows: focusRows,
          },
        ]
      : []),
  ])
  summarySheet(wb, opts.caseLabel, summaryFacts)
  sheet(wb, 'Accounts', accountRows(opts.nodes))
  if (opts.roundTrips.length > 0) sheet(wb, 'Round trips', roundTripRows(opts.roundTrips))
  if (focusRows) sheet(wb, 'Account focus', focusRows)
  XLSX.writeFile(wb, `flow-graph-report-${safeStem(opts.caseLabel)}.xlsx`)
}

/** Money Trail page: summary + layer-by-layer hops. */
export function downloadTrailReportXlsx(opts: {
  caseLabel: string
  credit: TransactionOut
  trail: Trail
  roles?: Map<string, NodeRole>
}): void {
  const wb = XLSX.utils.book_new()
  const facts: Array<[string, string]> = [
    ['Credit followed (INR)', opts.credit.amount_inr],
    ['Received on', opts.credit.txn_date],
    ['Into account', opts.credit.account_ref],
    ['Traced (INR)', opts.trail.credit_amount],
    ['Moved on (INR)', opts.trail.spent],
    ['Still resting (INR)', opts.trail.resting],
    ['Layers', String(opts.trail.hops.length)],
  ]
  const rows = trailRows(opts.trail, opts.roles ?? new Map())
  reportSheet(wb, 'TraceNet — Money Trail Report', opts.caseLabel, [
    { title: 'Summary', facts },
    { title: 'Money trail — layer by layer', rows },
  ])
  summarySheet(wb, opts.caseLabel, facts)
  sheet(wb, 'Trail', rows)
  XLSX.writeFile(
    wb,
    `money-trail-${opts.credit.account_ref}-${safeStem(opts.caseLabel)}.xlsx`,
  )
}

/** Report page: all three features in one workbook. */
export function downloadVisualAnalysisXlsx(opts: {
  caseLabel: string
  graph: CaseGraph
  roundTrips: RoundTrip[]
  trails: Array<{ credit: TransactionOut; trail: Trail }>
  disposition: Disposition | null
}): void {
  const roles = deriveRoles(opts.graph.nodes, opts.graph.edges)
  const nodes: RoledNode[] = opts.graph.nodes.map((n) => ({
    ...n.data,
    role: roles.get(n.data.id) ?? 'other',
  }))
  const wb = XLSX.utils.book_new()
  const facts: Array<[string, string]> = [
    ['Accounts in graph', String(nodes.length)],
    ['Mule accounts', String(nodes.filter((n) => n.role === 'mule').length)],
    ['Round trips detected', String(opts.roundTrips.length)],
    ['Money trails included', String(opts.trails.length)],
  ]
  const dispositionRows = opts.disposition
    ? Object.entries(opts.disposition.buckets).map(([bucket, v]) => ({
        Bucket: bucket,
        'Amount (INR)': Number(v.amount),
        '% of debits': v.pct,
      }))
    : null
  reportSheet(wb, 'TraceNet — Visual Analysis Report', opts.caseLabel, [
    { title: 'Summary', facts },
    { title: '1. Money flow — accounts (most suspicious first)', rows: accountRows(nodes) },
    {
      title: `2. Round-tripping — money returning to its origin (${opts.roundTrips.length})`,
      rows: roundTripRows(opts.roundTrips),
    },
    ...opts.trails.map(({ credit, trail }, i) => ({
      title: `3.${i + 1} Money trail — following ${credit.amount_inr} INR received ${credit.txn_date} into A/c ${credit.account_ref}`,
      rows: trailRows(trail, roles),
    })),
    ...(dispositionRows
      ? [{ title: 'Disposition — how the money finally left', rows: dispositionRows }]
      : []),
  ])
  summarySheet(wb, opts.caseLabel, facts)
  sheet(wb, 'Accounts', accountRows(nodes))
  if (opts.roundTrips.length > 0) sheet(wb, 'Round trips', roundTripRows(opts.roundTrips))
  opts.trails.forEach(({ credit, trail }, i) => {
    sheet(wb, `Trail ${i + 1} (${credit.amount_inr})`, trailRows(trail, roles))
  })
  if (dispositionRows) sheet(wb, 'Disposition', dispositionRows)
  XLSX.writeFile(wb, `visual-analysis-${safeStem(opts.caseLabel)}.xlsx`)
}
