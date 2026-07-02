import type { ComponentProps } from 'react'

/** Theme-token labelled input. Large hit target for officer use. */
export function Input({
  label,
  error,
  className = '',
  id,
  ...props
}: ComponentProps<'input'> & { label: string; error?: string }) {
  const inputId = id ?? label.toLowerCase().replace(/\W+/g, '-')
  return (
    <div className={className}>
      <label htmlFor={inputId} className="block text-label uppercase text-text-secondary mb-1">
        {label}
      </label>
      <input
        id={inputId}
        className={`w-full rounded-control border bg-surface px-3 py-2 text-body text-text-primary outline-none focus:border-primary ${
          error ? 'border-danger' : 'border-border'
        }`}
        {...props}
      />
      {error && <p className="text-label text-danger mt-1">{error}</p>}
    </div>
  )
}
