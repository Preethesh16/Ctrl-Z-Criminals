/**
 * Final report for ONE selected account — layered like a charge-sheet
 * annexure: summary of what the charge sheet needs, only the suspicious
 * transactions, the account's money flow, its round trips, the money
 * trails of its flagged credits, and the evidence chain. Digitally signed.
 * Everything renders in the browser; nothing leaves the machine.
 */
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { api } from '../api/client'
import type { RoundTrip, Trail, TransactionOut } from '../api/types'
import {
  afterTableY,
  footerAll,
  header,
  MARGIN,
  newDoc,
  roundTripsSection,
  sectionTitle,
  summaryBlock,
  trailSection,
} from './analysisPdf'
import { deriveRoles, ROLE_LABEL, type NodeRole } from './graphRoles'
import { flagLabel } from './flagExplanations'
import { signatureLine, signReportContent } from './reportSigning'

const MAX_SUS_TXNS = 12
const MAX_TRAILS = 2

/** What the charge sheet needs — printed as a checklist in layer 1. */
const CHARGE_SHEET_CHECKLIST = [
  'Certified statement copies of the account (obtain from the bank with a Section 63 BSA certificate for electronic records)',
  'This report: suspicious transactions, money flow, round-tripping and money-trail annexures (below)',
  'SHA-256 hashes of the source statements (evidence section) matching the Evidence Locker',
  'Applicable provisions: Section 66C & 66D IT Act (identity theft / cheating by personation), Section 318 BNS (cheating), Section 317 BNS (stolen property) — confirm with the prosecutor',
  'Account holder KYC and account-opening documents (request from the bank)',
  "Verification ID printed in this report's footer — any officer can confirm authenticity on the Reports page",
]

interface AccountReportData {
  account: string
  role: NodeRole
  inflow: number
  outflow: number
  txnCount: number
  susTxns: TransactionOut[]
  totalTxnsInAccount: number
  flaggedCount: number
  transfers: Array<{
    dir: 'in' | 'out'
    other: string
    amount: string
    when: string
    tier: string
    channel: string
  }>
  loops: RoundTrip[]
  trails: Array<{ credit: TransactionOut; trail: Trail }>
  docs: Array<{ filename: string; sha256: string }>
  roles: Map<string, NodeRole>
}

async function collect(caseId: string, accountId: string): Promise<AccountReportData> {
  const [graph, allTrips, docs] = await Promise.all([
    api.getGraph(caseId),
    api.getRoundTrips(caseId).catch(() => [] as RoundTrip[]),
    api.listDocuments(caseId).catch(() => []),
  ])
  const roles = deriveRoles(graph.nodes, graph.edges)
  const node = graph.nodes.find((n) => n.data.id === accountId)?.data

  // money flow of this account only
  const transfers = graph.edges
    .filter((e) => e.data.source === accountId || e.data.target === accountId)
    .map((e) => ({
      dir: (e.data.source === accountId ? 'out' : 'in') as 'in' | 'out',
      other: (e.data.source === accountId ? e.data.target : e.data.source).replace('ext:', ''),
      amount: e.data.amount,
      when: e.data.when,
      tier: e.data.tier === 'external' ? 'one-sided' : e.data.tier,
      channel: e.data.channel,
    }))
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 40)

  // round trips this account participates in
  const loops = allTrips.filter((lp) => lp.path.includes(accountId))

  // the account's own rows: only suspicious ones make the report
  let susTxns: TransactionOut[] = []
  let totalTxnsInAccount = 0
  let flaggedCount = 0
  const trails: Array<{ credit: TransactionOut; trail: Trail }> = []
  try {
    const rows: TransactionOut[] = []
    let offset = 0
    for (;;) {
      const page = await api.listTransactions(caseId, { offset, limit: 500 })
      rows.push(...page.items.filter((t) => t.account_ref === accountId && !t.excluded))
      offset += page.items.length
      if (offset >= page.total || page.items.length === 0) break
      if (offset >= 20000) break
    }
    totalTxnsInAccount = rows.length
    const flagged = rows.filter((t) => t.flags.some((f) => !String(f.rule).startsWith('_')))
    flaggedCount = flagged.length
    susTxns = [...flagged]
      .sort((a, b) => b.flags.length - a.flags.length || Number(b.amount_inr) - Number(a.amount_inr))
      .slice(0, MAX_SUS_TXNS)
    // money trails of the biggest flagged credits landing in this account
    const credits = flagged
      .filter((t) => t.direction === 'CREDIT')
      .sort((a, b) => Number(b.amount_inr) - Number(a.amount_inr))
      .slice(0, MAX_TRAILS)
    for (const credit of credits) {
      const trail = await api.getTrail(caseId, credit.id, 'tranche').catch(() => null)
      if (trail && trail.hops.length > 0) trails.push({ credit, trail })
    }
  } catch {
    /* external account — no rows of its own */
  }

  return {
    account: accountId.replace('ext:', ''),
    role: roles.get(accountId) ?? 'other',
    inflow: Number(node?.inflow ?? 0),
    outflow: Number(node?.outflow ?? 0),
    txnCount: node?.txn_count ?? totalTxnsInAccount,
    susTxns,
    totalTxnsInAccount,
    flaggedCount,
    transfers,
    loops,
    trails,
    docs: docs
      .filter((d) => (d.account_number ?? '').endsWith(accountId) || d.filename.includes(accountId))
      .map((d) => ({ filename: d.filename, sha256: d.sha256 })),
    roles,
  }
}

