import { motion } from 'framer-motion'
import { staggerContainer, fadeIn } from './theme/motion'
import { Button } from './components/ui/Button'
import { Card } from './components/ui/Card'
import { StatCard } from './components/ui/StatCard'

/**
 * Theme showcase shell — replace with real pages (Person B, Phase 1).
 * Demonstrates the sanctioned conventions: dark sidebar, token colors,
 * card/button/tag classes, motion presets. Build every page like this.
 */
const NAV = ['Cases', 'Dashboard', 'Flow Graph', 'Money Trail', 'Reports']

function App() {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar: dark charcoal, white text, primary-blue active item */}
      <aside className="w-60 shrink-0 bg-sidebar text-text-inverse flex flex-col">
        <div className="px-6 py-6 text-card-title font-bold">TraceNet</div>
        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((item, i) => (
            <a
              key={item}
              href="#"
              className={`rounded-control px-3 py-2 text-body ${
                i === 1 ? 'bg-primary text-text-inverse' : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              {item}
            </a>
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <motion.main
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="flex-1 bg-background p-8"
      >
        <motion.header variants={fadeIn} className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-display text-text-primary">Case Dashboard</h1>
            <p className="text-body text-text-secondary mt-1">
              FIR 0042/2026 — theme showcase, replace with real pages
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary">Export Excel</Button>
            <Button>Download Report</Button>
          </div>
        </motion.header>

        <div className="grid grid-cols-4 gap-6 mb-6">
          <StatCard label="Transactions analyzed" value="12,482" />
          <StatCard label="Flagged" value="74" tone="danger" />
          <StatCard label="Round trips" value="3" tone="warning" />
          <StatCard label="Accounts involved" value="27" tone="success" />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Card title="Disposition breakdown">
            <div className="flex gap-2">
              <span className="tag bg-primary-soft text-primary">42% cash</span>
              <span className="tag bg-warning-soft text-warning">9% cheque</span>
              <span className="tag bg-success-soft text-success">49% redirected</span>
            </div>
          </Card>
          <Card title="Common suspicious identifiers">
            <p className="text-body text-text-secondary">
              Chart series colors: primary → secondary → warning → success.
            </p>
          </Card>
        </div>
      </motion.main>
    </div>
  )
}

export default App
