import { useState } from 'react'
import { Button } from './Button'

/**
 * Report-download button that expands into exactly two format choices:
 * PDF or Excel. Used everywhere a report can be downloaded.
 */
export function DownloadChoice({
  label,
  onPdf,
  onExcel,
  busy = false,
  variant = 'secondary',
}: {
  label: string
  onPdf: () => void
  onExcel: () => void
  busy?: boolean
  variant?: 'primary' | 'secondary'
}) {
  const [open, setOpen] = useState(false)

  if (busy) {
    return (
      <Button variant={variant} disabled>
        Preparing…
      </Button>
    )
  }

  if (!open) {
    return (
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-label text-text-secondary">Format:</span>
      <Button
        onClick={() => {
          setOpen(false)
          onPdf()
        }}
      >
        PDF
      </Button>
      <Button
        onClick={() => {
          setOpen(false)
          onExcel()
        }}
      >
        Excel
      </Button>
      <Button variant="secondary" onClick={() => setOpen(false)}>
        ✕
      </Button>
    </span>
  )
}
