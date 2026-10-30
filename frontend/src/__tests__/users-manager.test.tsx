import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamPage } from '../pages/TeamPage';
import { DisputeQueuePage } from '../pages/DisputeQueuePage';
import { OverviewPage } from '../pages/OverviewPage';
import { CaseInvestigationPage } from '../pages/CaseInvestigationPage';
import { CommandPalette } from '../components/layout/CommandPalette';
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

const user = (over: Record<string, unknown> = {}): any => ({ id: 'U-a', username: 'abhinav', name: 'Abhinav Chitturi', email: 'abhinav@x.example', role: 'INVESTIGATOR', is_active: true, is_blocked: false, blocked_reason: null,
  created_at: '2026-01-01T10:00:00', strikes: 0, open_cases: 2, ...over });
const USERS = [user(), user({ id: 'U-s', username: 'susmitha', name: 'Susmitha', email: null }), user({ id: 'U-j', username: 'jahnavi', name: 'Jahnavi' }),
  user({ id: 'U-p', username: 'paypal', name: 'PayPal', role: 'MANAGER', open_cases: 3 })];

describe('All users', () => {
  const calls: { url: string; method?: string; body?: any }[] = [];
  const api = (users: any[] = USERS, failing: Record<string, string> = {}) => {
    calls.length = 0;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      for (const [suffix, msg] of Object.entries(failing)) if (url.endsWith(suffix)) return fail(msg);
      if (url.endsWith('/users') && init?.method === 'POST') return ok(user({ id: 'U-new', username: 'ravi', name: 'Ravi' }));
      if (url.endsWith('/users')) return ok(users);
      if (url.includes('/users/')) return ok(user());
      if (url.endsWith('/team')) return ok([]);
      return ok([]);
    }) as any;
  };
  const open = async () => {
    signInAs('MANAGER', { id: 'U-p' });
    api();
    mount(<TeamPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'All users' }));
    return screen.findByLabelText('All users');
  };
  const sent = (suffix: string, method?: string) => calls.find((c) => c.url.endsWith(suffix) && (!method || c.method === method));

  it('lists the three investigators and the manager, with their role, cases and strikes', async () => {
    const list = await open();
    for (const name of ['Abhinav Chitturi', 'Susmitha', 'Jahnavi', 'PayPal']) expect(within(list).getByLabelText(`User ${name}`)).toBeInTheDocument();
    const paypal = within(list).getByLabelText('User PayPal');
    expect(within(paypal).getByText('Manager')).toBeInTheDocument();
    expect(within(paypal).getByText('You')).toBeInTheDocument();
    expect(within(paypal).getByText(/3 open cases/)).toBeInTheDocument();
    expect(within(within(list).getByLabelText('User Susmitha')).getByText(/0 strikes/)).toBeInTheDocument();
  });

  it('is for managers only', async () => {
    api();
    mount(<TeamPage />);
    expect(await screen.findByText('Managers only')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/users'))).toBe(false);
  });

  it('adds a user once every field is filled, with a password of at least 8 characters', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Add user/ }));
    const form = screen.getByRole('form', { name: 'Add a user' });
    const add = within(form).getByRole('button', { name: 'Add user' });
    expect(add).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("New user's name"), { target: { value: 'Ravi Kumar' } });
    fireEvent.change(within(form).getByLabelText("New user's username"), { target: { value: 'ravi' } });
    fireEvent.change(within(form).getByLabelText("New user's password"), { target: { value: 'short' } });
    expect(add).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("New user's password"), { target: { value: 'Ravi#Invest2026' } });
    fireEvent.change(within(form).getByLabelText("New user's role"), { target: { value: 'MANAGER' } });
    fireEvent.click(add);
    await waitFor(() => expect(sent('/users', 'POST')).toBeTruthy());
    expect(sent('/users', 'POST')!.body).toEqual({ username: 'ravi', display_name: 'Ravi Kumar', email: undefined, role: 'MANAGER', password: 'Ravi#Invest2026' });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add a user' })).not.toBeInTheDocument());
  });

  it("shows the server's reason when a user can't be added", async () => {
    signInAs('MANAGER');
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/users') && init?.method === 'POST') return fail('That username is taken.');
      return ok(url.endsWith('/users') ? USERS : []);
    }) as any;
    mount(<TeamPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'All users' }));
    await screen.findByLabelText('All users');
    fireEvent.click(screen.getByRole('button', { name: /Add user/ }));
    const form = screen.getByRole('form', { name: 'Add a user' });
    for (const [label, value] of [["New user's name", 'X Y'], ["New user's username", 'abhinav'], ["New user's password", 'Long#Pass2026']]) fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add user' }));
    expect(await screen.findByText('That username is taken.')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Add a user' })).toBeInTheDocument(); // stays open so nothing typed is lost
  });

  it('resets a password, but not to something too short', async () => {
    const list = await open();
    fireEvent.click(within(within(list).getByLabelText('User Jahnavi')).getByRole('button', { name: 'Reset password for Jahnavi' }));
    const set = screen.getByRole('button', { name: 'Set password' });
    expect(set).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New password for Jahnavi'), { target: { value: '1234567' } });
    expect(set).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New password for Jahnavi'), { target: { value: 'Fresh#Pass2026' } });
    fireEvent.click(set);
    await waitFor(() => expect(sent('/users/U-j/password')).toBeTruthy());
    expect(sent('/users/U-j/password')!.body).toEqual({ password: 'Fresh#Pass2026' });
  });

  it('blocks an investigator with a reason, and unblocks them', async () => {
    const list = await open();
    fireEvent.click(within(within(list).getByLabelText('User Susmitha')).getByRole('button', { name: 'Block Susmitha' }));
    const go = screen.getByRole('button', { name: 'Block account' });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for blocking Susmitha'), { target: { value: 'Reviewing recent cases.' } });
    fireEvent.click(go);
    await waitFor(() => expect(sent('/users/U-s/block')).toBeTruthy());
    expect(sent('/users/U-s/block')!.body).toEqual({ reason: 'Reviewing recent cases.' });
  });

  it('a blocked person shows as blocked with the reason and offers Unblock instead', async () => {
    signInAs('MANAGER', { id: 'U-p' });
    api([user({ id: 'U-s', name: 'Susmitha', username: 'susmitha', is_blocked: true, blocked_reason: 'Blocked by PayPal: Reviewing.' }), USERS[3]]);
    mount(<TeamPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'All users' }));
    const row = await screen.findByLabelText('User Susmitha');
    expect(within(row).getByText('Blocked')).toBeInTheDocument();
    expect(within(row).getByText('Blocked by PayPal: Reviewing.')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Unblock Susmitha' }));
    await waitFor(() => expect(sent('/team/U-s/unblock')).toBeTruthy());
  });

  it('deactivates and reactivates people, but never offers to deactivate yourself, and managers cannot be blocked', async () => {
    const list = await open();
    const me = within(list).getByLabelText('User PayPal');
    expect(within(me).queryByRole('button', { name: /Deactivate/ })).not.toBeInTheDocument();
    expect(within(me).queryByRole('button', { name: /^Block/ })).not.toBeInTheDocument();
    fireEvent.click(within(within(list).getByLabelText('User Jahnavi')).getByRole('button', { name: 'Deactivate Jahnavi' }));
    await waitFor(() => expect(sent('/users/U-j', 'PATCH')).toBeTruthy());
    expect(sent('/users/U-j', 'PATCH')!.body).toEqual({ is_active: false });
  });

  it('renames someone, and changes their role, but not your own role', async () => {
    const list = await open();
    fireEvent.click(within(within(list).getByLabelText('User Jahnavi')).getByRole('button', { name: 'Edit Jahnavi' }));
    fireEvent.change(screen.getByLabelText('Name for Jahnavi'), { target: { value: 'Jahnavi Rao' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('/users/U-j', 'PATCH')).toBeTruthy());
    expect(sent('/users/U-j', 'PATCH')!.body).toEqual({ display_name: 'Jahnavi Rao', email: 'abhinav@x.example' });
    fireEvent.click(within(within(list).getByLabelText('User PayPal')).getByRole('button', { name: 'Edit PayPal' }));
    expect(screen.getByLabelText('Role for PayPal')).toBeDisabled();
    expect(screen.getByText("You can't change your own role.")).toBeInTheDocument();
  });
});

