/**
 * In-memory mock adapter, contract-shaped (backend/openapi.json parity):
 * upload returns JobOut, duplicates throw 409, job progress is 0–100 with
 * "N transactions" in detail, transactions come back paginated.
 *
 * All data is synthetic — never derived from the confidential dataset.
 */
import type {
  AnalysisSummary,
  BankTemplateIn,
  BankTemplateOut,
  CaseCreate,
  CaseGraph,
  CaseOut,
  CaseStats,
  CleanReport,
  ColumnTemplate,
  CommonIdentifier,
  Direction,
  Disposition,
  DocumentColumns,
  DocumentOut,
  JobOut,
  Page,
  RoundTrip,
  Trail,
  TrailStopRule,
  TransactionOut,
  TransactionReview,
  UploadOut,
} from '../types'
import type { TransactionQuery } from '../client'
import { ApiError } from '../errors'

const SUPPORTED_EXTENSIONS = ['pdf', 'xlsx', 'xls', 'csv', 'tsv', 'docx', 'jpg', 'jpeg', 'png', 'txt']

const cases = new Map<string, CaseOut>()
const analyzedCases = new Set<string>()
const documents = new Map<string, DocumentOut>()
const jobs = new Map<string, JobOut & { _fileKey?: string }>()
const transactionsByCase = new Map<string, TransactionOut[]>()
const fileKeysByCase = new Map<string, Set<string>>()
const templates = new Map<string, BankTemplateOut>()

let idCounter = 0
const nextId = (prefix: string) => `${prefix}_${++idCounter}`

/** Deterministic pseudo-random from a string seed (stable mock data across polls). */
function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519)
    h = Math.imul(h ^ (h >>> 13), 3266489917)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

const NARRATIONS: Array<{ template: string; channel: string }> = [
  { template: 'UPI/CR/{ref}/ramesh.kumar@okhdfc/HDFC/payment', channel: 'UPI' },
  { template: 'UPI/DR/{ref}/quickmart.store@ybl/YESB/purchase', channel: 'UPI' },
  { template: 'NEFT-{ref}-SURESH TRADERS-TRANSFER', channel: 'NEFT' },
  { template: 'IMPS/P2A/{ref}/anita.sharma/AXIS', channel: 'IMPS' },
  { template: 'RTGS/{ref}/GLOBAL EXPORTS PVT LTD', channel: 'RTGS' },
  { template: 'ATM-CASH-WDL/{ref}/MG ROAD BLR', channel: 'ATM' },
  { template: 'CHQ PAID {ref} SELF', channel: 'CHEQUE' },
  { template: 'POS {ref} RELIANCE SMART BLR', channel: 'POS' },
  { template: 'CASH DEPOSIT BRANCH KORAMANGALA', channel: 'CASH' },
]

function generateTransactions(documentId: string, seed: string): TransactionOut[] {
  const rand = seededRandom(seed)
  const count = 40 + Math.floor(rand() * 160)
  const rows: TransactionOut[] = []
  let balance = 5_00_000 + Math.floor(rand() * 95_00_000) // ₹5L–₹1Cr opening
  const start = new Date('2026-01-05T00:00:00Z').getTime()
  let t = start
  for (let i = 0; i < count; i++) {
    t += Math.floor(rand() * 36 * 3600 * 1000)
    const pick = NARRATIONS[Math.floor(rand() * NARRATIONS.length)]
    const ref = String(100000000000 + Math.floor(rand() * 899999999999))
    const direction: Direction = rand() < 0.4 ? 'CREDIT' : 'DEBIT'
    const amount = (1 + Math.floor(rand() * 500)) * 1000 // ₹1k–₹5L
    balance += direction === 'CREDIT' ? amount : -amount
    const confidence = rand() < 0.85 ? 1.0 : 0.55 + rand() * 0.44
    // Sprinkle a few suspected duplicates so the review queue has both kinds of work.
    const flags = rand() < 0.04 ? [{ rule: 'DUPLICATE-SUSPECT', tier: 'fuzzy' }] : []
    const date = new Date(t)
    rows.push({
      id: nextId('txn'),
      document_id: documentId,
      account_ref: 'XXXX1234',
      row_index: i,
      txn_date: date.toISOString().slice(0, 10),
      txn_time: date.toISOString().slice(11, 19),
      amount_inr: `${amount}.00`,
      direction,
      balance_after: `${balance}.00`,
      channel: pick.channel,
      narration_raw: pick.template.replace('{ref}', ref),
      reference_id: pick.channel === 'CASH' ? null : ref,
      counterparty_id: pick.channel === 'UPI' ? pick.template.split('/')[3] : null,
      counterparty_name: null,
      flags,
      extraction_confidence: confidence,
      needs_review: confidence < 0.7 || flags.length > 0,
      excluded: false,
    })
  }
  return rows
}

