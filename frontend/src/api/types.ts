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
