/**
 * TraceNet motion tokens — shared framer-motion presets.
 * Import these instead of defining animations ad hoc per page:
 *
 *   import { fadeIn, slideUp, staggerContainer, hoverScale, transitions } from '@/theme/motion'
 *   <motion.div variants={slideUp} initial="hidden" animate="visible" />
 *
 * Keep animations subtle and fast — this is an investigation tool,
 * not a marketing site. Do not exceed these durations.
 */
import type { Variants, Transition } from 'framer-motion'

/** Standard transitions: easeOut for entrances, easeInOut for interactive states. */
export const transitions = {
  enter: { duration: 0.25, ease: 'easeOut' } satisfies Transition,
  interactive: { duration: 0.2, ease: 'easeInOut' } satisfies Transition,
}

/** Fade in place — page/panel content. */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitions.enter },
}

/** Fade + rise 8px — cards, list rows, drawers. */
export const slideUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transitions.enter },
}

/** Parent wrapper that staggers its children (use with fadeIn/slideUp on children). */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
}

/**
 * Hover/tap feedback for interactive cards and buttons.
 * Spread onto a motion element: <motion.button {...hoverScale} />
 */
export const hoverScale = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
  transition: transitions.interactive,
}
