import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/cases', label: 'Cases' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/flow-graph', label: 'Flow Graph' },
  { to: '/money-trail', label: 'Money Trail' },
  { to: '/holding-time', label: 'Holding Time' },
  { to: '/reports', label: 'Reports' },
]

/** App shell: dark sidebar + routed main area. All pages render inside this. */
export function AppLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 bg-sidebar text-text-inverse flex flex-col">
        <div className="px-6 py-6">
          <div className="text-card-title font-bold">TraceNet</div>
          <div className="text-label text-gray-400 mt-1">Bank Statement Analysis</div>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-control px-3 py-2 text-body ${
                  isActive ? 'bg-primary text-text-inverse' : 'text-gray-300 hover:bg-white/10'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-6 py-4 text-label text-gray-500">
          Evidence stays on this machine.
          <br />
          Nothing is sent to the internet.
        </div>
      </aside>

      <main className="flex-1 bg-background p-8 min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