function summaryFacts(d: AccountReportData): Array<[string, string]> {
  return [
    ['Account under report', d.account],
    ['Role in this case', ROLE_LABEL[d.role] === '—' ? 'Counterparty' : ROLE_LABEL[d.role]],
    ['Money in / out (INR)', `${d.inflow.toFixed(2)} / ${d.outflow.toFixed(2)}`],
    ['Transactions in statements', String(d.totalTxnsInAccount || d.txnCount)],
    ['Flagged transactions', `${d.flaggedCount} (top ${d.susTxns.length} annexed below)`],
    ['Round trips involving this account', String(d.loops.length)],
    ['Money trails annexed', String(d.trails.length)],
    ['Source statements on record', String(d.docs.length)],
  ]
}

export async function downloadAccountFinalReportPdf(opts: {
  caseId: string
  caseLabel: string
  accountId: string
}): Promise<void> {
  const d = await collect(opts.caseId, opts.accountId)
  const sig = await signReportContent(opts.caseId, `account-final-report:${d.account}`, {
    account: d.account,
    susTxns: d.susTxns.map((t) => t.id),
    loops: d.loops.map((l) => l.loop_id),
    trails: d.trails.map((t) => t.credit.id),
  })

  const doc = newDoc()
  let y = header(doc, `TraceNet — Final Report: A/c ${d.account}`, opts.caseLabel)

  // Layer 1 — charge-sheet summary
  y = summaryBlock(doc, summaryFacts(d), y)
  y = sectionTitle(doc, 'For the charge sheet — what this report provides and what to attach', y)
  doc.setFontSize(9)
  CHARGE_SHEET_CHECKLIST.forEach((item, i) => {
    const lines = doc.splitTextToSize(`${i + 1}. ${item}`, doc.internal.pageSize.getWidth() - MARGIN * 2)
    doc.text(lines, MARGIN, y + 12)
    y += lines.length * 11 + 4
  })
  y += 10

  // Layer 2 — suspicious transactions only
  y = sectionTitle(doc, `Suspicious transactions (top ${d.susTxns.length} of ${d.flaggedCount} flagged)`, y)
  if (d.susTxns.length === 0) {
    doc.setFontSize(10)
    doc.text(
      'No statement rows for this account are in the case (external counterparty) — request its statement from the bank.',
      MARGIN, y + 12,
    )
    y += 30
  } else {
    autoTable(doc, {
      startY: y + 6,
      head: [['Date', 'Narration', 'Channel', 'Debit (INR)', 'Credit (INR)', 'Why suspicious']],
      body: d.susTxns.map((t) => [
        t.txn_date,
        t.narration_raw.slice(0, 55),
        t.channel,
        t.direction === 'DEBIT' ? t.amount_inr : '',
        t.direction === 'CREDIT' ? t.amount_inr : '',
        t.flags
          .filter((f) => !String(f.rule).startsWith('_'))
          .map((f) => flagLabel(f))
          .slice(0, 3)
          .join('; '),
      ]),
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [229, 72, 77], textColor: 255 },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { cellWidth: 200 } },
      margin: { left: MARGIN, right: MARGIN },
    })
    y = afterTableY(doc) + 18
  }

  // Layer 3 — money flow of this account
  y = sectionTitle(doc, `Money flow — who this account dealt with (top ${d.transfers.length} transfers)`, y)
  autoTable(doc, {
    startY: y + 6,
    head: [['Direction', 'Counterparty', 'Amount (INR)', 'When', 'Channel', 'Evidence']],
    body: d.transfers.map((t) => [
      t.dir === 'in' ? 'IN <-' : 'OUT ->',
      t.other,
      t.amount,
      t.when.slice(0, 16).replace('T', ' '),
      t.channel,
      t.tier,
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [22, 22, 29], textColor: 255 },
    columnStyles: { 2: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN },
  })
  y = afterTableY(doc) + 18

  // Layer 4 — round-tripping involving this account
  y = roundTripsSection(doc, d.loops, y)

  // Layer 5 — money trails of the flagged credits
  for (const { credit, trail } of d.trails) {
    y = trailSection(doc, credit, trail, d.roles, y)
  }

  // Layer 6 — evidence chain
  y = sectionTitle(doc, 'Evidence chain', y)
  doc.setFontSize(9)
  if (d.docs.length === 0) {
    doc.text('No statement of this account is on record in this case.', MARGIN, y + 12)
    y += 24
  } else {
    autoTable(doc, {
      startY: y + 6,
      head: [['Source statement', 'SHA-256 (Evidence Locker)']],
      body: d.docs.map((x) => [x.filename, x.sha256]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [47, 111, 237], textColor: 255 },
      margin: { left: MARGIN, right: MARGIN },
    })
    y = afterTableY(doc) + 12
  }
  doc.setFontSize(9)
  doc.text(
    'Authenticity: the Verification ID in the footer of every page can be checked on the Reports page — a report not in the system records is not genuine.',
    MARGIN, y + 10,
    { maxWidth: doc.internal.pageSize.getWidth() - MARGIN * 2 },
  )

  footerAll(doc, `final report A/c ${d.account} — ${opts.caseLabel}`, signatureLine(sig))
  doc.save(
    `final-report-${d.account}-${opts.caseLabel.replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`,
  )
}

