/**
 * Client-side PDF reports for the visual analysis pages. Everything renders
 * in the browser (jsPDF) — no data leaves the machine, matching the
 * offline-first story even for confidential cases.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import cytoscape from 'cytoscape'
import type {
  CaseGraph,
  Disposition,
  GraphNodeData,
  RoundTrip,
  Trail,
  TransactionOut,
} from '../api/types'
import {
  buildGraphStylesheet,
  deriveRoles,
  graphElements,
  ROLE_LABEL,
  SUSPICION_ORDER,
  type NodeConnection,
  type NodeRole,
} from './graphRoles'
import { signatureLine, signReportContent } from './reportSigning'

type RoledNode = GraphNodeData & { role: NodeRole }

const MARGIN = 40

/** Plain-language facts block used as the "Summary" at the top of each PDF. */
function summaryBlock(doc: jsPDF, facts: Array<[string, string]>, y: number): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('Summary', MARGIN, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  facts.forEach(([label, value], i) => {
    doc.text(`${label}: ${value}`, MARGIN, y + 16 + i * 14)
  })
  return y + 16 + facts.length * 14 + 10
}

function graphSummaryFacts(nodes: Array<{ role: NodeRole; label: string }>, roundTrips: RoundTrip[]): Array<[string, string]> {
  const victim = nodes.find((n) => n.role === 'victim')
  return [
    ['Accounts in graph', String(nodes.length)],
    ['Mule accounts', String(nodes.filter((n) => n.role === 'mule').length)],
    ['Suspect accounts', String(nodes.filter((n) => n.role === 'suspect').length)],
    ['Likely victim', victim ? victim.label.replace('ext:', '') : '—'],
    ['Round trips detected', String(roundTrips.length)],
  ]
}

function newDoc(): jsPDF {
  return new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
}

function header(doc: jsPDF, title: string, caseLabel: string, y = 42): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(title, MARGIN, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Case: ${caseLabel}`, MARGIN, y + 18)
  doc.text(
    `Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
    MARGIN,
    y + 32,
  )
  return y + 48
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  if (y > doc.internal.pageSize.getHeight() - 120) {
    doc.addPage()
    y = 48
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(text, MARGIN, y)
  doc.setFont('helvetica', 'normal')
  return y + 10
}

function footerAll(doc: jsPDF, label: string, signature?: string): void {
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(120)
    const h = doc.internal.pageSize.getHeight()
    doc.text(`TraceNet — ${label} — page ${i} of ${pages}`, MARGIN, h - 20)
    if (signature) doc.text(signature, MARGIN, h - 32)
    doc.setTextColor(0)
  }
}

function afterTableY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120
}

/** Fit an image to the page width, capped in height; returns the new y. */
function addImage(doc: jsPDF, png: string, y: number, maxH = 320): number {
  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2
  const props = doc.getImageProperties(png)
  const scale = Math.min(pageW / props.width, maxH / props.height)
  const w = props.width * scale
  const h = props.height * scale
  if (y + h > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage()
    y = 48
  }
  doc.addImage(png, 'PNG', MARGIN, y, w, h)
  return y + h + 14
}

