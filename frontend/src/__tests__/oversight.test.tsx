import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from '../pages/LoginPage';
import { BlockedScreen } from '../pages/BlockedScreen';
import { TeamPage } from '../pages/TeamPage';
import { CaseInvestigationPage } from '../pages/CaseInvestigationPage';
import { AlertsBanner } from '../components/layout/AlertsBanner';
import { NotificationBell } from '../components/layout/NotificationBell';
import { ToastProvider } from '../components/ui/kit';
import { readSession } from '../lib/auth';
import { signInAs, signOut } from './session';

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const fail = (status: number, detail: unknown) => Promise.resolve({ ok: false, status, statusText: 'err', json: () => Promise.resolve({ detail }) });
function LocationProbe() { const l = useLocation(); return <div data-testid="loc">{l.pathname + l.search}</div>; }
const mount = (ui: React.ReactElement, route = '/', path = '*') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MemoryRouter initialEntries={[route]}><Routes><Route path={path} element={ui} /></Routes><LocationProbe /></MemoryRouter></ToastProvider>
  </QueryClientProvider>,
);
afterEach(() => signOut());

describe('Login', () => {
  const api = (loginResult: () => Promise<any> = () => ok({ token: 'tok', user: { id: 'U1', username: 'investigator', name: 'Abhinav Chitturi', role: 'INVESTIGATOR', is_blocked: false, strikes: 0, block_at: 10, notify_at: 3 } })) => {
    const calls: { url: string; body?: any }[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.endsWith('/auth/login')) return loginResult();
      return ok([]);
    }) as any;
    return calls;
  };

  it('signs in with a username and password and keeps the session', async () => {
    const calls = api();
    mount(<LoginPage />);
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'investigator' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(submit);
    await waitFor(() => expect(readSession()?.token).toBe('tok'));
    expect(calls.find((c) => c.url.endsWith('/auth/login'))!.body).toEqual({ username: 'investigator', password: 'secret' });
    expect(readSession()!.user.name).toBe('Abhinav Chitturi');
  });

  it('says so when the password is wrong, and does not sign you in', async () => {
    api(() => fail(401, "That username and password don't match."));
    mount(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'manager' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That username and password don't match.");
    expect(readSession()).toBeNull();
  });

  it('has no shortcut buttons and never asks the server for accounts or passwords', async () => {
    const calls = api();
    mount(<LoginPage />);
    expect(screen.queryByLabelText('Demo accounts')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1); // just Sign in
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(0);
  });
});

describe('Blocked account', () => {
  it('tells the investigator why, and that only a manager can fix it', () => {
    mount(<BlockedScreen user={{ id: 'U', username: 'i', name: 'Susmitha', role: 'INVESTIGATOR', email: null, is_blocked: true, blocked_reason: '10 strikes', strikes: 10, block_at: 10, notify_at: 3 }} />);
    const box = screen.getByRole('alert');
    expect(box).toHaveTextContent('Your account is blocked');
    expect(box).toHaveTextContent('10 strikes');
    expect(box).toHaveTextContent('Speak to your manager');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();  // nowhere to go
  });
});

