import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router-dom';

import { OverviewPage } from '../pages/OverviewPage';
import { DisputeQueuePage } from '../pages/DisputeQueuePage';
import { CaseInvestigationPage } from '../pages/CaseInvestigationPage';
import { SimilarCasesPage } from '../pages/SimilarCasesPage';
import { PatternInsightsPage } from '../pages/PatternInsightsPage';
import { AuditTrailPage } from '../pages/AuditTrailPage';
import { SettingsPage } from '../pages/SettingsPage';

const disputeFixture = {
  id: 'DEMO-DSP-1042',
  external_dispute_id: 'PP-1042',
  source: 'synthetic',
  transaction_id: 'DEMO-TXN-1042',
  buyer_reference: 'Alex Morgan',
  merchant_reference: 'TechStore',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
  status: 'WAITING_FOR_SELLER_RESPONSE',
  amount: 450.0,
  currency: 'USD',
  priority_score: 72.0,
  priority_factors: [
    { name: 'Urgency', weight: 35.0, contribution: 20.0, explanation: 'Due in 48h' }
  ],
  evidence_status: 'CONFLICTING',
  buyer_claim: 'The item never arrived'
};

function LocationProbe() { const l = useLocation(); return <div data-testid="loc">{l.pathname + l.search}</div>; }

