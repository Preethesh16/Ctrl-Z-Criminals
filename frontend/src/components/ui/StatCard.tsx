import { motion } from 'framer-motion'
import { slideUp } from '../../theme/motion'

/** Dashboard headline stat: label + big tabular number + optional colored tag. */
export function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string | number
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const toneClass = {
    default: 'text-text-primary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone]
  return (
    <motion.div variants={slideUp} className="card">
      <div className="text-label uppercase text-text-secondary mb-2">{label}</div>
      <div className={`stat-number ${toneClass}`}>{value}</div>
    </motion.div>
  )
}
