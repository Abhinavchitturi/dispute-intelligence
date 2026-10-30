import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OverviewPage } from '../pages/OverviewPage';
import { DisputeQueuePage } from '../pages/DisputeQueuePage';
import { CaseInvestigationPage } from '../pages/CaseInvestigationPage';
import { AlertsBanner } from '../components/layout/AlertsBanner';
import { ToastProvider } from '../components/ui/kit';
import { signInAs, signOut } from './session';

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
function LocationProbe() { const l = useLocation(); return <div data-testid="loc">{l.pathname + l.search}</div>; }
const mount = (ui: React.ReactElement, route = '/', path = '*') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MemoryRouter initialEntries={[route]}><Routes><Route path={path} element={ui} /></Routes><LocationProbe /></MemoryRouter></ToastProvider>
  </QueryClientProvider>,
);
afterEach(() => signOut());

const soon = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const d = (over: Record<string, unknown>): any => ({ id: 'D-X', source: 'synthetic', status: 'OPEN', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', outcome: null, amount: 100, currency: 'USD', response_due_date: soon(72),
  created_at: null, priority_score: 30, priority_factors: [], evidence_status: 'MISSING', buyer_claim: 'It never came.', buyer_reference: 'Alex', merchant_reference: 'Shop', transaction_id: 'T', assigned_to: 'Susmitha',
  is_high_profile: false, ai_owned: false, ai_owned_at: null, ...over });
const summary = (over: Record<string, unknown> = {}) => ({ environment_mode: 'demo', total_open_disputes: 6, approaching_deadline_count: 2, missing_evidence_count: 1, awaiting_review_count: 0, new_cases_count: 3, waiting_on_parties_count: 0,
  ai_owned_count: 1, unassigned_count: 3, high_profile_count: 1, my_cases_count: 0, pending_admin_review_count: 0, disputes_by_reason: [], priority_distribution: { high: 1, medium: 1, low: 1 }, recent_activity: [],
  action_outcomes_summary: { success: 0, failed: 0, pending: 0 }, ...over });

const CASES = [
  d({ id: 'D-CALM', assigned_to: null, priority_score: 22, response_due_date: soon(110) }),
  d({ id: 'D-HOT', assigned_to: null, priority_score: 83, response_due_date: soon(5) }),
  d({ id: 'D-MID', assigned_to: null, priority_score: 51, response_due_date: soon(48) }),
  d({ id: 'D-OWNED', assigned_to: 'Susmitha', priority_score: 90 }),
  d({ id: 'D-AI', assigned_to: 'AI Agent', ai_owned: true, ai_owned_at: soon(-2), priority_score: 95, response_due_date: soon(-2) }),
  d({ id: 'D-DONE', status: 'RESOLVED', outcome: 'SELLER_FAVOR', assigned_to: null }),
];

describe('Unassigned cases lead the manager\'s screen', () => {
  const api = () => {
    const calls: string[] = [];
    global.fetch = vi.fn().mockImplementation((url: string) => {
      calls.push(url);
      if (url.includes('/dashboard/summary')) return ok(summary());
      if (url.endsWith('/notifications')) return ok({ unread: 0, items: [], open_alerts: [] });
      if (url.endsWith('/users')) return ok([]);
      if (url.includes('/disputes')) return ok(url.includes('unassigned=true') ? CASES.filter((c) => !c.assigned_to).sort((a, b) => b.priority_score - a.priority_score) : CASES);
      return ok([]);
    }) as any;
    return calls;
  };

  it('puts the cases nobody owns at the very top, most urgent first, each with its deadline and an owner box', async () => {
    signInAs('MANAGER');
    const calls = api();
    mount(<OverviewPage />);
    const box = await screen.findByLabelText('Nobody owns these yet');
    const ids = within(box).getAllByText(/^D-/).map((e) => e.textContent);
    expect(ids).toEqual(['D-HOT', 'D-MID', 'D-CALM']);                                       // the highest score first
    expect(within(box).getAllByRole('combobox')).toHaveLength(3);                          // assign right there
    expect(box).toHaveTextContent('goes to the AI Agent to handle itself');
    expect(within(box).queryByText('D-OWNED')).not.toBeInTheDocument();                    // it already has an owner
    expect(within(box).queryByText('D-DONE')).not.toBeInTheDocument();                     // and decided cases don't need one
    expect(calls.some((c) => c.includes('unassigned=true'))).toBe(true);
    // It sits above the stat tiles, so it is the first thing the manager sees.
    const tiles = screen.getByText('High profile').closest('section') as HTMLElement;
    expect(box.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: /All 3/ }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/queue?view=unassigned'));
  });

  it('shows nothing when every case has an owner, and nothing to an investigator', async () => {
    signInAs('MANAGER');
    global.fetch = vi.fn().mockImplementation((url: string) => ok(url.includes('/dashboard/summary') ? summary({ unassigned_count: 0 }) : url.endsWith('/notifications') ? { unread: 0, items: [], open_alerts: [] } : url.includes('/disputes') ? [CASES[3]] : [])) as any;
    const { unmount } = mount(<OverviewPage />);
    await screen.findByText('High profile');
    expect(screen.queryByLabelText('Nobody owns these yet')).not.toBeInTheDocument();
    unmount();
    signOut(); api();
    mount(<OverviewPage />);
    await screen.findByText('Decide within 48 hours');
    expect(screen.queryByLabelText('Nobody owns these yet')).not.toBeInTheDocument();
  });

  it('the Disputes page has an Unassigned tab and a With the AI Agent tab for the manager only', async () => {
    signInAs('MANAGER'); api();
    const { unmount } = mount(<DisputeQueuePage />, '/queue?view=unassigned');
    expect(await screen.findByText('D-HOT')).toBeInTheDocument();
    expect(screen.getByText('D-CALM')).toBeInTheDocument();
    expect(screen.queryByText('D-OWNED')).not.toBeInTheDocument();
    expect(screen.queryByText('D-AI')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Unassigned/ })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: /With the AI Agent/ })).toHaveTextContent('1');
    unmount();
    signOut();
    mount(<DisputeQueuePage />, '/queue');
    await screen.findByText('D-HOT');
    expect(screen.queryByRole('tab', { name: /^Unassigned/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /With the AI Agent/ })).not.toBeInTheDocument();
  });

  it('shows which cases the AI Agent has, and why', async () => {
    signInAs('MANAGER'); api();
    mount(<DisputeQueuePage />, '/queue?view=ai');
    expect(await screen.findByText('D-AI')).toBeInTheDocument();
    expect(screen.getByText('With the AI Agent. Nobody took it in time.')).toBeInTheDocument();
    expect(screen.queryByText('D-HOT')).not.toBeInTheDocument();
  });
});

