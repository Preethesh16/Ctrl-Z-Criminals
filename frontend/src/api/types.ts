/**
 * API types — reconciled 2026-07-02 against Person A's published contract
 * (backend/openapi.json). Keep in lockstep with it; contract changes require
 * a progress.md note per CLAUDE.md.
 *
 * Money is a decimal string in INR (never float). Dates are ISO strings.
 */

export interface CaseCreate {
  fir_number: string
  complainant?: string | null
  /** Decimal string in rupees, e.g. "500000.00" */
  fraud_amount?: string | null
  complaint_date?: string | null
}

export interface CaseOut {
  id: string
  fir_number: string
  complainant: string | null
  fraud_amount: string | null
  complaint_date: string | null
  created_at: string
}

/** POST /cases/{id}/documents response — poll the job via job_id. */
export interface UploadOut {
  document_id: string
  job_id: string
  filename: string
  sha256: string
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface JobOut {
  id: string
  case_id: string
  kind: string
  status: JobStatus
  /** 0–100 */
  progress: number
  /** On done: "N transactions". On failed: error description. */
  detail: string | null
}

export interface DocumentOut {
  id: string
  case_id: string
  filename: string
  sha256: string
  file_kind: string
  status: string
  error: string | null
  account_number: string | null
  account_holder: string | null
  bank_name: string | null
  period_from: string | null
  period_to: string | null
  txn_count: number
}

export type Direction = 'DEBIT' | 'CREDIT'

/**
 * Flags are objects with a `rule` discriminator plus rule-specific evidence,
 * e.g. {rule: "DUPLICATE-SUSPECT", of: "<txn_id>", tier: "exact"},
 * {rule: "REVERSED", paired_with: "<txn_id>"}, {rule: "FD-07-BALANCE-BREAK", …}.
 */
export interface TransactionFlag {
  rule: string
  [key: string]: unknown
}

export interface TransactionOut {
  id: string
  document_id: string
  account_ref: string
  row_index: number
  txn_date: string
  txn_time: string | null
  /** Decimal string in rupees */
  amount_inr: string
  direction: Direction
  balance_after: string | null
  channel: string
  narration_raw: string
  reference_id: string | null
  counterparty_id: string | null
  counterparty_name: string | null
  flags: TransactionFlag[]
  extraction_confidence: number
  needs_review: boolean
  excluded: boolean
}

export interface Page<T> {
  items: T[]
  total: number
  offset: number
  limit: number
}

/* ------------------------------------------------------------------
 * Phase-2 shapes reconciled against backend/openapi.json (2026-07-02):
 * TransactionReview, BankTemplate*, CleanReport are the real contract.
 * CaseStats and DocumentColumns remain client-side/provisional (no
 * backend equivalent yet) — see notes on each.
 * ------------------------------------------------------------------ */

/** POST /transactions/{id}/review — corrections are flat fields per the contract. */
export interface TransactionReview {
  action: 'confirm' | 'correct' | 'exclude'
  txn_date?: string | null
  amount_inr?: string | null
  direction?: Direction | null
  narration_raw?: string | null
  channel?: string | null
}

/** POST /cases/{id}/clean response — the cleaning pass summary. */
export interface CleanReport {
  transactions: number
  balance_breaks: number
  duplicate_pairs: number
  reversal_pairs: number
}

/** GET/POST /templates — header_signature is the normalized '|'-joined header row. */
export interface BankTemplateIn {
  name: string
  bank?: string | null
  header_signature: string
  mapping: Record<string, string>
}

export interface BankTemplateOut extends BankTemplateIn {
  id: string
  created_at: string
}

/**
 * Case-level stats for the dashboard shell. No single backend endpoint —
 * the real adapter composes it from transactions/documents queries; the
 * cleaning numbers come from POST /clean (see CleanReport).
 */
export interface CaseStats {
  case_id: string
  documents_count: number
  transactions_count: number
  needs_review_count: number
  flagged_count: number
  accounts_count: number
  round_trips_count: number
  cleaning: {
    duplicates_flagged: number
    reversals_detected: number
    balance_breaks: number
  }
}

/**
 * Raw extracted grid of an unparseable document, for the mapping UI.
 * PROVISIONAL: no backend endpoint yet (mock-only) — Person A's template
 * auto-application task will define the real source of raw columns.
 */
export interface DocumentColumns {
  document_id: string
  filename: string
  bank_hint: string | null
  columns: Array<{
    index: number
    header: string
    samples: string[]
  }>
}

export type CanonicalField =
  | 'txn_date'
  | 'narration'
  | 'reference_id'
  | 'debit'
  | 'credit'
  | 'amount_signed'
  | 'balance'
  | 'ignore'

/** The officer's mapping choice from the modal: column index → canonical field. */
export interface ColumnTemplate {
  bank_name: string
  mapping: Record<number, CanonicalField>
}

/* ------------------------------------------------------------------
 * Phase-3 analysis shapes (real contract — backend/app/services/analysis.py)
 * ------------------------------------------------------------------ */

/** POST /cases/{id}/analyze response. */
export interface AnalysisSummary {
  cleaning: CleanReport
  transactions: number
  flagged: number
  [key: string]: unknown
}

/** Cytoscape element data. Node sizes/colors derive from these fields. */
export interface GraphNodeData {
  id: string
  label: string
  own_account: boolean
  inflow: string
  outflow: string
  txn_count: number
  accumulator?: boolean
  suspicion: 'high' | 'medium' | 'low'
}

/**
 * confirmed — same UTR/RRN seen in both accounts' statements
 * probable  — matched by amount + timing across two uploaded statements
 * external  — one-sided: seen only in one statement, the other bank's
 *             statement is not in the case
 */
export type EdgeTier = 'confirmed' | 'probable' | 'external'

export interface GraphEdgeData {
  id: string
  source: string
  target: string
  amount: string
  tier: EdgeTier
  reference: string | null
  channel: string
  when: string
  txn_ids: string[]
}

export interface CaseGraph {
  nodes: Array<{ data: GraphNodeData }>
  edges: Array<{ data: GraphEdgeData }>
}

export interface RoundTrip {
  loop_id: string
  path: string[]
  hops: number
  amount_out: string
  amount_back: string
  pct_returned: number
  elapsed_hours: number
  score: number
  edges: Array<{
    source: string
    target: string
    amount: string
    tier: EdgeTier
    reference: string | null
    when: string
    txn_ids: string[]
  }>
}

export interface CommonIdentifier {
  identifier: string
  names: string[]
  seen_in_accounts: string[]
  distinct_senders: number
  txn_count: number
}

export type DispositionBucket =
  | 'cash'
  | 'cheque'
  | 'redirected'
  | 'merchant'
  | 'internal'
  | 'unclassified'

export interface Disposition {
  total_debits: string
  buckets: Record<DispositionBucket, { amount: string; pct: number }>
}

export type ExportKind = 'report.pdf' | 'standardized.pdf' | 'case.xlsx'

/** POST /reports/sign — server-side HMAC signature for a generated report. */
export interface ReportSignatureOut {
  verify_id: string
  signature: string
  signed_at: string
  case_id: string
  report_type: string
}

/** GET /reports/verify/{id} — authenticity check result. */
export interface ReportVerification {
  valid: boolean
  case_id: string
  fir_number: string | null
  report_type: string
  content_hash: string
  signed_at: string
}

export type TrailStopRule = 'tranche' | 'balance'

export interface TrailHop {
  txn_id: string
  txn_date: string
  narration: string
  channel: string
  counterparty: string | null
  /** Portion of THIS debit funded by the tracked credit. */
  attributed: string
  debit_total: string
}

export interface Trail {
  credit_txn_id: string
  credit_amount: string
  pre_credit_balance: string | null
  hops: TrailHop[]
  spent: string
  resting: string
  stop_rule: TrailStopRule
  stopped_early: boolean
}