function seedDemoCase(): void {
  const id = nextId('case')
  cases.set(id, {
    id,
    fir_number: 'CEN/0042/2026',
    complainant: 'Demo Complainant (synthetic)',
    fraud_amount: '500000.00',
    complaint_date: '2026-06-12',
    created_at: '2026-06-28T09:30:00Z',
  })
  const docId = nextId('doc')
  transactionsByCase.set(id, generateTransactions(docId, 'demo-seed'))
}
seedDemoCase()

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const mockAdapter = {
  async listCases(): Promise<CaseOut[]> {
    await delay(200)
    return [...cases.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
  },

  async createCase(input: CaseCreate): Promise<CaseOut> {
    await delay(250)
    const created: CaseOut = {
      id: nextId('case'),
      fir_number: input.fir_number,
      complainant: input.complainant ?? null,
      fraud_amount: input.fraud_amount ?? null,
      complaint_date: input.complaint_date ?? null,
      created_at: new Date().toISOString(),
    }
    cases.set(created.id, created)
    return created
  },

  async getCase(caseId: string): Promise<CaseOut> {
    await delay(150)
    const found = cases.get(caseId)
    if (!found) throw new ApiError(404, 'case not found')
    return found
  },

  async uploadDocument(caseId: string, file: File): Promise<UploadOut> {
    await delay(300 + Math.random() * 400)
    if (!cases.has(caseId)) throw new ApiError(404, 'case not found')

    const fileKey = `${file.name}:${file.size}`
    const seen = fileKeysByCase.get(caseId) ?? new Set<string>()
    if (seen.has(fileKey)) {
      throw new ApiError(409, `identical file already uploaded: ${file.name}`)
    }

    const documentId = nextId('doc')
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const job: JobOut & { _fileKey?: string } = {
      id: nextId('job'),
      case_id: caseId,
      kind: 'parse',
      status: 'pending',
      progress: 0,
      detail: null,
      _fileKey: fileKey,
    }

    // Mirror the real backend: every upload gets a Document row; failed
    // parses keep it with status "failed" so the review page can list them.
    const failedDoc = (error: string) =>
      documents.set(documentId, {
        id: documentId,
        case_id: caseId,
        filename: file.name,
        sha256: seededRandom(fileKey)().toString(16).slice(2).padEnd(16, '0').repeat(4).slice(0, 64),
        file_kind: ext,
        status: 'failed',
        error,
        account_number: null,
        account_holder: null,
        bank_name: null,
        period_from: null,
        period_to: null,
        txn_count: 0,
      })

    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      job.status = 'failed'
      job.detail = `unsupported file type: .${ext}`
      failedDoc(job.detail)
    } else if (/protected|locked|password/i.test(file.name)) {
      // Mock trigger for the password-protected flow: name the file accordingly.
      job.status = 'failed'
      job.detail = 'PDF is password-protected'
      failedDoc(job.detail)
    } else if (/unmapped|unknown/i.test(file.name)) {
      // Mock trigger for the column-mapping flow: unrecognized statement layout.
      job.status = 'failed'
      job.detail = `unrecognized layout:${documentId}`
      seen.add(fileKey)
      fileKeysByCase.set(caseId, seen)
      documents.set(documentId, {
        id: documentId,
        case_id: caseId,
        filename: file.name,
        sha256: seededRandom(fileKey)().toString(16).slice(2).padEnd(16, '0').repeat(4).slice(0, 64),
        file_kind: ext,
        status: 'failed',
        error: 'unrecognized layout',
        account_number: null,
        account_holder: null,
        bank_name: null,
        period_from: null,
        period_to: null,
        txn_count: 0,
      })
    } else {
      seen.add(fileKey)
      fileKeysByCase.set(caseId, seen)
      documents.set(documentId, {
        id: documentId,
        case_id: caseId,
        filename: file.name,
        sha256: seededRandom(fileKey)().toString(16).slice(2).padEnd(16, '0').repeat(4).slice(0, 64),
        file_kind: ext === 'pdf' ? 'pdf_digital' : ext,
        status: 'parsing',
        error: null,
        account_number: 'XXXX1234',
        account_holder: null,
        bank_name: null,
        period_from: null,
        period_to: null,
        txn_count: 0,
      })
      ;(job as JobOut & { _docId?: string })._docId = documentId
    }

    jobs.set(job.id, job)
    return {
      document_id: documentId,
      job_id: job.id,
      filename: file.name,
      sha256: seededRandom(fileKey)().toString(16).slice(2).padEnd(16, '0').repeat(4).slice(0, 64),
    }
  },

  async getJob(jobId: string): Promise<JobOut> {
    await delay(120)
    const job = jobs.get(jobId)
    if (!job) throw new ApiError(404, 'job not found')
    if (job.status === 'pending') {
      job.status = 'running'
      job.progress = 10
    } else if (job.status === 'running') {
      job.progress = Math.min(100, job.progress + 15 + Math.floor(Math.random() * 20))
      if (job.progress >= 100) {
        const meta = job as JobOut & { _fileKey?: string; _docId?: string }
        const docId = meta._docId ?? nextId('doc')
        const txns = generateTransactions(docId, meta._fileKey ?? job.id)
        const existing = transactionsByCase.get(job.case_id) ?? []
        transactionsByCase.set(job.case_id, [...existing, ...txns])
        const doc = documents.get(docId)
        if (doc) {
          doc.status = 'parsed'
          doc.txn_count = txns.length
        }
        job.status = 'done'
        job.detail = `${txns.length} transactions`
      }
    }
    return { ...job }
  },

  async listDocuments(caseId: string): Promise<DocumentOut[]> {
    await delay(150)
    return [...documents.values()].filter((d) => d.case_id === caseId)
  },

  async listTransactions(
    caseId: string,
    query: TransactionQuery = {},
  ): Promise<Page<TransactionOut>> {
    await delay(250)
    const offset = query.offset ?? 0
    const limit = query.limit ?? 100
    let all = [...(transactionsByCase.get(caseId) ?? [])].sort((a, b) =>
      a.txn_date.localeCompare(b.txn_date),
    )
    if (query.needs_review !== undefined) {
      all = all.filter((t) => t.needs_review === query.needs_review)
    }
    return { items: all.slice(offset, offset + limit), total: all.length, offset, limit }
  },

  /* ---------------- Phase-2 provisional endpoints ---------------- */

  async reviewTransaction(txnId: string, review: TransactionReview): Promise<TransactionOut> {
    await delay(180)
    for (const txns of transactionsByCase.values()) {
      const txn = txns.find((t) => t.id === txnId)
      if (!txn) continue
      if (review.action === 'exclude') {
        txn.excluded = true
        txn.needs_review = false
      } else if (review.action === 'confirm') {
        txn.needs_review = false
        txn.flags = txn.flags.filter((f) => f.rule !== 'DUPLICATE-SUSPECT')
      } else {
        if (review.txn_date) txn.txn_date = review.txn_date
        if (review.amount_inr) txn.amount_inr = review.amount_inr
        if (review.direction) txn.direction = review.direction
        if (review.narration_raw) txn.narration_raw = review.narration_raw
        if (review.channel) txn.channel = review.channel
        txn.extraction_confidence = 1.0
        txn.needs_review = false
      }
      return { ...txn }
    }
    throw new ApiError(404, 'transaction not found')
  },

  async cleanCase(caseId: string): Promise<CleanReport> {
    await delay(400)
    const txns = transactionsByCase.get(caseId)
    if (!txns) throw new ApiError(404, 'case not found')
    const rand = seededRandom(`clean-${caseId}`)
    // Simulate a reversal pair: exclude two matching-amount rows.
    let reversals = 0
    if (txns.length > 10 && !txns.some((t) => t.flags.some((f) => f.rule === 'REVERSED'))) {
      const debit = txns.find((t) => t.direction === 'DEBIT' && !t.excluded)
      const credit = txns.find(
        (t) => t.direction === 'CREDIT' && !t.excluded && t.id !== debit?.id,
      )
      if (debit && credit) {
        debit.flags = [...debit.flags, { rule: 'REVERSED', paired_with: credit.id }]
        credit.flags = [...credit.flags, { rule: 'REVERSED', paired_with: debit.id }]
        debit.excluded = true
        credit.excluded = true
        reversals = 1
      }
    }
    return {
      transactions: txns.length,
      balance_breaks: Math.floor(rand() * 2),
      duplicate_pairs: txns.filter((t) => t.flags.some((f) => f.rule === 'DUPLICATE-SUSPECT'))
        .length,
      reversal_pairs: reversals,
    }
  },

  async listTemplates(): Promise<BankTemplateOut[]> {
    await delay(150)
    return [...templates.values()]
  },

  async saveTemplate(template: BankTemplateIn): Promise<BankTemplateOut> {
    await delay(200)
    const saved: BankTemplateOut = {
      ...template,
      id: nextId('tpl'),
      created_at: new Date().toISOString(),
    }
    templates.set(template.header_signature, saved)
    return saved
  },

  async getCaseStats(caseId: string): Promise<CaseStats> {
    await delay(200)
    if (!cases.has(caseId)) throw new ApiError(404, 'case not found')
    const txns = transactionsByCase.get(caseId) ?? []
    const docs = [...documents.values()].filter((d) => d.case_id === caseId)
    const rand = seededRandom(`stats-${caseId}`)
    return {
      case_id: caseId,
      documents_count: docs.length,
      transactions_count: txns.length,
      needs_review_count: txns.filter((t) => t.needs_review && !t.excluded).length,
      flagged_count: txns.filter((t) => t.flags.length > 0).length,
      accounts_count: 2 + Math.floor(rand() * 6),
      round_trips_count: 0, // detection engine lands in Phase 3
      cleaning: {
        duplicates_flagged: txns.filter((t) =>
          t.flags.some((f) => f.rule === 'DUPLICATE-SUSPECT'),
        ).length,
        reversals_detected: txns.filter((t) => t.flags.some((f) => f.rule === 'REVERSED'))
          .length,
        balance_breaks: Math.floor(rand() * 2),
      },
    }
  },

  async getDocumentColumns(documentId: string): Promise<DocumentColumns> {
    await delay(200)
    const doc = documents.get(documentId)
    if (!doc) throw new ApiError(404, 'document not found')
    // A plausible unrecognized bank layout for the mapping demo.
    return {
      document_id: documentId,
      filename: doc.filename,
      bank_hint: 'Sample Co-op Bank',
      columns: [
        { index: 0, header: 'TXN DT', samples: ['03/01/2026', '05/01/2026', '09/01/2026'] },
        {
          index: 1,
          header: 'PARTICULARS',
          samples: ['UPI/CR/600123456789/ramesh', 'NEFT-N012026-SURESH TRADERS', 'ATM WDL MG ROAD'],
        },
        { index: 2, header: 'CHQ/REF', samples: ['600123456789', 'N012026', ''] },
        { index: 3, header: 'WITHDRAWAL AMT', samples: ['', '25,000.00', '10,000.00'] },
        { index: 4, header: 'DEPOSIT AMT', samples: ['1,00,000.00', '', ''] },
        { index: 5, header: 'BAL', samples: ['1,25,000.00 Cr', '1,00,000.00 Cr', '90,000.00 Cr'] },
      ],
    }
  },

  /* ---------------- Phase-3 analysis (synthetic story) ---------------- */

  async analyzeCase(caseId: string): Promise<AnalysisSummary> {
    await delay(900)
    const txns = transactionsByCase.get(caseId)
    if (!txns) throw new ApiError(404, 'case not found')
    analyzedCases.add(caseId)
    // Flag a few rows with rule evidence so explanations render everywhere.
    const rand = seededRandom(`analyze-${caseId}`)
    for (const t of txns) {
      if (t.excluded || t.flags.some((f) => f.rule === 'ROUND-TRIP')) continue
      const r = rand()
      if (r < 0.03) t.flags = [...t.flags, { rule: 'FD-04-SMURFING', why: 'kept below ₹50,000' }]
      else if (r < 0.05) t.flags = [...t.flags, { rule: 'FD-02-RAPID-OUT' }]
      else if (r < 0.06) t.flags = [...t.flags, { rule: 'ML-ANOMALY', score: 0.91 }]
    }
    const cleaning = await this.cleanCase(caseId)
    return {
      cleaning,
      transactions: txns.length,
      flagged: txns.filter((t) => t.flags.length > 0).length,
      round_trips: 1,
    }
  },

  async getGraph(caseId: string): Promise<CaseGraph> {
    await delay(300)
    if (!analyzedCases.has(caseId))
      throw new ApiError(404, 'no graph yet — run POST /cases/{id}/analyze first')
    const mk = (
      id: string,
      own: boolean,
      inflow: number,
      outflow: number,
      suspicion: 'high' | 'medium' | 'low',
      accumulator = false,
    ) => ({
      data: {
        id,
        label: id.replace('ext:', ''),
        own_account: own,
        inflow: `${inflow}.00`,
        outflow: `${outflow}.00`,
        txn_count: Math.round((inflow + outflow) / 40000) + 3,
        suspicion,
        accumulator,
      },
    })
    const edge = (
      id: string,
      source: string,
      target: string,
      amount: number,
      tier: 'confirmed' | 'probable' | 'external',
      when: string,
      channel = 'UPI',
    ) => ({
      data: {
        id,
        source,
        target,
        amount: `${amount}.00`,
        tier,
        reference: String(600000000000 + amount),
        channel,
        when,
        txn_ids: [],
      },
    })
    return {
      nodes: [
        mk('VICTIM-HDFC', true, 900000, 850000, 'low'),
        mk('ext:mule1.ramesh@oksbi', false, 500000, 480000, 'high'),
        mk('ext:mule2.axis', false, 480000, 460000, 'high'),
        mk('ext:mule3.kotak', false, 460000, 150000, 'high', true),
        mk('ext:quickmart.store@ybl', false, 60000, 0, 'low'),
        mk('ext:anita.sharma', false, 90000, 0, 'medium'),
      ],
      edges: [
        edge('e1', 'VICTIM-HDFC', 'ext:mule1.ramesh@oksbi', 500000, 'confirmed', '2026-01-06T10:12:00'),
        edge('e2', 'ext:mule1.ramesh@oksbi', 'ext:mule2.axis', 480000, 'confirmed', '2026-01-06T10:41:00'),
        edge('e3', 'ext:mule2.axis', 'ext:mule3.kotak', 460000, 'confirmed', '2026-01-06T11:03:00'),
        edge('e4', 'ext:mule3.kotak', 'ext:mule1.ramesh@oksbi', 120000, 'probable', '2026-01-06T13:20:00', 'IMPS'),
        edge('e5', 'VICTIM-HDFC', 'ext:quickmart.store@ybl', 60000, 'confirmed', '2026-01-08T09:00:00', 'POS'),
        edge('e6', 'VICTIM-HDFC', 'ext:anita.sharma', 90000, 'probable', '2026-01-09T18:30:00', 'NEFT'),
        // one-sided: mule3's own statement is not in the case — seen only from mule2's side
        edge('e7', 'ext:mule3.kotak', 'ext:anita.sharma', 150000, 'external', '2026-01-07T15:45:00', 'IMPS'),
      ],
    }
  },

  async getRoundTrips(caseId: string): Promise<RoundTrip[]> {
    await delay(250)
    if (!analyzedCases.has(caseId))
      throw new ApiError(404, 'no round_trips yet — run POST /cases/{id}/analyze first')
    return [
      {
        loop_id: 'loop-1',
        path: ['ext:mule1.ramesh@oksbi', 'ext:mule2.axis', 'ext:mule3.kotak', 'ext:mule1.ramesh@oksbi'],
        hops: 3,
        amount_out: '480000.00',
        amount_back: '120000.00',
        pct_returned: 25.0,
        elapsed_hours: 2.7,
        score: 0.82,
        edges: [
          { source: 'ext:mule1.ramesh@oksbi', target: 'ext:mule2.axis', amount: '480000.00', tier: 'confirmed', reference: '600000480000', when: '2026-01-06T10:41:00', txn_ids: [] },
          { source: 'ext:mule2.axis', target: 'ext:mule3.kotak', amount: '460000.00', tier: 'confirmed', reference: '600000460000', when: '2026-01-06T11:03:00', txn_ids: [] },
          { source: 'ext:mule3.kotak', target: 'ext:mule1.ramesh@oksbi', amount: '120000.00', tier: 'probable', reference: '600000120000', when: '2026-01-06T13:20:00', txn_ids: [] },
        ],
      },
    ]
  },

  async getCorrelation(caseId: string): Promise<CommonIdentifier[]> {
    await delay(200)
    if (!analyzedCases.has(caseId))
      throw new ApiError(404, 'no correlation yet — run POST /cases/{id}/analyze first')
    return [
      {
        identifier: 'mule1.ramesh@oksbi',
        names: ['RAMESH KUMAR'],
        seen_in_accounts: ['VICTIM-HDFC', 'MULE2-AXIS', 'MULE3-KOTAK'],
        distinct_senders: 3,
        txn_count: 14,
      },
      {
        identifier: 'quickmart.store@ybl',
        names: ['QUICKMART STORES'],
        seen_in_accounts: ['VICTIM-HDFC', 'MULE1-SBI'],
        distinct_senders: 2,
        txn_count: 6,
      },
    ]
  },

  async getDisposition(caseId: string, accountRef?: string): Promise<Disposition> {
    await delay(200)
    if (!analyzedCases.has(caseId))
      throw new ApiError(404, 'no disposition yet — run POST /cases/{id}/analyze first')

    if (!accountRef) {
      return {
        total_debits: '1250000.00',
        buckets: {
          cash: { amount: '500000.00', pct: 40.0 },
          cheque: { amount: '75000.00', pct: 6.0 },
          redirected: { amount: '550000.00', pct: 44.0 },
          merchant: { amount: '87500.00', pct: 7.0 },
          internal: { amount: '0.00', pct: 0.0 },
          unclassified: { amount: '37500.00', pct: 3.0 },
        },
      }
    }

    // Per-account view (flow-graph node drawer): compute from that
    // account's own mock debits so different nodes show different numbers.
    const CHANNEL_BUCKET: Record<string, keyof Disposition['buckets']> = {
      ATM: 'cash', CASH: 'cash', CHEQUE: 'cheque',
      UPI: 'redirected', NEFT: 'redirected', IMPS: 'redirected', RTGS: 'redirected',
      POS: 'merchant', INTERNAL: 'internal',
    }
    const txns = (transactionsByCase.get(caseId) ?? []).filter(
      (t) => t.account_ref === accountRef && t.direction === 'DEBIT' && !t.excluded,
    )
    if (txns.length === 0)
      throw new ApiError(404, `no transactions found for account ${accountRef} in this case`)

    const totals: Record<keyof Disposition['buckets'], number> = {
      cash: 0, cheque: 0, redirected: 0, merchant: 0, internal: 0, unclassified: 0,
    }
    let total = 0
    for (const t of txns) {
      const bucket = CHANNEL_BUCKET[t.channel] ?? 'unclassified'
      const amount = Number(t.amount_inr)
      totals[bucket] += amount
      total += amount
    }
    const buckets = Object.fromEntries(
      (Object.keys(totals) as Array<keyof Disposition['buckets']>).map((key) => [
        key,
        { amount: totals[key].toFixed(2), pct: total ? Math.round((totals[key] / total) * 1000) / 10 : 0 },
      ]),
    ) as Disposition['buckets']

    return { total_debits: total.toFixed(2), buckets }
  },

  async getTrail(caseId: string, txnId: string, stopRule: TrailStopRule = 'tranche'): Promise<Trail> {
    await delay(350)
    const txns = transactionsByCase.get(caseId)
    const credit = txns?.find((t) => t.id === txnId)
    if (!credit) throw new ApiError(404, 'transaction not found in this case')
    if (credit.direction !== 'CREDIT')
      throw new ApiError(422, 'money trail starts from a CREDIT transaction')
    const amount = Number(credit.amount_inr)
    const parts = [0.4, 0.35, 0.15]
    const hops = parts.map((p, i) => ({
      txn_id: `trail_hop_${i}`,
      txn_date: credit.txn_date,
      narration: [
        'ATM-CASH-WDL/MG ROAD BLR',
        'UPI/DR/600123/mule2.axis/transfer',
        'POS RELIANCE SMART BLR',
      ][i],
      channel: ['ATM', 'UPI', 'POS'][i],
      counterparty: [null, 'mule2.axis', 'RELIANCE SMART'][i],
      attributed: `${Math.round(amount * p)}.00`,
      debit_total: `${Math.round(amount * p)}.00`,
    }))
    const spent = hops.reduce((s, h) => s + Number(h.attributed), 0)
    return {
      credit_txn_id: txnId,
      credit_amount: credit.amount_inr,
      pre_credit_balance: credit.balance_after
        ? `${Number(credit.balance_after) - amount}.00`
        : null,
      hops,
      spent: `${spent}.00`,
      resting: `${Math.max(0, amount - spent)}.00`,
      stop_rule: stopRule,
      stopped_early: stopRule === 'balance',
    }
  },

  async getReportPreviewHtml(caseId: string): Promise<string> {
    await delay(400)
    const c = cases.get(caseId)
    if (!c) throw new ApiError(404, 'case not found')
    const txns = transactionsByCase.get(caseId) ?? []
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:Inter,system-ui,sans-serif;margin:32px;color:#16161d}
      h1{font-size:22px} h2{font-size:16px;margin-top:24px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
      table{border-collapse:collapse;width:100%;font-size:12px;margin-top:8px}
      td,th{border:1px solid #e5e7eb;padding:4px 8px;text-align:left}
      .muted{color:#6b7280}</style></head><body>
      <h1>TraceNet Investigation Report — ${c.fir_number}</h1>
      <p class="muted">MOCK PREVIEW — the real report (with legal mapping, evidence chain and
      SHA-256 hashes) is generated by the server. Switch VITE_API_MODE=real.</p>
      <h2>Case summary</h2>
      <p>Complainant: ${c.complainant ?? '—'} · Reported loss: ₹${c.fraud_amount ?? '—'} ·
      Transactions analyzed: ${txns.length}</p>
      <h2>Findings</h2>
      <p>1 round trip · smurfing pattern below ₹50,000 · 40% cash-out (synthetic demo data)</p>
      </body></html>`
  },

  async saveColumnTemplate(
    docColumns: DocumentColumns,
    template: ColumnTemplate,
  ): Promise<JobOut | null> {
    await delay(300)
    const doc = documents.get(docColumns.document_id)
    if (!doc) throw new ApiError(404, 'document not found')
    templates.set(docColumns.columns.map((c) => c.header.toLowerCase()).join('|'), {
      name: template.bank_name,
      bank: template.bank_name,
      header_signature: docColumns.columns.map((c) => c.header.toLowerCase()).join('|'),
      mapping: {},
      id: nextId('tpl'),
      created_at: new Date().toISOString(),
    })
    doc.status = 'parsing'
    doc.error = null
    const job: JobOut & { _fileKey?: string; _docId?: string } = {
      id: nextId('job'),
      case_id: doc.case_id,
      kind: 'parse',
      status: 'pending',
      progress: 0,
      detail: null,
      _fileKey: `remap:${doc.sha256}`,
      _docId: docColumns.document_id,
    }
    jobs.set(job.id, job)
    return { ...job }
  },
}
