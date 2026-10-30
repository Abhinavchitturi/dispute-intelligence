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

describe('Distribute cases', () => {
  const calls: { url: string; body?: any }[] = [];
  const api = (distributeResult: () => Promise<any> = () => ok({ assigned: { 'Abhinav Chitturi': 10, Susmitha: 10, Jahnavi: 10 }, total: 30, left_unassigned: 0, people: 3 })) => {
    calls.length = 0;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.endsWith('/cases/distribution')) return ok(PLAN);
      if (url.endsWith('/cases/distribute')) return distributeResult();
      if (url.includes('/dashboard/summary')) return ok(summary());
      if (url.endsWith('/notifications')) return ok({ unread: 0, items: [], open_alerts: [] });
      return ok([]);
    }) as any;
  };
  const open = async () => {
    signInAs('MANAGER'); api();
    mount(<DisputeQueuePage />, '/queue');
    fireEvent.click(await screen.findByRole('button', { name: /Distribute cases/ }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/waiting for an owner/);
    return dialog;
  };
  const sent = () => calls.find((c) => c.url.endsWith('/cases/distribute'))!.body;
  const n = (dialog: HTMLElement, name: string) => within(dialog).getByLabelText(`Cases for ${name}`);
  const plus = (dialog: HTMLElement, name: string, times = 1) => { for (let i = 0; i < times; i++) fireEvent.click(within(dialog).getByRole('button', { name: `More cases for ${name}` })); };

  it('shows how many cases are waiting and a minus and plus for each person, all at zero to start', async () => {
    const dialog = await open();
    expect(within(dialog).getByText(/30 cases/)).toBeInTheDocument();
    expect(within(dialog).getByText(/2 high-profile cases are kept for you/)).toBeInTheDocument();
    for (const name of ['Abhinav Chitturi', 'Susmitha', 'Jahnavi']) {
      expect(n(dialog, name)).toHaveTextContent('0');
      expect(within(dialog).getByRole('button', { name: `Fewer cases for ${name}` })).toBeDisabled();   // can't go below none
    }
    expect(within(dialog).getByText('Asked for cases')).toBeInTheDocument();                           // Susmitha asked
    expect(within(dialog).queryByRole('checkbox', { name: 'Susmitha' })).not.toBeInTheDocument();      // numbers, not ticks
    expect(within(dialog).getByRole('button', { name: /^Hand out/ })).toBeDisabled();
    expect(within(dialog).getByText('Press plus next to a name, or split them evenly.')).toBeInTheDocument();
  });

  it('plus and minus set how many each person gets, and the total is kept to what is waiting', async () => {
    const dialog = await open();
    plus(dialog, 'Abhinav Chitturi', 12);
    plus(dialog, 'Susmitha', 3);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fewer cases for Abhinav Chitturi' }));
    expect(n(dialog, 'Abhinav Chitturi')).toHaveTextContent('11');
    expect(n(dialog, 'Susmitha')).toHaveTextContent('3');
    expect(within(dialog).getByText('14 of 30 will go out. 16 stay unassigned. The most urgent go first.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Hand out 14 cases' })).toBeEnabled();
    plus(dialog, 'Jahnavi', 40);                                                                    // can't give out more than there are
    expect(n(dialog, 'Jahnavi')).toHaveTextContent('16');
    expect(within(dialog).getByRole('button', { name: 'More cases for Jahnavi' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'More cases for Abhinav Chitturi' })).toBeDisabled();
    expect(within(dialog).getByText(/None stay unassigned/)).toBeInTheDocument();
  });

  it('Split evenly fills everyone in: thirty between three is ten each', async () => {
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Split evenly' }));
    for (const name of ['Abhinav Chitturi', 'Susmitha', 'Jahnavi']) expect(n(dialog, name)).toHaveTextContent('10');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hand out 30 cases' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/cases/distribute'))).toBe(true));
    expect(sent()).toEqual({ counts: { 'U-a': 10, 'U-s': 10, 'U-j': 10 }, include_high_profile: false });
    expect(await screen.findByText('Handed out 30 cases: Abhinav Chitturi 10, Susmitha 10, Jahnavi 10.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('when it does not divide, the extra case goes to whoever has the fewest already, and you can still adjust it', async () => {
    signInAs('MANAGER');
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/cases/distribution')) return ok({ unassigned: 10, unassigned_high_profile: 0, people: [
        { id: 'U-a', name: 'Abhinav Chitturi', open_cases: 5, requested: false }, { id: 'U-s', name: 'Susmitha', open_cases: 0, requested: false }, { id: 'U-j', name: 'Jahnavi', open_cases: 2, requested: false }] });
      if (url.includes('/dashboard/summary')) return ok(summary());
      return ok(url.endsWith('/notifications') ? { unread: 0, items: [], open_alerts: [] } : []);
    }) as any;
    mount(<DisputeQueuePage />, '/queue');
    fireEvent.click(await screen.findByRole('button', { name: /Distribute cases/ }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/waiting for an owner/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Split evenly' }));
    expect(n(dialog, 'Susmitha')).toHaveTextContent('4');         // the one with no cases gets the extra
    expect(n(dialog, 'Abhinav Chitturi')).toHaveTextContent('3');
    expect(n(dialog, 'Jahnavi')).toHaveTextContent('3');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fewer cases for Susmitha' }));
    expect(within(dialog).getByText(/9 of 10 will go out\. 1 stay unassigned/)).toBeInTheDocument();
  });

  it('only people with a number get cases', async () => {
    const dialog = await open();
    plus(dialog, 'Susmitha', 4);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hand out 4 cases' }));
    await waitFor(() => expect(sent()).toEqual({ counts: { 'U-s': 4 }, include_high_profile: false }));
  });

  it('can include the high-profile cases, which adds them to what can be given out', async () => {
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Include high-profile cases/ }));
    expect(within(dialog).getByRole('status')).toHaveTextContent('32 cases are waiting for an owner');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Split evenly' }));
    expect(n(dialog, 'Abhinav Chitturi')).toHaveTextContent('11');                                  // 32 across three: 11, 11, 10
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Include high-profile cases/ }));  // take them out again
    await waitFor(() => {
      const total = ['Abhinav Chitturi', 'Susmitha', 'Jahnavi'].reduce((a, name) => a + Number(n(dialog, name).textContent), 0);
      expect(total).toBe(30);                                                                       // trimmed so it still fits
    });
    expect(within(dialog).getByRole('button', { name: 'Hand out 30 cases' })).toBeEnabled();
  });

  it("shows the server's reason when it can't", async () => {
    signInAs('MANAGER'); api(() => fail('That is 31 cases but only 30 are waiting.'));
    mount(<DisputeQueuePage />, '/queue');
    fireEvent.click(await screen.findByRole('button', { name: /Distribute cases/ }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/waiting for an owner/);
    plus(dialog, 'Jahnavi', 2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hand out 2 cases' }));
    expect(await screen.findByText('That is 31 cases but only 30 are waiting.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();       // stays open
  });

  it('the manager\'s overview has the button too, and counts the cases with no owner', async () => {
    signInAs('MANAGER'); api();
    mount(<OverviewPage />);
    await screen.findByText('High profile');
    expect(screen.queryByText('Open disputes')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Distribute cases' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('Asking for cases', () => {
  const calls: { url: string; body?: any }[] = [];
  const api = (mine = 0, requests: any[] = []) => {
    calls.length = 0;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.includes('/dashboard/summary')) return ok(summary({ my_cases_count: mine }));
      if (url.endsWith('/case-requests') && init?.method === 'POST') return ok({ id: 'R1', status: 'OPEN' });
      if (url.includes('/case-requests')) return ok(requests);
      if (url.endsWith('/auth/me')) return ok({ strikes: 0, block_at: 10, notify_at: 3 });
      if (url.endsWith('/notifications')) return ok({ unread: 0, items: [], open_alerts: [] });
      return ok([]);
    }) as any;
  };

  it('an investigator with no cases can ask for more, with an optional message', async () => {
    api(0);
    mount(<OverviewPage />);
    await screen.findByLabelText('You have no cases');
    fireEvent.click(screen.getByRole('button', { name: 'Ask for cases' }));
    fireEvent.change(screen.getByLabelText('Message to your manager'), { target: { value: 'I can take the harder ones.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/case-requests') && c.body)).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/case-requests') && c.body)!.body).toEqual({ note: 'I can take the harder ones.' });
    expect(await screen.findByText('Your manager has been alerted.')).toBeInTheDocument();
  });

  it('once asked, it says so instead of offering the button again', async () => {
    api(0, [{ id: 'R1', name: 'Abhinav Chitturi', status: 'OPEN', note: null, created_at: '2026-01-01T10:00:00' }]);
    mount(<OverviewPage />);
    expect(await screen.findByText('Asked, waiting for your manager')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask for cases' })).not.toBeInTheDocument();
  });

  it('shows why the last request was declined', async () => {
    api(0, [{ id: 'R0', name: 'Abhinav Chitturi', status: 'DECLINED', resolved_by: 'PayPal', resolution_note: 'Nothing new until Monday.', note: null, created_at: '2026-01-01T10:00:00' }]);
    mount(<OverviewPage />);
    expect(await screen.findByText(/Nothing new until Monday\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask for cases' })).toBeInTheDocument();
  });

  it('an investigator who has cases is not shown the request card, and a manager never is', async () => {
    api(3);
    const { unmount } = mount(<OverviewPage />);
    await screen.findByText('Decide within 48 hours');
    expect(screen.queryByLabelText('You have no cases')).not.toBeInTheDocument();
    unmount();
    signInAs('MANAGER');
    api(0);
    mount(<OverviewPage />);
    await screen.findByText('High profile');
    expect(screen.queryByLabelText('You have no cases')).not.toBeInTheDocument();
  });

  const req = (over: Record<string, unknown> = {}) => ({ id: 'R1', user_id: 'U-s', name: 'Susmitha', note: 'All done.', status: 'OPEN', created_at: '2026-01-01T10:00:00', resolved_by: null, resolved_at: null, resolution_note: null, cases_given: null, ...over });
  const team = (requests: any[]) => {
    calls.length = 0;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.endsWith('/decline')) return ok(req({ status: 'DECLINED' }));
      if (url.endsWith('/cases/distribution')) return ok(PLAN);
      if (url.includes('/case-requests')) return ok(requests);
      return ok([]);
    }) as any;
  };

  it('the manager sees who is asking, with the count on the tab, and can give them cases', async () => {
    signInAs('MANAGER'); team([req()]);
    mount(<TeamPage />, '/team?tab=requests');
    const list = await screen.findByLabelText('Case requests');
    const row = within(list).getByLabelText('Request from Susmitha');
    expect(within(row).getByText('Has no cases')).toBeInTheDocument();
    expect(within(row).getByText('“All done.”')).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /Case requests/ })).toHaveTextContent('1');
    fireEvent.click(within(row).getByRole('button', { name: 'Give cases' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/waiting for an owner/);
    expect(within(dialog).getByLabelText('Cases for Susmitha')).toHaveTextContent('5');         // only the person who asked, with five to start
    expect(within(dialog).getByLabelText('Cases for Jahnavi')).toHaveTextContent('0');
    expect(within(dialog).getByLabelText('Cases for Abhinav Chitturi')).toHaveTextContent('0');
  });

  it('declining needs a reason, which the investigator will see', async () => {
    signInAs('MANAGER'); team([req()]);
    mount(<TeamPage />, '/team?tab=requests');
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    const go = within(screen.getByLabelText('Request from Susmitha')).getAllByRole('button', { name: 'Decline' }).pop()!;
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why decline Susmitha'), { target: { value: 'Nothing new until Monday.' } });
    fireEvent.click(go);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/case-requests/R1/decline'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/decline'))!.body).toEqual({ note: 'Nothing new until Monday.' });
  });

  it('shows requests already dealt with, and what happened', async () => {
    signInAs('MANAGER'); team([req({ id: 'R2', status: 'FULFILLED', resolved_by: 'PayPal', cases_given: 5 }), req({ id: 'R3', name: 'Jahnavi', user_id: 'U-j', status: 'DECLINED', resolved_by: 'PayPal', resolution_note: 'Later.' })]);
    mount(<TeamPage />, '/team?tab=requests');
    expect(await screen.findByText('PayPal gave them 5 cases.')).toBeInTheDocument();
    expect(screen.getByText('PayPal: Later.')).toBeInTheDocument();
    expect(screen.getByText('Nobody is waiting for cases.')).toBeInTheDocument();
  });

  it('the pinned alert for a request takes the manager to the requests', async () => {
    signInAs('MANAGER');
    global.fetch = vi.fn().mockImplementation((url: string) => ok(url.endsWith('/notifications')
      ? { unread: 1, items: [], open_alerts: [{ id: 'ALT-9', kind: 'REQUEST', user_id: 'U-s', dispute_id: null, title: 'Susmitha has no cases', body: 'They are asking for more.', strike_level: null, status: 'OPEN', created_at: '2026-01-01T10:00:00', last_notified_at: '2026-01-01T10:00:00', reminder_count: 0, sorted_by: null, sorted_at: null, sorted_note: null }] } : [])) as any;
    mount(<><AlertsBanner /></>, '/');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Susmitha has no cases.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Look into it' }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/team?tab=requests'));
  });
});
