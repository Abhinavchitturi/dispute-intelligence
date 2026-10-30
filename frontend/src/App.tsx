import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
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
import { ManagerReviewPage } from './pages/ManagerReviewPage';
import { TeamPage } from './pages/TeamPage';
import { LoginPage } from './pages/LoginPage';
import { BlockedScreen } from './pages/BlockedScreen';
import { useSession, useSessionKey } from './lib/auth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 30, // 30 seconds
      retry: 1,
    },
  },
});

/**
 * Throws away everything fetched for the previous person the moment someone signs in or out. Without this, the next person briefly sees
 * the last one's name, counts and lists until each query happens to refresh.
 */
function ForgetPreviousPerson() {
  const qc = useQueryClient();
  const key = useSessionKey();
  const last = React.useRef(key);
  React.useLayoutEffect(() => {
    if (last.current !== key) { last.current = key; qc.clear(); }
  }, [key, qc]);
  return null;
}

/** Nobody gets past the front door without signing in, and a blocked investigator gets a page that explains why. */
function Gate({ children }: { children: React.ReactNode }) {
  const session = useSession();
  if (!session) return <LoginPage />;
  if (session.user.role === 'INVESTIGATOR' && session.user.is_blocked) return <BlockedScreen user={session.user} />;
  return <>{children}</>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
      <ForgetPreviousPerson />
      <BrowserRouter>
        <Gate>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="queue" element={<DisputeQueuePage />} />
            <Route path="investigate" element={<InvestigationLanding />} />
            <Route path="priority" element={<PriorityScoresPage />} />
            <Route path="messages" element={<MessagesPage />} />
            <Route path="manager" element={<ManagerReviewPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="investigate/:disputeId" element={<CaseInvestigationPage />} />
            <Route path="similar" element={<SimilarCasesPage />} />
            <Route path="patterns" element={<PatternInsightsPage />} />
            <Route path="audit" element={<AuditTrailPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        </Gate>
      </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
