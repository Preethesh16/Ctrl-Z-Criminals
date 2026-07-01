import { motion } from 'framer-motion'
import type { ComponentProps } from 'react'
import { hoverScale } from '../../theme/motion'

type ButtonProps = ComponentProps<typeof motion.button> & {
  variant?: 'primary' | 'secondary'
}

/** Theme-token button. Never style buttons ad hoc — extend this. */
export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const base = variant === 'primary' ? 'btn-primary' : 'btn-secondary'
  return <motion.button {...hoverScale} className={`${base} ${className}`} {...props} />
}
