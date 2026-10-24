import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { OverviewPage } from './pages/OverviewPage';
import { DisputeQueuePage } from './pages/DisputeQueuePage';
import { CaseInvestigationPage } from './pages/CaseInvestigationPage';
import { SimilarCasesPage } from './pages/SimilarCasesPage';
import { PatternInsightsPage } from './pages/PatternInsightsPage';
import { AuditTrailPage } from './pages/AuditTrailPage';
import { SettingsPage } from './pages/SettingsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 30, // 30 seconds
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="queue" element={<DisputeQueuePage />} />
            <Route path="investigate" element={<Navigate to="/investigate/DEMO-DSP-1042" replace />} />
            <Route path="investigate/:disputeId" element={<CaseInvestigationPage />} />
            <Route path="similar" element={<SimilarCasesPage />} />
            <Route path="patterns" element={<PatternInsightsPage />} />
            <Route path="audit" element={<AuditTrailPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
