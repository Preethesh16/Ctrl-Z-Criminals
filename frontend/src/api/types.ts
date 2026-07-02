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
  flags: string[]
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
 * Phase-2 PROVISIONAL types — Person A's review/cleaning/template APIs
 * are not published yet; these shapes are Person B's proposal, served
 * by the mock adapter. Reconcile against openapi.json when they land
 * (note any change in progress.md per CLAUDE.md).
 * ------------------------------------------------------------------ */

/** Officer action on a row in the review queue. */
export interface ReviewAction {
  action: 'confirm' | 'correct' | 'exclude'
  /** For 'correct': the fields the officer fixed. */
  corrections?: {
    txn_date?: string
    amount_inr?: string
    direction?: Direction
    narration_raw?: string
  }
}

/** Case-level stats for the dashboard shell. */
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

/** Raw extracted grid of an unparseable document, for the mapping UI. */
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

/** column index → canonical field; saved as a reusable per-bank template. */
export interface ColumnTemplate {
  bank_name: string
  mapping: Record<number, CanonicalField>
}