export async function downloadAccountFinalReportXlsx(opts: {
  caseId: string
  caseLabel: string
  accountId: string
}): Promise<void> {
  const d = await collect(opts.caseId, opts.accountId)
  const sig = await signReportContent(opts.caseId, `account-final-report:${d.account}`, {
    account: d.account,
    susTxns: d.susTxns.map((t) => t.id),
    loops: d.loops.map((l) => l.loop_id),
    trails: d.trails.map((t) => t.credit.id),
  })

  const wb = XLSX.utils.book_new()
  const aoa: unknown[][] = [
    [`TraceNet — Final Report: A/c ${d.account}`],
    [`Case: ${opts.caseLabel}`],
    [signatureLine(sig)],
    [],
    ['Summary'],
    ...summaryFacts(d).map(([k, v]) => [k, v]),
    [],
    ['For the charge sheet'],
    ...CHARGE_SHEET_CHECKLIST.map((c, i) => [`${i + 1}. ${c}`]),
    [],
    [`Suspicious transactions (top ${d.susTxns.length} of ${d.flaggedCount} flagged)`],
    ['Date', 'Narration', 'Channel', 'Debit (INR)', 'Credit (INR)', 'Why suspicious'],
    ...d.susTxns.map((t) => [
      t.txn_date,
      t.narration_raw,
      t.channel,
      t.direction === 'DEBIT' ? Number(t.amount_inr) : '',
      t.direction === 'CREDIT' ? Number(t.amount_inr) : '',
      t.flags.filter((f) => !String(f.rule).startsWith('_')).map((f) => flagLabel(f)).join('; '),
    ]),
    [],
    ['Money flow of this account'],
    ['Direction', 'Counterparty', 'Amount (INR)', 'When', 'Channel', 'Evidence'],
    ...d.transfers.map((t) => [
      t.dir === 'in' ? 'IN' : 'OUT',
      t.other,
      Number(t.amount),
      t.when.slice(0, 16).replace('T', ' '),
      t.channel,
      t.tier,
    ]),
    [],
    [`Round-tripping involving this account (${d.loops.length})`],
    ['Round trip', 'Step', 'From', 'To', 'Amount (INR)', 'When', 'Evidence'],
    ...d.loops.flatMap((lp, i) =>
      lp.edges.map((e, j) => [
        i + 1,
        j + 1,
        e.source.replace('ext:', ''),
        e.target.replace('ext:', ''),
        Number(e.amount),
        e.when.slice(0, 16).replace('T', ' '),
        e.tier === 'external' ? 'one-sided' : e.tier,
      ]),
    ),
    [],
    ...d.trails.flatMap(({ credit, trail }) => [
      [`Money trail — ${credit.amount_inr} INR received ${credit.txn_date}`],
      ['Layer', 'Date', 'Narration', 'Counterparty', 'Channel', 'From this credit (INR)', 'Debit total (INR)'],
      ...trail.hops.map((h, i) => [
        i + 1,
        h.txn_date,
        h.narration,
        h.counterparty ?? '',
        h.channel,
        Number(h.attributed),
        Number(h.debit_total),
      ]),
      [],
    ]),
    ['Evidence chain'],
    ['Source statement', 'SHA-256'],
    ...d.docs.map((x) => [x.filename, x.sha256]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Report')
  XLSX.writeFile(
    wb,
    `final-report-${d.account}-${opts.caseLabel.replace(/[^A-Za-z0-9._-]+/g, '_')}.xlsx`,
  )
}