function accountsTable(doc: jsPDF, nodes: RoledNode[], y: number): number {
  autoTable(doc, {
    startY: y,
    head: [['Account', 'Role', 'Money in (INR)', 'Money out (INR)', 'Transactions']],
    body: [...nodes]
      .sort((a, b) => SUSPICION_ORDER[a.role] - SUSPICION_ORDER[b.role])
      .map((n) => [
        n.label.replace('ext:', ''),
        ROLE_LABEL[n.role],
        n.inflow,
        n.outflow,
        String(n.txn_count),
      ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [22, 22, 29], textColor: 255 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN },
  })
  return afterTableY(doc) + 18
}

function roundTripsSection(doc: jsPDF, roundTrips: RoundTrip[], y: number): number {
  y = sectionTitle(doc, `Round-tripping — money returning to its origin (${roundTrips.length})`, y)
  if (roundTrips.length === 0) {
    doc.setFontSize(10)
    doc.text('No round trips detected in this case.', MARGIN, y + 12)
    return y + 30
  }
  roundTrips.forEach((lp, i) => {
    doc.setFontSize(10)
    if (y > doc.internal.pageSize.getHeight() - 140) {
      doc.addPage()
      y = 48
    }
    doc.setFont('helvetica', 'bold')
    doc.text(
      `Round trip ${i + 1}: ${lp.amount_out} INR left, ${lp.amount_back} INR returned ` +
        `(${lp.pct_returned}%) after ${lp.hops} hops in ${lp.elapsed_hours}h — score ${lp.score.toFixed(1)}`,
      MARGIN,
      y + 12,
    )
    doc.setFont('helvetica', 'normal')
    autoTable(doc, {
      startY: y + 20,
      head: [['Step', 'From', 'To', 'Amount (INR)', 'When', 'Evidence']],
      body: lp.edges.map((e, j) => [
        String(j + 1),
        e.source.replace('ext:', ''),
        e.target.replace('ext:', ''),
        e.amount,
        e.when.slice(0, 16).replace('T', ' '),
        e.tier === 'external' ? 'one-sided' : e.tier,
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [229, 72, 77], textColor: 255 },
      columnStyles: { 3: { halign: 'right' } },
      margin: { left: MARGIN, right: MARGIN },
    })
    y = afterTableY(doc) + 14
  })
  return y
}

function trailSection(
  doc: jsPDF,
  credit: TransactionOut,
  trail: Trail,
  roles: Map<string, NodeRole>,
  y: number,
  sankeyPng?: string | null,
): number {
  y = sectionTitle(
    doc,
    `Money trail — following ${credit.amount_inr} INR received ${credit.txn_date} into A/c ${credit.account_ref}`,
    y,
  )
  doc.setFontSize(10)
  doc.text(
    `Traced: ${trail.credit_amount} INR — moved on: ${trail.spent} INR — still resting in the account: ${trail.resting} INR`,
    MARGIN,
    y + 12,
  )
  y += 24
  if (sankeyPng) y = addImage(doc, sankeyPng, y, 240)
  autoTable(doc, {
    startY: y,
    head: [['Layer', 'Date', 'Where it went (narration)', 'Counterparty', 'Role', 'Channel', 'From this credit (INR)', 'Debit total (INR)']],
    body: trail.hops.map((h, i) => {
      const role =
        (h.counterparty && roles.get(`ext:${h.counterparty.toLowerCase()}`)) ||
        (h.counterparty && roles.get(h.counterparty)) ||
        null
      return [
        String(i + 1),
        h.txn_date,
        h.narration.slice(0, 60),
        h.counterparty ?? '—',
        role ? ROLE_LABEL[role] : '—',
        h.channel,
        h.attributed,
        h.debit_total,
      ]
    }),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [47, 111, 237], textColor: 255 },
    columnStyles: { 6: { halign: 'right' }, 7: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN },
  })
  y = afterTableY(doc) + 8
  if (Number(trail.resting) > 0) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(
      `${trail.resting} INR was still in the account at period end — freezing it can still recover this amount.`,
      MARGIN,
      y + 10,
    )
    doc.setFont('helvetica', 'normal')
    y += 24
  }
  return y + 10
}

/* ------------------------------------------------------------------ */

