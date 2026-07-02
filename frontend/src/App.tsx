import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { CasesPage } from './pages/CasesPage'
import { CaseWizardPage } from './pages/CaseWizardPage'
import { DashboardPage } from './pages/DashboardPage'
import { PlaceholderPage } from './pages/PlaceholderPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/cases" replace />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/cases/:caseId/wizard" element={<CaseWizardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route
            path="/flow-graph"
            element={
              <PlaceholderPage
                title="Flow Graph"
                description="The money-flow network with round-trip highlighting arrives in Phase 3."
              />
            }
          />
          <Route
            path="/money-trail"
            element={
              <PlaceholderPage
                title="Money Trail"
                description="Pick any credit and follow it rupee-by-rupee (FIFO) — arrives in Phase 3."
              />
            }
          />
          <Route
            path="/reports"
            element={
              <PlaceholderPage
                title="Reports"
                description="Court-ready investigation report, standardized extraction PDF, and Excel export arrive in Phase 4."
              />
            }
          />
          <Route path="*" element={<Navigate to="/cases" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