describe('The AI Agent takes a case nobody took', () => {
  it('the manager gets a pinned alert that takes them to the case', async () => {
    signInAs('MANAGER');
    global.fetch = vi.fn().mockImplementation((url: string) => ok(url.endsWith('/notifications')
      ? { unread: 1, items: [], open_alerts: [{ id: 'ALT-1', kind: 'AI_TAKEOVER', user_id: null, dispute_id: 'D-AI', title: 'AI Agent took D-AI', body: 'Nobody took D-AI in its 5 days. The AI Agent is now handling the whole case.', strike_level: null,
        status: 'OPEN', created_at: '2026-01-01T10:00:00', last_notified_at: '2026-01-01T10:00:00', reminder_count: 0, sorted_by: null, sorted_at: null, sorted_note: null }] } : [])) as any;
    mount(<AlertsBanner />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('AI Agent took D-AI.');
    expect(alert).toHaveTextContent('handling the whole case');
    fireEvent.click(within(alert).getByRole('button', { name: 'Look into it' }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/investigate/D-AI'));
  });

  const page = (over: Record<string, unknown>, role: 'MANAGER' | 'INVESTIGATOR' = 'MANAGER') => {
    signInAs(role);
    const dispute = { ...d({ id: 'D-1', amount: 450, assigned_to: 'AI Agent', ai_owned: true, ai_owned_at: soon(-1) }), transaction: null, order: null, evidence_items: [], latest_brief_id: null, claim_points: [], proposed_outcome: null,
      proposed_reason: null, proposed_by: null, proposed_at: null, review_note: null, reviewed_by: null, seller_settled_at: null, buyer_settled_at: null, decided_by: null, ai_verdict: null, ai_rationale: null,
      manager_assigned: null, parent_dispute_id: null, appeal_number: null, ...over };
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/timeline') || url.endsWith('/messages') || url.endsWith('/similar-cases') || url.endsWith('/emails') || url.includes('/flags') || url.endsWith('/users')) return ok([]);
      if (url.endsWith('/appeals')) return ok({ parent: null, appeals: [] });
      if (url.endsWith('/evidence-summary')) return ok({ seller: [], buyer: [], records: [] });
      if (url.includes('/brief')) return ok({ id: 'B', dispute_id: 'D-1', generated_at: '', provider: 'rule_based', model: null, summary: 's', structured_findings: [], evidence_gaps: [], recommendations: [], generation_status: 'SUCCESS' });
      if (url.includes('/api/disputes/D-1')) return ok(dispute);
      return ok([]);
    }) as any;
    mount(<CaseInvestigationPage />, '/investigate/D-1', '/investigate/:disputeId');
  };

  it('says on the case that the AI Agent is handling it, and why', async () => {
    page({});
    const card = await screen.findByLabelText('With the AI Agent');
    expect(card).toHaveTextContent('Nobody took it before its deadline');
    expect(card).toHaveTextContent('from start to finish');
    expect(card).toHaveTextContent('overturn whatever the AI Agent decides');            // the manager's options
  });

  it('an investigator cannot act on a case the AI Agent has', async () => {
    page({}, 'INVESTIGATOR');
    await screen.findByLabelText('With the AI Agent');
    expect(screen.queryByRole('button', { name: /^Take action$/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('With the AI Agent').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('With the AI Agent')).not.toHaveTextContent('overturn whatever');
  });

  it('the manager can still act on it', async () => {
    page({});
    await screen.findByLabelText('With the AI Agent');
    expect((await screen.findAllByRole('button', { name: /^Take action$/ })).length).toBeGreaterThan(0);
  });

  it('once the AI Agent decides, the card says it handled the whole case, with no strike, and the manager can overturn it', async () => {
    page({ status: 'RESOLVED', outcome: 'BUYER_FAVOR', decided_by: 'AI', ai_verdict: 'DIRECT', ai_rationale: 'No proof of delivery.' });
    const card = await screen.findByLabelText('AI review');
    expect(within(card).getByText('AI Agent')).toBeInTheDocument();
    expect(within(card).getByText('Handled the whole case')).toBeInTheDocument();
    expect(within(card).getByText('No proof of delivery.')).toBeInTheDocument();
    expect(card).not.toHaveTextContent('strike');                                           // there was no investigator to blame
    expect(screen.queryByLabelText('With the AI Agent')).not.toBeInTheDocument();           // it is decided now
    expect(screen.getByRole('button', { name: /Overturn decision/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Flag this AI decision/ })).not.toBeInTheDocument();
  });
});
