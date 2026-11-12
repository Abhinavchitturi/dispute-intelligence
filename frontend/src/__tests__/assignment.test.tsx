import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisputeQueuePage } from '../pages/DisputeQueuePage';
import { OverviewPage } from '../pages/OverviewPage';
import { TeamPage } from '../pages/TeamPage';
import { AlertsBanner } from '../components/layout/AlertsBanner';
import { ToastProvider } from '../components/ui/kit';
import { signInAs, signOut } from './session';

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const fail = (detail: string) => Promise.resolve({ ok: false, status: 400, statusText: 'Bad', json: () => Promise.resolve({ detail }) });
function LocationProbe() { const l = useLocation(); return <div data-testid="loc">{l.pathname + l.search}</div>; }
const mount = (ui: React.ReactElement, route = '/', path = '*') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MemoryRouter initialEntries={[route]}><Routes><Route path={path} element={ui} /></Routes><LocationProbe /></MemoryRouter></ToastProvider>
  </QueryClientProvider>,
);
afterEach(() => signOut());

const PLAN = { unassigned: 30, unassigned_high_profile: 2, people: [
  { id: 'U-a', name: 'Abhinav Chitturi', open_cases: 0, requested: false }, { id: 'U-s', name: 'Susmitha', open_cases: 0, requested: true }, { id: 'U-j', name: 'Jahnavi', open_cases: 0, requested: false }] };
const summary = (over: Record<string, unknown> = {}) => ({ environment_mode: 'demo', total_open_disputes: 32, approaching_deadline_count: 3, missing_evidence_count: 1, awaiting_review_count: 2, new_cases_count: 30, waiting_on_parties_count: 0,
  unassigned_count: 32, high_profile_count: 2, my_cases_count: 0, pending_admin_review_count: 0, disputes_by_reason: [], priority_distribution: { high: 1, medium: 1, low: 1 }, recent_activity: [],
  action_outcomes_summary: { success: 0, failed: 0, pending: 0 }, ...over });

const CASE = { id: 'D-1', source: 'paypal_sandbox', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', status: 'OPEN', amount: 289, currency: 'USD',
  priority_score: 52, evidence_status: 'MISSING', response_due_date: null, created_at: '2026-11-11T06:19:00Z', assigned_to: 'Susmitha',
  buyer_reference: 'John Doe', merchant_reference: 'Test Store', buyer_claim: 'It never arrived.', is_high_profile: false, collaborators: [], ai_owned: false, outcome: null };

const api = (over: Record<string, unknown> = {}) => {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/dashboard/summary')) return ok(summary(over));
    if (url.endsWith('/notifications')) return ok({ unread: 0, items: [], open_alerts: [] });
    if (url.includes('/api/disputes')) return ok([CASE]);
    return ok([]);
  }) as any;
};

describe('Cases are assigned automatically', () => {
  it('the manager has no way to hand cases out on the Disputes page, and sees who each case went to', async () => {
    signInAs('MANAGER'); api();
    mount(<DisputeQueuePage />, '/queue');
    await screen.findByText('D-1');
    expect(screen.getByText('Susmitha')).toBeInTheDocument();                                          // the owner, read-only
    expect(screen.queryByRole('button', { name: /Distribute cases/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Assign / })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Unassigned/ })).not.toBeInTheDocument();
  });

  it("the manager's overview has no Distribute button and no list of cases waiting for an owner", async () => {
    signInAs('MANAGER'); api();
    mount(<OverviewPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Distribute cases/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Nobody owns these yet')).not.toBeInTheDocument();
  });

  it('an investigator with no cases is told new ones come automatically, with nothing to ask for', async () => {
    signInAs('INVESTIGATOR'); api({ my_cases_count: 0 });
    mount(<OverviewPage />);
    const card = await screen.findByLabelText('You have no cases');
    expect(card).toHaveTextContent('assigned automatically');
    expect(screen.queryByRole('button', { name: /Ask for cases/ })).not.toBeInTheDocument();
  });

  it('the Team page has no case requests to sort out', async () => {
    signInAs('MANAGER'); api();
    mount(<TeamPage />, '/team');
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('tab', { name: /Case requests/ })).not.toBeInTheDocument();
  });
});
