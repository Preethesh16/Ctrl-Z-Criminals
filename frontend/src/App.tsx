import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { CasesPage } from './pages/CasesPage'
import { CaseWizardPage } from './pages/CaseWizardPage'
import { DashboardPage } from './pages/DashboardPage'
import { FlowGraphPage } from './pages/FlowGraphPage'
import { MoneyTrailPage } from './pages/MoneyTrailPage'
import { ReportPage } from './pages/ReportPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/cases" replace />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/cases/:caseId/wizard" element={<CaseWizardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/flow-graph" element={<FlowGraphPage />} />
          <Route path="/money-trail" element={<MoneyTrailPage />} />
          <Route path="/reports" element={<ReportPage />} />
          <Route path="*" element={<Navigate to="/cases" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