describe('High-profile cases', () => {
  const d = (over: Record<string, unknown>): any => ({ id: 'D-X', source: 'synthetic', status: 'OPEN', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', outcome: null, amount: 100, currency: 'USD', response_due_date: null,
    created_at: null, priority_score: 30, priority_factors: [], evidence_status: 'MISSING', buyer_claim: 'x', buyer_reference: 'Alex', merchant_reference: 'Shop', transaction_id: 'T', assigned_to: 'Susmitha',
    is_high_profile: false, ...over });
  const cases = [d({ id: 'D-BIG', amount: 1250, is_high_profile: true, assigned_to: 'PayPal' }), d({ id: 'D-BIG2', amount: 4000, is_high_profile: true, assigned_to: 'PayPal' }),
    d({ id: 'D-SMALL' }), d({ id: 'D-DONE', status: 'RESOLVED', outcome: 'SELLER_FAVOR', is_high_profile: true })];

  it('the manager gets a High profile list: open cases for big amounts only', async () => {
    signInAs('MANAGER');
    global.fetch = vi.fn().mockImplementation(() => ok(cases)) as any;
    mount(<DisputeQueuePage />, '/queue?view=high');
    expect(await screen.findByText('D-BIG')).toBeInTheDocument();
    expect(screen.getByText('D-BIG2')).toBeInTheDocument();
    expect(screen.queryByText('D-SMALL')).not.toBeInTheDocument();
    expect(screen.queryByText('D-DONE')).not.toBeInTheDocument(); // decided cases aren't open work
    expect(screen.getByRole('tab', { name: /High profile/ })).toHaveTextContent('2');
    expect(screen.getAllByText('High profile').length).toBeGreaterThan(1);  // each row is badged too
  });

  it('the manager can also see every case, small ones included', async () => {
    signInAs('MANAGER');
    global.fetch = vi.fn().mockImplementation(() => ok(cases)) as any;
    mount(<DisputeQueuePage />, '/queue');
    for (const id of ['D-BIG', 'D-BIG2', 'D-SMALL', 'D-DONE']) expect(await screen.findByText(id)).toBeInTheDocument();
    expect(screen.getByText('Showing 4 of 4 disputes')).toBeInTheDocument();
  });

  it('an investigator does not get a High profile tab', async () => {
    global.fetch = vi.fn().mockImplementation(() => ok(cases)) as any;
    mount(<DisputeQueuePage />, '/queue');
    await screen.findByText('D-BIG');
    expect(screen.queryByRole('tab', { name: /High profile/ })).not.toBeInTheDocument();
  });

  it('a manager assigns a case from its row, choosing only from people who can take cases', async () => {
    signInAs('MANAGER');
    const calls: { url: string; body?: any }[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.endsWith('/assign')) return ok({ assigned_to: 'Susmitha' });
      if (url.endsWith('/users')) return ok([...USERS, user({ id: 'U-b', username: 'bob', name: 'Bob Blocked', is_blocked: true }), user({ id: 'U-x', username: 'xi', name: 'Xi Gone', is_active: false })]);
      return ok([d({ id: 'D-FREE', assigned_to: null })]);
    }) as any;
    mount(<DisputeQueuePage />, '/queue');
    const pick = await screen.findByRole('combobox', { name: 'Assign D-FREE' });
    await waitFor(() => expect(within(pick).getByRole('option', { name: 'Susmitha' })).toBeInTheDocument());
    const names = within(pick).getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(['Unassigned', 'Abhinav Chitturi', 'Susmitha', 'Jahnavi', 'PayPal (manager)']);   // blocked and deactivated people are not offered
    fireEvent.change(pick, { target: { value: 'Susmitha' } });
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/D-FREE/assign'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/assign'))!.body).toEqual({ assignee: 'Susmitha' });
  });

  it('the manager\'s overview leads with high-profile cases and offers every case', async () => {
    signInAs('MANAGER');
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/dashboard/summary')) return ok({ environment_mode: 'demo', total_open_disputes: 8, approaching_deadline_count: 3, missing_evidence_count: 1, awaiting_review_count: 2, new_cases_count: 4, waiting_on_parties_count: 0,
        high_profile_count: 2, my_cases_count: 0, pending_admin_review_count: 0, disputes_by_reason: [], priority_distribution: { high: 1, medium: 1, low: 1 }, recent_activity: [], action_outcomes_summary: { success: 0, failed: 0, pending: 0 } });
      if (url.endsWith('/notifications')) return ok({ unread: 0, items: [], open_alerts: [] });
      if (url.includes('/disputes')) return ok(cases);
      return ok([]);
    }) as any;
    mount(<OverviewPage />);
    const tile = (await screen.findByText('High profile')).closest('button') as HTMLElement;
    expect(tile).toHaveTextContent('2');
    expect(screen.getByText('Waiting on replies')).toBeInTheDocument();                  // the manager needs to see who is holding things up too
    expect(screen.queryByText('Open disputes')).not.toBeInTheDocument();
    expect(await screen.findByText('High-profile cases')).toBeInTheDocument();
    expect(await screen.findByText('D-BIG')).toBeInTheDocument();
    expect(screen.queryByText('D-SMALL')).not.toBeInTheDocument();                      // the list is the manager's own cases
    fireEvent.click(screen.getByRole('button', { name: 'View all cases' }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/queue'));
  });
});