describe('Manager alerts', () => {
  const alert = (over: Record<string, unknown> = {}) => ({ id: 'ALT-1', kind: 'STRIKES', user_id: 'U1', dispute_id: null, title: 'Susmitha has 3 strikes', body: 'The AI reviewer has overturned 3 decisions.', strike_level: 3,
    status: 'OPEN', created_at: '2026-01-01T10:00:00', last_notified_at: '2026-01-01T11:00:00', reminder_count: 0, sorted_by: null, sorted_at: null, sorted_note: null, ...over });
  const api = (alerts: any[], items: any[] = []) => {
    const calls: { url: string; body?: any }[] = [];
    let open = alerts;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.includes('/alerts/') && url.endsWith('/sorted')) { open = []; return ok({}); }
      if (url.endsWith('/notifications')) return ok({ unread: items.filter((i) => !i.read).length, items, open_alerts: open });
      if (url.endsWith('/notifications/read')) return ok({ marked_read: 1 });
      return ok([]);
    }) as any;
    return calls;
  };

  it('pins every open alert to the top for a manager, and Sorted takes it away', async () => {
    signInAs('MANAGER');
    const calls = api([alert(), alert({ id: 'ALT-2', kind: 'BLOCKED', title: 'Susmitha is blocked', body: 'Reached 10 strikes.' })]);
    mount(<AlertsBanner />);
    const rows = await screen.findAllByRole('alert');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Susmitha has 3 strikes.');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Sorted' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/alerts/ALT-1/sorted'))).toBe(true));
    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
  });

  it('says how many times it has reminded you', async () => {
    signInAs('MANAGER');
    api([alert({ reminder_count: 3 })]);
    mount(<AlertsBanner />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Reminded 3×');
  });

  it('shows nothing to an investigator, and never asks for the alerts', async () => {
    signInAs('INVESTIGATOR');
    const calls = api([alert()]);
    mount(<AlertsBanner />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/notifications'))).toBe(false);
  });

  it('the bell counts what is unread, lists it, and marks it read when opened', async () => {
    signInAs('MANAGER');
    const calls = api([], [
      { id: 'N1', alert_id: 'ALT-1', kind: 'STRIKES', title: 'Reminder: Susmitha has 3 strikes', body: 'Still not sorted.', dispute_id: null, created_at: '2026-01-01T12:00:00', read: false },
      { id: 'N2', alert_id: null, kind: 'APPEAL', title: 'Appeal opened: D-1-A1', body: 'A new case.', dispute_id: 'D-1-A1', created_at: '2026-01-01T09:00:00', read: true },
    ]);
    mount(<NotificationBell />);
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    fireEvent.click(bell);
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(within(panel).getByText('Reminder: Susmitha has 3 strikes')).toBeInTheDocument();
    expect(within(panel).getByText('Appeal opened: D-1-A1')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/notifications/read'))).toBe(true));
  });
});

describe('Team', () => {
  const member = (over: Record<string, unknown> = {}) => ({ id: 'U2', name: 'Susmitha', username: 'investigator2', is_blocked: false, blocked_reason: null, strikes: 4, notify_at: 3, block_at: 10, open_cases: 2,
    history: [{ dispute_id: 'D-1', reason: 'The AI reviewer overturned the decision.', created_at: '2026-01-01T10:00:00', voided: false, void_reason: null }, { dispute_id: 'D-2', reason: 'Overturned.', created_at: '2026-01-02T10:00:00', voided: true, void_reason: 'A manager upheld them.' }], ...over });
  const api = (team: any[]) => {
    const calls: { url: string; body?: any }[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.endsWith('/team')) return ok(team);
      if (url.endsWith('/unblock')) return ok({ success: true });
      return ok([]);
    }) as any;
    return calls;
  };

  it('is for managers only', async () => {
    api([member()]);
    mount(<TeamPage />);
    expect(await screen.findByText('Managers only')).toBeInTheDocument();
  });

  it('shows each investigator\'s strikes against the limit, and the cases behind them', async () => {
    signInAs('MANAGER');
    api([member()]);
    mount(<TeamPage />);
    const list = await screen.findByLabelText('Investigators');
    expect(within(list).getByText('Needs attention')).toBeInTheDocument();
    expect(within(list).getByText('4 / 10')).toBeInTheDocument();
    expect(within(list).getByRole('progressbar', { name: 'Susmitha strikes' })).toHaveAttribute('aria-valuenow', '4');
    const history = within(list).getByLabelText('Susmitha strike history');
    expect(within(history).getByText('D-1')).toBeInTheDocument();
    expect(within(history).getByText('Removed')).toBeInTheDocument();  // a strike a manager took back
    expect(within(list).queryByRole('button', { name: /Unblock/ })).not.toBeInTheDocument();
  });

  it('a blocked investigator can be unblocked by the manager', async () => {
    signInAs('MANAGER');
    const calls = api([member({ is_blocked: true, strikes: 10, blocked_reason: '10 strikes. The limit is 10.' })]);
    mount(<TeamPage />);
    expect(await screen.findByText('Blocked')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unblock' }));
    fireEvent.change(screen.getByLabelText('Note for unblocking Susmitha'), { target: { value: 'Talked it through.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unblock Susmitha' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/team/U2/unblock'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/unblock'))!.body).toEqual({ note: 'Talked it through.' });
  });
});

