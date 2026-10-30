import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisputeQueuePage } from '../pages/DisputeQueuePage';
import { CaseInvestigationPage } from '../pages/CaseInvestigationPage';
import { AppShell } from '../components/layout/AppShell';
import { CommandPalette } from '../components/layout/CommandPalette';
import { OverviewPage } from '../pages/OverviewPage';
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

const d = (over: Record<string, unknown>): any => ({ id: 'D-X', source: 'synthetic', status: 'OPEN', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', outcome: null, amount: 100, currency: 'USD', response_due_date: null, created_at: null,
  priority_score: 30, priority_factors: [], evidence_status: 'PARTIAL', buyer_claim: 'x', buyer_reference: 'Alex', merchant_reference: 'Shop', transaction_id: 'T', assigned_to: 'Abhinav Chitturi', collaborators: [], is_high_profile: false, ai_owned: false, ...over });

describe('An investigator sees only their own cases', () => {
  const list = [d({ id: 'D-OWN' }), d({ id: 'D-SHARED', assigned_to: 'Susmitha', collaborators: ['Abhinav Chitturi'] }), d({ id: 'D-SHARED2', collaborators: ['Susmitha', 'Jahnavi'] })];

  it('their list is called Your cases, and the manager\'s is All Disputes', async () => {
    global.fetch = vi.fn().mockImplementation(() => ok(list)) as any;
    const { unmount } = mount(<DisputeQueuePage />, '/queue');
    expect(await screen.findByRole('heading', { name: 'Your cases' })).toBeInTheDocument();
    expect(screen.getByText(/including any a colleague has shared with you/)).toBeInTheDocument();
    // No manager-only tabs, and no separate "Your cases" tab, since the whole list is theirs.
    for (const tab of [/^Your cases/, /High profile/, /^Unassigned/, /With the AI Agent/]) expect(screen.queryByRole('tab', { name: tab })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Distribute cases/ })).not.toBeInTheDocument();
    unmount();
    signInAs('MANAGER');
    mount(<DisputeQueuePage />, '/queue');
    expect(await screen.findByRole('heading', { name: 'All Disputes' })).toBeInTheDocument();
  });

  it('shows who a case has been shared with', async () => {
    global.fetch = vi.fn().mockImplementation(() => ok(list)) as any;
    mount(<DisputeQueuePage />, '/queue');
    await screen.findByText('D-OWN');
    expect(screen.getByText(/Shared with Susmitha, Jahnavi/)).toBeInTheDocument();
    expect(screen.getByText('Owner: Susmitha')).toBeInTheDocument();                 // a case shared with you still says who owns it
  });

  it('the manager\'s own list includes cases shared with them', async () => {
    signInAs('MANAGER');
    global.fetch = vi.fn().mockImplementation(() => ok([d({ id: 'D-HERS', assigned_to: 'PayPal' }), d({ id: 'D-SHARED', assigned_to: 'Susmitha', collaborators: ['PayPal'] }), d({ id: 'D-OTHER' })])) as any;
    mount(<DisputeQueuePage />, '/queue?view=mine');
    expect(await screen.findByText('D-HERS')).toBeInTheDocument();
    expect(screen.getByText('D-SHARED')).toBeInTheDocument();
    expect(screen.queryByText('D-OTHER')).not.toBeInTheDocument();
  });

  it('the sidebar and the overview talk about "your" cases, not all of them', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => ok(url.includes('/dashboard/summary') ? { environment_mode: 'demo', total_open_disputes: 2, approaching_deadline_count: 1, missing_evidence_count: 0, awaiting_review_count: 0, new_cases_count: 1,
      waiting_on_parties_count: 0, ai_owned_count: 0, unassigned_count: 0, high_profile_count: 0, my_cases_count: 2, pending_admin_review_count: 0, disputes_by_reason: [], priority_distribution: { high: 0, medium: 0, low: 0 },
      recent_activity: [], action_outcomes_summary: { success: 0, failed: 0, pending: 0 } } : url.endsWith('/notifications') ? { unread: 0, items: [], open_alerts: [] } : [])) as any;
    mount(<OverviewPage />);
    expect(await screen.findByRole('button', { name: 'View your cases' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View all cases' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Distribute cases/ })).not.toBeInTheDocument();
  });

  it('the search bar offers only their own cases', async () => {
    global.fetch = vi.fn().mockImplementation(() => ok([])) as any;
    mount(<CommandPalette open onClose={() => undefined} />, '/');
    fireEvent.change(screen.getByLabelText('Command search'), { target: { value: 'alex' } });
    expect(await screen.findByText('See all your cases matching “alex”')).toBeInTheDocument();
    expect(screen.queryByText(/See every case/)).not.toBeInTheDocument();
    expect(screen.queryByText('Patterns')).not.toBeInTheDocument();         // the manager's page isn't offered
  });
});

