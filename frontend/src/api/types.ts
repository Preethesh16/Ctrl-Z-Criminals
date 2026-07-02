/**
 * API types — PROVISIONAL, hand-written from plan.md §4.1 canonical schema.
 * Replace with types generated from Person A's OpenAPI contract when it lands
 * (end of Phase 1). Any change here must be noted in progress.md.
 *
 * Money is integer paise (never float). Timestamps are UTC ISO strings.
 */

export type CaseStatus = 'draft' | 'ingesting' | 'review' | 'analyzed'

export interface Case {
  id: string
  fir_number: string
  complainant: string
  fraud_amount_paise: number
  incident_date: string
  status: CaseStatus
  created_at: string
  documents_count: number
  transactions_count: number
  flagged_count: number
}

export interface CaseCreate {
  fir_number: string
  complainant: string
  fraud_amount_paise: number
  incident_date: string
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export type JobErrorCode =
  | 'PASSWORD_PROTECTED'
  | 'UNSUPPORTED_FORMAT'
  | 'DUPLICATE_FILE'
  | 'PARSE_FAILED'

export interface Job {
  id: string
  document_id: string
  status: JobStatus
  /** 0..1 */
  progress: number
  transactions_found: number | null
  error_code: JobErrorCode | null
  error_message: string | null
}

export interface UploadResult {
  document_id: string
  job_id: string
  filename: string
  sha256: string
}

export type Channel =
  | 'UPI'
  | 'NEFT'
  | 'IMPS'
  | 'RTGS'
  | 'ATM'
  | 'CHEQUE'
  | 'CASH'
  | 'POS'
  | 'OTHER'

export interface Transaction {
  id: string
  case_id: string
  source_document_id: string
  txn_date: string
  narration: string
  reference_id: string | null
  channel: Channel
  debit_paise: number | null
  credit_paise: number | null
  balance_paise: number | null
  /** 1.0 for digital extraction; OCR confidence otherwise. <0.70 → review queue. */
  extraction_confidence: number
}
