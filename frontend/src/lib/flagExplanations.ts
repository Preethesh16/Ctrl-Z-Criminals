import type { TransactionFlag } from '../api/types'

/**
 * One plain-English line per detection rule — shown wherever a flag appears.
 * Officers read these, keep them jargon-free (CLAUDE.md design north star).
 */
const EXPLANATIONS: Record<string, string> = {
  'FD-01': 'Suspiciously round amount — fraud transfers are often exact round figures.',
  'FD-02': 'Money left this account almost immediately after arriving.',
  'FD-03': 'Transaction at an odd hour (late night) when genuine activity is rare.',
  'FD-04': 'Amount kept just below ₹50,000 — a common trick to avoid attention.',
  'FD-05': 'Sudden burst of transactions compared to this account’s normal pace.',
  'FD-06': 'Large activity on a newly opened or previously quiet account.',
  'FD-07-BALANCE-BREAK': 'The running balance doesn’t add up here — possible missing or altered rows.',
  'FD-08': 'Most of this account’s money goes to a single counterparty.',
  'DUPLICATE-SUSPECT': 'Looks identical to another transaction — possibly the same entry twice.',
  REVERSED: 'This payment failed and was refunded — excluded from the money-flow analysis.',
  'ROUND-TRIP': 'Part of a loop where money returned toward where it started.',
  'ML-ANOMALY': 'Statistically unusual compared to the rest of this case’s transactions.',
  _CONFIDENCE: 'Multiple independent signals fired on this transaction.',
}

export function explainFlag(flag: TransactionFlag): string {
  // Rules may carry suffixes (FD-01-ROUND-FIGURE); match the longest known prefix.
  const rule = String(flag.rule)
  const known = Object.keys(EXPLANATIONS)
    .filter((k) => rule === k || rule.startsWith(`${k}`) || rule.startsWith(`${k.split('-')[0]}-${k.split('-')[1] ?? ''}`))
    .sort((a, b) => b.length - a.length)[0]
  if (known) return EXPLANATIONS[known]
  if (typeof flag.why === 'string') return flag.why
  return 'Flagged by the detection engine.'
}

/** Short chip label for a rule, e.g. "FD-04" or "Round trip". */
export function flagLabel(flag: TransactionFlag): string {
  const rule = String(flag.rule)
  if (rule === 'ROUND-TRIP') return 'Round trip'
  if (rule === 'ML-ANOMALY') return 'Unusual'
  if (rule === 'DUPLICATE-SUSPECT') return 'Duplicate?'
  if (rule === 'REVERSED') return 'Reversed'
  if (rule === '_CONFIDENCE') return 'High confidence'
  return rule.split('-').slice(0, 2).join('-')
}