/** Flow Graph page: graph image + accounts + round trips (+ focused account). */
export async function downloadGraphReportPdf(opts: {
  caseId: string
  caseLabel: string
  graphPng: string | null
  nodes: RoledNode[]
  roundTrips: RoundTrip[]
  focused?: { node: GraphNodeData; connections: NodeConnection[] } | null
}): Promise<void> {
  const sig = await signReportContent(opts.caseId, 'flow-graph-report', {
    nodes: opts.nodes,
    roundTrips: opts.roundTrips,
    focused: opts.focused ?? null,
  })
  const doc = newDoc()
  let y = header(doc, 'TraceNet — Money Flow Report', opts.caseLabel)
  y = summaryBlock(doc, graphSummaryFacts(opts.nodes, opts.roundTrips), y)
  if (opts.graphPng) y = addImage(doc, opts.graphPng, y)
  doc.setFontSize(9)
  doc.text(
    'Blue star = victim - red = mule - amber = suspect. Solid line = confirmed (same UTR in both statements), dashed = probable (amount + time), dotted = one-sided (single statement).',
    MARGIN,
    y,
    { maxWidth: doc.internal.pageSize.getWidth() - MARGIN * 2 },
  )
  y += 26
  y = sectionTitle(doc, 'Accounts (most suspicious first)', y)
  y = accountsTable(doc, opts.nodes, y + 6)
  y = roundTripsSection(doc, opts.roundTrips, y)

  if (opts.focused) {
    y = sectionTitle(
      doc,
      `Account focus: ${opts.focused.node.label.replace('ext:', '')} — incoming and outgoing transfers`,
      y,
    )
    autoTable(doc, {
      startY: y + 6,
      head: [['Direction', 'Counterparty account', 'Amount (INR)', 'When', 'Channel', 'Evidence']],
      body: opts.focused.connections.flatMap((c) =>
        c.transfers.map((t) => [
          t.dir === 'in' ? 'IN <-' : 'OUT ->',
          c.account.replace('ext:', ''),
          t.amount,
          t.when.slice(0, 16).replace('T', ' '),
          t.channel,
          t.tier === 'external' ? 'one-sided' : t.tier,
        ]),
      ),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [22, 22, 29], textColor: 255 },
      columnStyles: { 2: { halign: 'right' } },
      margin: { left: MARGIN, right: MARGIN },
    })
  }
  footerAll(doc, `money flow report — ${opts.caseLabel}`, signatureLine(sig))
  doc.save(`flow-graph-report-${opts.caseLabel.replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`)
}

/** Money Trail page: Sankey image + layer-by-layer trail table. */
export async function downloadTrailReportPdf(opts: {
  caseId: string
  caseLabel: string
  credit: TransactionOut
  trail: Trail
  sankeyPng: string | null
  roles?: Map<string, NodeRole>
}): Promise<void> {
  const sig = await signReportContent(opts.caseId, 'money-trail-report', {
    credit: opts.credit.id,
    trail: opts.trail,
  })
  const doc = newDoc()
  let y = header(doc, 'TraceNet — Money Trail Report', opts.caseLabel)
  y = summaryBlock(
    doc,
    [
      ['Credit followed (INR)', opts.credit.amount_inr],
      ['Received on', `${opts.credit.txn_date} into A/c ${opts.credit.account_ref}`],
      ['Moved on (INR)', opts.trail.spent],
      ['Still resting in account (INR)', opts.trail.resting],
      ['Layers traced', String(opts.trail.hops.length)],
    ],
    y,
  )
  y = trailSection(doc, opts.credit, opts.trail, opts.roles ?? new Map(), y, opts.sankeyPng)
  void y
  footerAll(doc, `money trail — ${opts.caseLabel}`, signatureLine(sig))
  doc.save(
    `money-trail-${opts.credit.account_ref}-${opts.caseLabel.replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`,
  )
}

