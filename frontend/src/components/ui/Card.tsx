import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { slideUp } from '../../theme/motion'

/** Theme-token card: white surface, 1px border, 12px radius, subtle shadow, 24px padding. */
export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <motion.div variants={slideUp} className={`card ${className}`}>
      {title && <h3 className="text-card-title text-text-primary mb-4">{title}</h3>}
      {children}
    </motion.div>
  )
}
