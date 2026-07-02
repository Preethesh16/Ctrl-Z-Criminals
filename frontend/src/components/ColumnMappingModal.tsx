import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api/client'
import type { CanonicalField, DocumentColumns, JobOut } from '../api/types'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { fadeIn, slideUp } from '../theme/motion'

const FIELD_SLOTS: Array<{ field: CanonicalField; label: string; hint: string }> = [
  { field: 'txn_date', label: 'Date', hint: 'When the transaction happened' },
  { field: 'narration', label: 'Narration', hint: 'The description text' },
  { field: 'reference_id', label: 'Reference / Txn ID', hint: 'UTR, RRN, cheque no.' },
  { field: 'debit', label: 'Debit (money out)', hint: 'Withdrawal column' },
  { field: 'credit', label: 'Credit (money in)', hint: 'Deposit column' },
  { field: 'amount_signed', label: 'Single amount column', hint: 'If debit & credit share one column' },
  { field: 'balance', label: 'Balance', hint: 'Balance after the transaction' },
]

const REQUIRED_HELP =
  'Date and Narration are required, plus either Debit + Credit or the single amount column.'

/**
 * Guided mapping for unrecognized statement layouts: drag (or tap) a raw
 * column from the statement onto the field it represents, preview sample
 * rows, save as a reusable template for that bank.
 */
export function ColumnMappingModal({
  documentId,
  onClose,
  onMapped,
}: {
  documentId: string
  onClose: () => void
  /** Called with the re-parse job once the template is saved. */
  onMapped: (job: JobOut) => void
}) {
  const [doc, setDoc] = useState<DocumentColumns | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [mapping, setMapping] = useState<Partial<Record<CanonicalField, number>>>({})
  const [selectedColumn, setSelectedColumn] = useState<number | null>(null)
  const [bankName, setBankName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .getDocumentColumns(documentId)
      .then((d) => {
        setDoc(d)
        setBankName(d.bank_hint ?? '')
      })
      .catch(() => setLoadError(true))
  }, [documentId])

  const assignedIndexes = new Set(Object.values(mapping))

  function assign(field: CanonicalField, columnIndex: number) {
    setMapping((prev) => {
      const next = { ...prev }
      // A column can serve only one field — unassign it elsewhere first.
      for (const key of Object.keys(next) as CanonicalField[]) {
        if (next[key] === columnIndex) delete next[key]
      }
      next[field] = columnIndex
      return next
    })
    setSelectedColumn(null)
    setError('')
  }

  function unassign(field: CanonicalField) {
    setMapping((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  async function save() {
    const hasAmount =
      (mapping.debit !== undefined && mapping.credit !== undefined) ||
      mapping.amount_signed !== undefined
    if (mapping.txn_date === undefined || mapping.narration === undefined || !hasAmount) {
      setError(REQUIRED_HELP)
      return
    }
    if (!bankName.trim()) {
      setError('Give the bank a name so this mapping can be reused.')
      return
    }
    setSaving(true)
    try {
      const inverted: Record<number, CanonicalField> = {}
      for (const [field, index] of Object.entries(mapping)) {
        inverted[index as number] = field as CanonicalField
      }
      const job = await api.saveColumnTemplate(documentId, {
        bank_name: bankName.trim(),
        mapping: inverted,
      })
      onMapped(job)
    } catch {
      setError('Could not save the mapping — try again.')
      setSaving(false)
    }
  }

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      exit="hidden"
      className="fixed inset-0 z-50 flex items-center justify-center bg-sidebar/60 p-8"
      onClick={onClose}
    >
      <motion.div
        variants={slideUp}
        className="card w-full max-w-4xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-section text-text-primary mb-1">Map the columns</h2>
        <p className="text-body text-text-secondary mb-5">
          We couldn't recognize this statement's layout
          {doc ? ` (${doc.filename})` : ''}. Tap a column from the statement, then tap the field
          it belongs to. {REQUIRED_HELP}
        </p>

        {loadError && (
          <p className="text-body text-danger">
            Could not load the statement's columns. Close and try re-uploading the file.
          </p>
        )}
        {!doc && !loadError && <p className="text-body text-text-secondary">Loading columns…</p>}

        {doc && (
          <div className="grid grid-cols-2 gap-6">
            {/* Raw columns from the statement */}
            <div>
              <h3 className="text-label uppercase text-text-secondary mb-2">
                Columns found in the statement
              </h3>
              <div className="flex flex-col gap-2">
                {doc.columns.map((col) => {
                  const isAssigned = assignedIndexes.has(col.index)
                  const isSelected = selectedColumn === col.index
                  return (
                    <button
                      key={col.index}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(col.index))}
                      onClick={() => setSelectedColumn(isSelected ? null : col.index)}
                      className={`rounded-control border px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary-soft'
                          : isAssigned
                            ? 'border-success bg-success-soft'
                            : 'border-border bg-surface hover:border-primary'
                      }`}
                    >
                      <div className="text-body font-medium text-text-primary">{col.header}</div>
                      <div className="text-label text-text-secondary truncate">
                        e.g. {col.samples.filter(Boolean).slice(0, 2).join(' · ') || '—'}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Canonical field slots */}
            <div>
              <h3 className="text-label uppercase text-text-secondary mb-2">
                What each column means
              </h3>
              <div className="flex flex-col gap-2">
                {FIELD_SLOTS.map((slot) => {
                  const assigned = mapping[slot.field]
                  const assignedHeader =
                    assigned !== undefined
                      ? doc.columns.find((c) => c.index === assigned)?.header
                      : null
                  return (
                    <div
                      key={slot.field}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        const idx = Number(e.dataTransfer.getData('text/plain'))
                        if (Number.isInteger(idx)) assign(slot.field, idx)
                      }}
                      onClick={() => {
                        if (selectedColumn !== null) assign(slot.field, selectedColumn)
                        else if (assigned !== undefined) unassign(slot.field)
                      }}
                      className={`rounded-control border-2 border-dashed px-3 py-2 cursor-pointer transition-colors ${
                        assignedHeader
                          ? 'border-success bg-success-soft'
                          : selectedColumn !== null
                            ? 'border-primary bg-primary-soft'
                            : 'border-border'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-body font-medium text-text-primary">
                          {slot.label}
                        </span>
                        {assignedHeader ? (
                          <span className="tag bg-success-soft text-success">
                            {assignedHeader} ✕
                          </span>
                        ) : (
                          <span className="text-label text-text-secondary">{slot.hint}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {doc && (
          <div className="mt-6 flex items-end justify-between gap-4 border-t border-border pt-4">
            <Input
              label="Save as template for this bank"
              placeholder="e.g. Sample Co-op Bank"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="w-72"
            />
            <div className="flex gap-3">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save & read statement'}
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-body text-danger mt-3">{error}</p>}
      </motion.div>
    </motion.div>
  )
}