/** Report page: all three features in one PDF — flow, round trips, trails. */
export async function downloadVisualAnalysisPdf(opts: {
  caseId: string
  caseLabel: string
  graph: CaseGraph
  graphPng: string | null
  roundTrips: RoundTrip[]
  trails: Array<{ credit: TransactionOut; trail: Trail }>
  disposition: Disposition | null
}): Promise<void> {
  const roles = deriveRoles(opts.graph.nodes, opts.graph.edges)
  const nodes: RoledNode[] = opts.graph.nodes.map((n) => ({
    ...n.data,
    role: roles.get(n.data.id) ?? 'other',
  }))
  const sig = await signReportContent(opts.caseId, 'visual-analysis-report', {
    roundTrips: opts.roundTrips,
    trails: opts.trails.map((t) => ({ credit: t.credit.id, trail: t.trail })),
    disposition: opts.disposition,
    accounts: nodes.length,
  })
  const doc = newDoc()
  let y = header(doc, 'TraceNet — Visual Analysis Report', opts.caseLabel)
  y = summaryBlock(
    doc,
    [
      ...graphSummaryFacts(nodes, opts.roundTrips),
      ['Money trails included', String(opts.trails.length)],
    ],
    y,
  )

  y = sectionTitle(doc, '1. Money flow — who sent money to whom', y)
  if (opts.graphPng) y = addImage(doc, opts.graphPng, y + 6)
  y = accountsTable(doc, nodes, y)

  doc.addPage()
  y = 48
  y = roundTripsSection(doc, opts.roundTrips, y)

  if (opts.trails.length > 0) {
    doc.addPage()
    y = 48
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('3. Money trails — where the flagged credits went, layer by layer', MARGIN, y)
    doc.setFont('helvetica', 'normal')
    y += 16
    for (const { credit, trail } of opts.trails) {
      y = trailSection(doc, credit, trail, roles, y)
    }
  }

  if (opts.disposition) {
    y = sectionTitle(doc, 'Disposition — how the money finally left', y)
    autoTable(doc, {
      startY: y + 6,
      head: [['Bucket', 'Amount (INR)', '% of debits']],
      body: Object.entries(opts.disposition.buckets).map(([k, v]) => [
        k,
        v.amount,
        `${v.pct}%`,
      ]),
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [22, 22, 29], textColor: 255 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      margin: { left: MARGIN, right: MARGIN },
    })
  }
  footerAll(doc, `visual analysis — ${opts.caseLabel}`, signatureLine(sig))
  doc.save(`visual-analysis-${opts.caseLabel.replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`)
}

/* ------------------------------------------------------------------ */

/** Render the case graph to a PNG without a visible page (for the Report page). */
export async function renderGraphPngOffscreen(graph: CaseGraph): Promise<string | null> {
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:1100px;height:700px;'
  document.body.appendChild(holder)
  try {
    const roles = deriveRoles(graph.nodes, graph.edges)
    const cy = cytoscape({
      container: holder,
      elements: graphElements(graph.nodes, graph.edges, roles),
      style: buildGraphStylesheet(),
      layout: {
        name: 'cose',
        animate: false,
        padding: 40,
        nodeDimensionsIncludeLabels: true,
        componentSpacing: 120,
      } as cytoscape.LayoutOptions,
    })
    // cose with animate:false lays out synchronously; give the canvas a beat
    await new Promise((r) => setTimeout(r, 150))
    const png = cy.png({ full: true, scale: 2, bg: '#ffffff' })
    cy.destroy()
    return png
  } catch {
    return null
  } finally {
    holder.remove()
  }
}

/** Serialize an on-page SVG (recharts Sankey) to a PNG data URL. */
export async function svgToPng(svg: SVGSVGElement): Promise<string | null> {
  try {
    const xml = new XMLSerializer().serializeToString(svg)
    const svg64 = window.btoa(unescape(encodeURIComponent(xml)))
    const img = new Image()
    const w = svg.width.baseVal.value || svg.clientWidth
    const h = svg.height.baseVal.value || svg.clientHeight
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = reject
      img.src = `data:image/svg+xml;base64,${svg64}`
    })
    const canvas = document.createElement('canvas')
    canvas.width = w * 2
    canvas.height = h * 2
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.scale(2, 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}
