import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './components/ui/kit';
import { AppShell } from './components/layout/AppShell';
import { OverviewPage } from './pages/OverviewPage';
import { DisputeQueuePage } from './pages/DisputeQueuePage';
import { CaseInvestigationPage } from './pages/CaseInvestigationPage';
import { InvestigationLanding } from './pages/InvestigationLanding';
import { MessagesPage } from './pages/MessagesPage';
import { PriorityScoresPage } from './pages/PriorityScoresPage';
import { SimilarCasesPage } from './pages/SimilarCasesPage';
import { PatternInsightsPage } from './pages/PatternInsightsPage';
import { AuditTrailPage } from './pages/AuditTrailPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminReviewPage } from './pages/AdminReviewPage';

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
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="queue" element={<DisputeQueuePage />} />
            <Route path="investigate" element={<InvestigationLanding />} />
            <Route path="priority" element={<PriorityScoresPage />} />
            <Route path="messages" element={<MessagesPage />} />
            <Route path="admin" element={<AdminReviewPage />} />
            <Route path="investigate/:disputeId" element={<CaseInvestigationPage />} />
            <Route path="similar" element={<SimilarCasesPage />} />
            <Route path="patterns" element={<PatternInsightsPage />} />
            <Route path="audit" element={<AuditTrailPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