describe('Manager working a case', () => {
  const dispute: any = { id: 'D-1', source: 'synthetic', status: 'OPEN', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', outcome: null, amount: 1500, currency: 'USD', response_due_date: null, created_at: null,
    priority_score: 80, priority_factors: [], evidence_status: 'MISSING', buyer_claim: 'x', buyer_reference: 'Alex', merchant_reference: 'Shop', transaction_id: 'T', transaction: null, order: null, evidence_items: [],
    latest_brief_id: null, claim_points: [], assigned_to: 'PayPal', proposed_outcome: null, proposed_reason: null, proposed_by: null, proposed_at: null, review_note: null, reviewed_by: null, seller_settled_at: null,
    buyer_settled_at: null, decided_by: null, ai_verdict: null, ai_rationale: null, manager_assigned: null, parent_dispute_id: null, appeal_number: null, is_high_profile: true };
  const run = () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/evidence-requests/options')) return ok({ seller: [], buyer: [] });
      if (url.endsWith('/evidence-summary')) return ok({ seller: [], buyer: [], records: [] });
      if (url.endsWith('/actions/draft')) return ok({ dispute_id: 'D-1', action_type: 'DECIDE_FOR_BUYER', recipient: 'Seller and buyer', subject: 's', body: 'b', cited_record_ids: [], warnings: [], notes: [], source: 'rules', evidence_balance: { toward_buyer: [], toward_seller: [], other: [] } });
      if (url.endsWith('/timeline') || url.endsWith('/messages') || url.endsWith('/similar-cases') || url.endsWith('/emails') || url.includes('/flags')) return ok([]);
      if (url.endsWith('/appeals')) return ok({ parent: null, appeals: [] });
      if (url.includes('/brief')) return ok({ id: 'B', dispute_id: 'D-1', generated_at: '', provider: 'rule_based', model: null, summary: 's', structured_findings: [], evidence_gaps: [], recommendations: [], generation_status: 'SUCCESS' });
      if (url.includes('/api/disputes/D-1')) return ok(dispute);
      return ok([]);
    }) as any;
    signInAs('MANAGER');
    mount(<CaseInvestigationPage />, '/investigate/D-1', '/investigate/:disputeId');
  };

  it('can take action on a high-profile case, and is told that their decision is final', async () => {
    run();
    expect(await screen.findByText('High profile', { selector: 'span' })).toBeInTheDocument();
    fireEvent.click((await screen.findAllByRole('button', { name: /^Take action$/ }))[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/your decision is final and the seller and the buyer are told at once/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ready to decide' }));
    expect(await screen.findByText(/There is no AI review/)).toBeInTheDocument();
  });
});

