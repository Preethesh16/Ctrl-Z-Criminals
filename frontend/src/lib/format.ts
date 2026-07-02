/** Display helpers. Money arrives as decimal strings in INR; dates display IST. */

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

/** "500000.00" → "₹5,00,000". Display only — never do arithmetic on the parsed value. */
export function formatINR(amount: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return ''
  const value = Number(amount)
  return Number.isFinite(value) ? inrFormatter.format(value) : amount
}

const istDate = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

export function formatDateIST(iso: string): string {
  return istDate.format(new Date(iso))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