describe('Case: the AI reviewer, flags, emails and appeals', () => {
  const base = (over: Record<string, unknown> = {}): any => ({
    id: 'D-1', source: 'synthetic', status: 'RESOLVED', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', outcome: 'BUYER_FAVOR', amount: 450, currency: 'USD', response_due_date: null, created_at: null,
    priority_score: 58, priority_factors: [], evidence_status: 'COMPLETE', buyer_claim: 'Never arrived.', buyer_reference: 'Alex', merchant_reference: 'TechStore', transaction_id: 'T-1',
    transaction: null, order: null, evidence_items: [], latest_brief_id: null, claim_points: [], assigned_to: 'Abhinav Chitturi', proposed_outcome: 'SELLER_FAVOR', proposed_reason: 'The carrier delivered it.',
    proposed_by: 'Abhinav Chitturi', proposed_at: null, review_note: null, reviewed_by: 'AI reviewer', seller_settled_at: null, buyer_settled_at: null, decided_by: 'AI', ai_verdict: 'OVERTURN',
    ai_rationale: 'No proof of delivery on file.', manager_assigned: null, parent_dispute_id: null, appeal_number: null, ...over });
  const calls: { url: string; body?: any }[] = [];
  const api = (d: any, extra: { flags?: any[]; appeals?: any; emails?: any[] } = {}) => {
    calls.length = 0;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.endsWith('/flag')) return ok({ success: true, flag_id: 'F1' });
      if (url.endsWith('/ai-verdict/simulate')) return ok({ status: 'RESOLVED', outcome: 'SELLER_FAVOR' });
      if (url.endsWith('/appeal/simulate')) return ok({ opened: true, appeal_id: 'D-1-A1' });
      if (url.includes('/flags')) return ok(extra.flags ?? []);
      if (url.endsWith('/appeals')) return ok(extra.appeals ?? { parent: null, appeals: [] });
      if (url.endsWith('/emails')) return ok(extra.emails ?? []);
      if (url.endsWith('/timeline') || url.endsWith('/messages') || url.endsWith('/similar-cases')) return ok([]);
      if (url.endsWith('/evidence-summary')) return ok({ seller: [], buyer: [], records: [] });
      if (url.includes('/brief')) return ok({ id: 'B', dispute_id: 'D-1', generated_at: '', provider: 'rule_based', model: null, summary: 's', structured_findings: [], evidence_gaps: [], recommendations: [], generation_status: 'SUCCESS' });
      if (url.includes('/api/disputes/D-1')) return ok(d);
      return ok([]);
    }) as any;
  };
  const page = () => mount(<CaseInvestigationPage />, '/investigate/D-1', '/investigate/:disputeId');

  it('shows what the AI reviewer decided and why, and that the investigator took a strike', async () => {
    api(base());
    page();
    const card = await screen.findByLabelText('AI review');
    expect(within(card).getByText('Overturned the investigator')).toBeInTheDocument();
    expect(within(card).getByText('No proof of delivery on file.')).toBeInTheDocument();
    expect(within(card).getByText(/counted as a strike/)).toBeInTheDocument();
  });

  it('the investigator can flag the AI with reasons, but only once they have written enough', async () => {
    api(base());
    page();
    fireEvent.click(await screen.findByRole('button', { name: /Flag this AI decision/ }));
    const send = screen.getByRole('button', { name: /Send to a manager/ });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('What the AI got wrong'), { target: { value: 'too short' } });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('What the AI got wrong'), { target: { value: 'The signed delivery record is on file and the AI never mentioned it.' } });
    fireEvent.click(send);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/disputes/D-1/flag'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/flag'))!.body).toEqual({ points: 'The signed delivery record is on file and the AI never mentioned it.' });
  });

  it('shows where a flag stands once it is raised, and offers no second one', async () => {
    api(base(), { flags: [{ id: 'F1', status: 'OVERTURNED', resolved_by: 'PayPal', resolution_note: 'You were right.' }] });
    page();
    expect(await screen.findByText('A manager overturned the AI')).toBeInTheDocument();
    expect(screen.getByText(/PayPal: You were right\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Flag this AI decision/ })).not.toBeInTheDocument();
  });

  it('a manager sees that the investigator took a strike and can overturn the AI, but cannot flag', async () => {
    signInAs('MANAGER');
    api(base());
    page();
    const card = await screen.findByLabelText('AI review');
    expect(within(card).getByText(/received a strike/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Flag this AI decision/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Overturn decision/ })).toBeInTheDocument();
  });

  it('does not offer a flag when the AI agreed with the investigator', async () => {
    api(base({ ai_verdict: 'APPROVE', decided_by: 'INVESTIGATOR', outcome: 'SELLER_FAVOR' }));
    page();
    const card = await screen.findByLabelText('AI review');
    expect(within(card).getByText('Approved the investigator')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Flag this AI decision/ })).not.toBeInTheDocument();
  });

  it('in the demo, lets you stand in for the AI reviewer while a decision waits for it', async () => {
    api(base({ status: 'PENDING_AI_REVIEW', outcome: null, ai_verdict: null, decided_by: null }));
    page();
    const demo = await screen.findByLabelText('Demo: stand in for the AI reviewer');
    fireEvent.click(within(demo).getByRole('button', { name: 'AI overturns' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/ai-verdict/simulate'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/ai-verdict/simulate'))!.body).toMatchObject({ verdict: 'OVERTURN', outcome: 'BUYER_FAVOR' }); // the opposite of the investigator's call
  });

  it('in the demo, lets the buyer email to appeal a decided case', async () => {
    api(base({ ai_verdict: 'APPROVE', decided_by: 'INVESTIGATOR', outcome: 'SELLER_FAVOR' }));
    page();
    fireEvent.click(await screen.findByRole('button', { name: /Buyer emails to appeal/ }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/appeal/simulate'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/appeal/simulate'))!.body).toMatchObject({ party: 'BUYER' });
  });

  it('links an appeal to the case it appeals, and says a manager has joined', async () => {
    api(base({ id: 'D-1', status: 'OPEN', outcome: null, ai_verdict: null, decided_by: null, parent_dispute_id: 'D-0', appeal_number: 1, manager_assigned: 'PayPal' }));
    page();
    const card = await screen.findByLabelText('Appeal');
    expect(within(card).getByText(/appeal 1 of/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'D-0' })).toBeInTheDocument();
    expect(card).toHaveTextContent('PayPal (manager) is joined');
  });

  it('lists the appeal cases opened from a decided case', async () => {
    api(base({ ai_verdict: 'APPROVE', decided_by: 'INVESTIGATOR' }), { appeals: { parent: null, appeals: [{ id: 'D-1-A1', status: 'OPEN', assigned_to: 'Susmitha', manager: 'PayPal' }] } });
    page();
    const card = await screen.findByLabelText('Appeals of this case');
    expect(within(card).getByRole('button', { name: 'D-1-A1' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Susmitha, with PayPal');
    expect(screen.queryByRole('button', { name: /Buyer emails to appeal/ })).not.toBeInTheDocument(); // one is already open
  });

  it('shows the emails sent about the case, saying which were kept here and not sent', async () => {
    api(base({ ai_verdict: 'APPROVE', decided_by: 'INVESTIGATOR' }), { emails: [{ id: 'E1', direction: 'OUT', to: 'alex@buyers.example', from: 'disputes@x', subject: 'Decision on dispute D-1', party: 'BUYER', status: 'QUEUED', created_at: '2026-01-01T10:00:00',
      body: 'We collected proof from both sides.\n\nThe seller provided:\n  - Carrier tracking' }] });
    page();
    fireEvent.click(await screen.findByRole('tab', { name: /Emails/ }));
    const list = await screen.findByLabelText('Emails');
    expect(within(list).getByText('To alex@buyers.example')).toBeInTheDocument();
    expect(within(list).getByText('Kept here, not sent')).toBeInTheDocument();
    expect(within(list).getByText(/The seller provided/)).toBeInTheDocument();
  });
});