// Helper wrapper
function renderWithProviders(ui: React.ReactElement, initialRoute = '/') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        {ui}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ResolveIQ Page Components Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Overview Dashboard with real KPI summaries', async () => {
    // Mock fetch for dashboard summary
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/dashboard/summary')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            environment_mode: 'demo',
            total_open_disputes: 12,
            approaching_deadline_count: 3,
            missing_evidence_count: 4,
            awaiting_review_count: 5,
            new_cases_count: 2,
            waiting_on_parties_count: 3,
            my_cases_count: 4,
            pending_admin_review_count: 2,
            disputes_by_reason: [
              { reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', count: 6 },
              { reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', count: 3 }
            ],
            priority_distribution: { high: 4, medium: 5, low: 3 },
            recent_activity: [
              {
                id: 'AUD-01',
                dispute_id: 'DEMO-DSP-1042',
                actor: 'system',
                action: 'PRIORITY_SCORED',
                status: 'SUCCESS',
                result_summary: 'Computed priority score 72.0/100',
                created_at: new Date().toISOString()
              }
            ],
            action_outcomes_summary: { success: 8, failed: 1, pending: 2 }
          })
        });
      }
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });

    renderWithProviders(<OverviewPage />);

    // Check loading indicator or text
    await waitFor(() => {
      expect(screen.getByText(/Dispute Overview/i)).toBeInTheDocument();
      expect(screen.getAllByText('12').length).toBeGreaterThan(0); // total open disputes
      expect(screen.getAllByText('3').length).toBeGreaterThan(0); // deadlines < 48h
    });

    // The tiles tell PayPal where cases stand: yours, open, due soon, waiting on a party, ready to decide.
    for (const [label, count, hint] of [
      ['Your cases', '4', 'Open cases you are working'],
      ['Open disputes', '12', '2 new, nobody asked yet'],
      ['Decide within 48 hours', '3', 'Target date is close or passed'],
      ['Waiting on replies', '3', 'Seller or buyer owes us evidence'],
      ['Ready to decide', '5', 'Time is up or the evidence is in. Decide now'],
    ]) {
      const tile = screen.getByText(label).closest('button') as HTMLElement;
      expect(tile).toHaveTextContent(count);
      expect(tile).toHaveTextContent(hint);
    }
    expect(screen.queryByText(/Waiting on seller/i)).not.toBeInTheDocument(); // the old seller-side tile

    // Each tile opens the matching list. "Your cases" is the investigator's own.
    fireEvent.click(screen.getByText('Your cases').closest('button') as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/queue?view=mine'));
  });

  it('renders Dispute Queue with search, sorting and cases', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/disputes/DEMO-DSP-1042')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...disputeFixture, transaction: null, order: null, latest_brief_id: null,
            evidence_items: [{ id: 'EV-1', dispute_id: 'DEMO-DSP-1042', evidence_type: 'CARRIER_TRACKING', description: 'UPS tracking', availability_status: 'AVAILABLE' }] })
        });
      }
      if (url.includes('/api/disputes')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            disputeFixture
          ])
        });
      }
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });

    renderWithProviders(<DisputeQueuePage />);

    await waitFor(() => {
      expect(screen.getByText(/All Disputes/i)).toBeInTheDocument();
      expect(screen.getByText('DEMO-DSP-1042')).toBeInTheDocument();
      expect(screen.getByText(/Alex Morgan/i)).toBeInTheDocument();
      expect(screen.getByText('USD 450.00')).toBeInTheDocument();
    });

    // The eye is a quick peek: it opens the preview drawer with the priority factors, without leaving the list.
    fireEvent.click(screen.getByRole('button', { name: /Quick view DEMO-DSP-1042/i }));
    await waitFor(() => {
      expect(screen.getByText(/Why this priority/i)).toBeInTheDocument();
      expect(screen.getByText(/Due in 48h/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Open full case/i })).toBeInTheDocument();
    });
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/\?open=DEMO-DSP-1042$/); // still on the list
  });

  it('clicking a dispute opens it in Investigation', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([disputeFixture, { ...disputeFixture, id: 'DEMO-DSP-2000', priority_score: 20 }]) });
    renderWithProviders(<DisputeQueuePage />);
    fireEvent.click(await screen.findByText('DEMO-DSP-2000')); // not the first row, and not the "top" case
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/investigate/DEMO-DSP-2000'));
  });

  it('filters the queue with quick views and shows live counts', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([
        disputeFixture,
        { ...disputeFixture, id: 'DEMO-DSP-2000', priority_score: 20, evidence_status: 'COMPLETE', status: 'UNDER_REVIEW' },
      ]) }));

    renderWithProviders(<DisputeQueuePage />);
    await waitFor(() => expect(screen.getByText('DEMO-DSP-2000')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: /Urgent/i }));
    await waitFor(() => {
      expect(screen.getByText('DEMO-DSP-1042')).toBeInTheDocument();
      expect(screen.queryByText('DEMO-DSP-2000')).not.toBeInTheDocument();
    });
  });

  it('renders Similar Cases Precedent Explorer', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/similar-cases')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              id: 'HIST-CASE-203',
              source: 'synthetic',
              reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
              case_summary: 'INR claim where tracking showed delivered, address verification unknown.',
              evidence_attributes: { tracking_status: 'DELIVERED', address_match: 'unknown' },
              outcome: 'SETTLED',
              amount: 450.0,
              currency: 'USD'
            }
          ])
        });
      }
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });

    renderWithProviders(<SimilarCasesPage />);

    await waitFor(() => {
      expect(screen.getByText(/Historical Precedent Explorer/i)).toBeInTheDocument();
      expect(screen.getByText('HIST-CASE-203')).toBeInTheDocument();
      expect(screen.getByText(/INR claim where tracking showed delivered/i)).toBeInTheDocument();
      expect(screen.getAllByText('Settled').length).toBeGreaterThan(1); // filter option + outcome badge
    });
  });

  it('renders Pattern Insights Page with authorized clusters', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/patterns')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              pattern_id: 'PAT-EVID-01',
              title: 'Recurring Missing Documentation: Proof Of Delivery Signature',
              category: 'EVIDENTIARY_GAP',
              case_count: 5,
              supporting_record_ids: ['DEMO-DSP-1042', 'DEMO-DSP-1044'],
              time_window: 'Active Portfolio',
              why_noteworthy: '5 active disputes lack proof of delivery signature.',
              data_source: 'synthetic_seed_dataset',
              severity: 'HIGH',
              recommended_action: 'Require signature confirmation for high value shipments.'
            }
          ])
        });
      }
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });

    renderWithProviders(<PatternInsightsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Authorized Dataset Pattern Insights/i)).toBeInTheDocument();
      expect(screen.getByText(/Recurring Missing Documentation/i)).toBeInTheDocument();
      expect(screen.getByText(/5 Disputed Cases/i)).toBeInTheDocument();
      expect(screen.getByText('HIGH SEVERITY')).toBeInTheDocument();
    });
  });

  it('renders Settings Page with live connectivity test buttons', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/integrations/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            environment_mode: 'demo',
            paypal: {
              environment: 'sandbox',
              base_url: 'https://api-m.sandbox.paypal.com',
              configured: false,
              client_id_configured: false,
              client_secret_configured: false
            },
            ai_provider: {
              provider: 'none',
              model: 'gemini-1.5-pro',
              configured: false,
              fallback_available: true
            },
            database: { type: 'SQLite', url_sanitized: 'local_sqlite' },
            features_available: {
              demo_mode: true,
              synthetic_brief_generation: true,
              similar_cases_search: true
            }
          })
        });
      }
      return Promise.reject(new Error(`Unhandled url: ${url}`));
    });

    renderWithProviders(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Settings & Integration Connectivity/i)).toBeInTheDocument();
      expect(screen.getAllByText(/DEMO MODE/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/PayPal Sandbox REST API/i)).toBeInTheDocument();
      expect(screen.getByText(/Deterministic Rule Engine/i)).toBeInTheDocument();
    });
  });
});