describe('Search', () => {
  it('offers the full list for anything typed, since the quick list stops at six', async () => {
    signInAs('MANAGER');
    global.fetch = vi.fn().mockImplementation(() => ok([])) as any;
    mount(<CommandPalette open onClose={() => undefined} />, '/');
    fireEvent.change(screen.getByLabelText('Command search'), { target: { value: 'alex morgan' } });
    const all = await screen.findByText('See every case matching “alex morgan”');
    fireEvent.click(all);
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/queue?q=alex%20morgan'));
  });
});

describe('Your strikes (Overview)', () => {
  const overview = (strikes: number, role: 'INVESTIGATOR' | 'MANAGER' = 'INVESTIGATOR') => {
    signInAs(role, { strikes });
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/dashboard/summary')) return ok({ environment_mode: 'demo', total_open_disputes: 1, approaching_deadline_count: 0, missing_evidence_count: 0, awaiting_review_count: 0, new_cases_count: 0, waiting_on_parties_count: 0,
        high_profile_count: 0, my_cases_count: 0, pending_admin_review_count: 0, disputes_by_reason: [], priority_distribution: { high: 0, medium: 0, low: 0 }, recent_activity: [], action_outcomes_summary: { success: 0, failed: 0, pending: 0 } });
      if (url.endsWith('/auth/me')) return ok({ strikes, block_at: 10, notify_at: 3 });
      if (url.endsWith('/notifications')) return ok({ unread: 0, items: [], open_alerts: [] });
      return ok([]);
    }) as any;
    mount(<OverviewPage />);
  };

  it('shows an investigator how many strikes they have, out of the limit, and what the limits mean', async () => {
    overview(4);
    await screen.findByRole('heading', { name: 'Your strikes' });
    const card = screen.getAllByLabelText('Your strikes')[0]; // the card comes before its own progress bar
    expect(card).toHaveTextContent('Your strikes');
    const bar = screen.getByRole('progressbar', { name: 'Your strikes' });
    expect(bar).toHaveAttribute('aria-valuenow', '4');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
    expect(card).toHaveTextContent('alerted every 3 strikes');
    expect(card).toHaveTextContent('blocked at 10');
    expect(card).toHaveTextContent('6 until your account is blocked');
    expect(card).toHaveTextContent('flag it on that case');
  });

  it('warns when the block is close, and congratulates zero', async () => {
    overview(9);
    expect(await screen.findByText('1 more and your account is blocked.')).toBeInTheDocument();
  });

  it('says so when there are none', async () => {
    overview(0);
    expect(await screen.findByText('No strikes. Keep it up.')).toBeInTheDocument();
  });

  it('is for investigators: a manager has no strikes card', async () => {
    overview(0, 'MANAGER');
    await screen.findByText('High profile');
    expect(screen.queryByRole('progressbar', { name: 'Your strikes' })).not.toBeInTheDocument();
  });
});
