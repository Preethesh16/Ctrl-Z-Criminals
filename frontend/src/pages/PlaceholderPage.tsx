import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { fadeIn } from '../theme/motion'

/**
 * Empty-state page for features landing in later phases.
 * Design rule: every page guides the officer to the next useful action.
 */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <motion.div variants={fadeIn} initial="hidden" animate="visible">
      <h1 className="text-display text-text-primary mb-6">{title}</h1>
      <div className="card max-w-xl">
        <p className="text-body text-text-secondary mb-4">{description}</p>
        <p className="text-body text-text-secondary">
          Start from{' '}
          <Link to="/cases" className="text-primary font-medium">
            Cases
          </Link>
          : create a case and upload bank statements first.
        </p>
      </div>
    </motion.div>
  )
}