describe('Sharing a case with another investigator', () => {
  const calls: { url: string; method?: string; body?: any }[] = [];
  const dispute = (over: Record<string, unknown> = {}): any => ({ ...d({ id: 'D-1', amount: 450 }), transaction: null, order: null, evidence_items: [], latest_brief_id: null, claim_points: [], proposed_outcome: null, proposed_reason: null,
    proposed_by: null, proposed_at: null, review_note: null, reviewed_by: null, seller_settled_at: null, buyer_settled_at: null, decided_by: null, ai_verdict: null, ai_rationale: null, manager_assigned: null,
    parent_dispute_id: null, appeal_number: null, ...over });
  const api = (disp: any, collaborators: any[] = [], removeResult: () => Promise<any> = () => ok({ success: true })) => {
    calls.length = 0;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.endsWith('/collaborators') && init?.method === 'POST') return ok({ name: 'Jahnavi' });
      if (url.includes('/collaborators/') && init?.method === 'DELETE') return removeResult();
      if (url.endsWith('/collaborators')) return ok({ owner: disp.assigned_to, collaborators });
      if (url.endsWith('/people')) return ok([{ id: 'U-a', name: 'Abhinav Chitturi' }, { id: 'U-s', name: 'Susmitha' }, { id: 'U-j', name: 'Jahnavi' }]);
      if (url.endsWith('/timeline') || url.endsWith('/messages') || url.endsWith('/similar-cases') || url.endsWith('/emails') || url.includes('/flags') || url.endsWith('/users')) return ok([]);
      if (url.endsWith('/appeals')) return ok({ parent: null, appeals: [] });
      if (url.endsWith('/evidence-summary')) return ok({ seller: [], buyer: [], records: [] });
      if (url.includes('/brief')) return ok({ id: 'B', dispute_id: 'D-1', generated_at: '', provider: 'rule_based', model: null, summary: 's', structured_findings: [], evidence_gaps: [], recommendations: [], generation_status: 'SUCCESS' });
      if (url.includes('/api/disputes/D-1')) return ok(disp);
      return ok([]);
    }) as any;
    mount(<CaseInvestigationPage />, '/investigate/D-1', '/investigate/:disputeId');
  };
  const col = (name: string, user_id: string) => ({ id: `COL-${user_id}`, user_id, name, added_by: 'Abhinav Chitturi', created_at: '2026-01-01T10:00:00' });

  it('says who else is on the case, and offers colleagues who are not already on it', async () => {
    api(dispute({ collaborators: ['Susmitha'] }), [col('Susmitha', 'U-s')]);
    const bar = await screen.findByLabelText('Who is on this case');
    expect(within(bar).getByText('Also on this case:')).toBeInTheDocument();
    expect(within(bar).getByText('Susmitha')).toBeInTheDocument();
    await waitFor(() => expect(within(bar).getAllByRole('option').map((o) => o.textContent)).toEqual(['Share with…', 'Jahnavi']));   // not the owner (you), not Susmitha who is already on it
  });

  it('adds a colleague, who is then on the case', async () => {
    api(dispute());
    const bar = await screen.findByLabelText('Who is on this case');
    expect(within(bar).getByText('Only you on this case.')).toBeInTheDocument();
    await waitFor(() => expect(within(bar).getByRole('option', { name: 'Jahnavi' })).toBeInTheDocument());
    const add = within(bar).getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    fireEvent.change(within(bar).getByLabelText('Share this case with'), { target: { value: 'U-j' } });
    fireEvent.click(add);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/disputes/D-1/collaborators'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/collaborators'))!.body).toEqual({ user_id: 'U-j' });
    expect(await screen.findByText('Jahnavi is now on this case.')).toBeInTheDocument();
  });

  it('the owner can take a colleague off', async () => {
    api(dispute({ collaborators: ['Susmitha'] }), [col('Susmitha', 'U-s')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Take Susmitha off this case' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')!.url).toMatch(/\/disputes\/D-1\/collaborators\/U-s$/);
  });

  it('someone helping on a case can leave it, but cannot remove the other helpers', async () => {
    api(dispute({ assigned_to: 'Susmitha', collaborators: ['Abhinav Chitturi', 'Jahnavi'] }), [col('Abhinav Chitturi', 'U-a'), col('Jahnavi', 'U-j')]);
    const bar = await screen.findByLabelText('Who is on this case');
    expect(within(bar).getByText('(you)')).toBeInTheDocument();
    expect(await within(bar).findByRole('button', { name: 'Leave this case' })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Take Jahnavi off this case' })).not.toBeInTheDocument();
  });

  it('the manager can take anyone off any case', async () => {
    signInAs('MANAGER');
    api(dispute({ assigned_to: 'Susmitha', collaborators: ['Abhinav Chitturi', 'Jahnavi'] }), [col('Abhinav Chitturi', 'U-a'), col('Jahnavi', 'U-j')]);
    const bar = await screen.findByLabelText('Who is on this case');
    expect(await within(bar).findByRole('button', { name: 'Take Abhinav Chitturi off this case' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Take Jahnavi off this case' })).toBeInTheDocument();
  });

  it("shows the server's reason when someone can't be added", async () => {
    api(dispute());
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/collaborators') && init?.method === 'POST') return fail('Jahnavi is blocked.');
      if (url.endsWith('/collaborators')) return ok({ owner: 'Abhinav Chitturi', collaborators: [] });
      if (url.endsWith('/people')) return ok([{ id: 'U-j', name: 'Jahnavi' }]);
      return (global.fetch as any).getMockImplementation?.()?.(url, init) ?? ok([]);
    }) as any;
    mount(<CaseInvestigationPage />, '/investigate/D-1', '/investigate/:disputeId');
    const bars = await screen.findAllByLabelText('Who is on this case');
    const bar = bars[bars.length - 1];
    await waitFor(() => expect(within(bar).getByRole('option', { name: 'Jahnavi' })).toBeInTheDocument());
    fireEvent.change(within(bar).getByLabelText('Share this case with'), { target: { value: 'U-j' } });
    fireEvent.click(within(bar).getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Jahnavi is blocked.')).toBeInTheDocument();
  });

  it('a decided case can no longer be shared, but still shows who worked on it', async () => {
    api(dispute({ status: 'RESOLVED', outcome: 'SELLER_FAVOR', collaborators: ['Susmitha'] }), [col('Susmitha', 'U-s')]);
    const bar = await screen.findByLabelText('Who is on this case');
    expect(within(bar).getByText('Susmitha')).toBeInTheDocument();
    expect(within(bar).queryByLabelText('Share this case with')).not.toBeInTheDocument();
  });

  it('a case with nobody on it and already decided shows nothing', async () => {
    api(dispute({ status: 'RESOLVED', outcome: 'SELLER_FAVOR' }));
    await screen.findByText('Decided. No further action.');
    expect(screen.queryByLabelText('Who is on this case')).not.toBeInTheDocument();
  });
});
