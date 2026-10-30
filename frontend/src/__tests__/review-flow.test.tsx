import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminReviewPage } from '../pages/AdminReviewPage';
import { DisputeQueuePage } from '../pages/DisputeQueuePage';
import { CaseInvestigationPage } from '../pages/CaseInvestigationPage';
import { AppShell } from '../components/layout/AppShell';
import { ToastProvider } from '../components/ui/kit';

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const dispute = (over: Record<string, unknown> = {}): any => ({
  id: 'D-1', source: 'synthetic', status: 'UNDER_REVIEW', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', outcome: null, amount: 450, currency: 'USD',
  response_due_date: null, created_at: null, priority_score: 58, priority_factors: [], evidence_status: 'PARTIAL', buyer_claim: 'Front porch camera shows nothing arrived.',
  buyer_reference: 'Alex', merchant_reference: 'TechStore', transaction_id: 'T-1', transaction: null, order: null, evidence_items: [], latest_brief_id: null,
  claim_points: [], assigned_to: null, proposed_outcome: null, proposed_reason: null, proposed_by: null, proposed_at: null, review_note: null, reviewed_by: null,
  seller_settled_at: null, buyer_settled_at: null, ...over,
});
const withAdmin = (over = {}) => dispute({ status: 'PENDING_ADMIN_REVIEW', proposed_outcome: 'SELLER_FAVOR', proposed_reason: 'The carrier delivered to the confirmed address.', proposed_by: 'Abhinav Chitturi', proposed_at: '2026-01-01T10:00:00', ...over });
const footage = { key: 'footage', label: 'Camera footage', quote: 'Front porch camera shows nothing arrived.', note: 'The buyer mentions footage, but none is on file. Ask the buyer for it before deciding.', on_file: false, evidence_type: 'BUYER_CAMERA_FOOTAGE', party: 'BUYER' };
const SUMMARY = {
  seller: [{ evidence_type: 'CARRIER_TRACKING', label: 'Carrier tracking', party: 'SELLER', status: 'PROVIDED', detail: '', why: '', description: 'UPS shows delivered', evidence_id: 'EV-1', provided_at: null, file_name: null, content_type: null, size_bytes: null, duration_seconds: null, storage: null, preview: 'DOCUMENT', is_video: false }],
  buyer: [{ evidence_type: 'BUYER_CAMERA_FOOTAGE', label: 'Camera footage', party: 'BUYER', status: 'MISSING', detail: 'Not requested yet. Ask the buyer for it.', why: '', description: null, evidence_id: null, provided_at: null, file_name: null, content_type: null, size_bytes: null, duration_seconds: null, storage: null, preview: null, is_video: false },
    { evidence_type: 'BUYER_CAMERA_FOOTAGE', label: 'Camera footage', party: 'BUYER', status: 'PROVIDED', detail: '', why: '', description: 'Porch video', evidence_id: 'EV-V', provided_at: null, file_name: 'porch.mp4', content_type: 'video/mp4', size_bytes: 24117248, duration_seconds: 108, storage: null, preview: null, is_video: true }],
  records: [],
};

function LocationProbe() { const l = useLocation(); return <div data-testid="loc">{l.pathname + l.search}</div>; }
const mount = (ui: React.ReactElement, route: string, path = '*') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MemoryRouter initialEntries={[route]}><Routes><Route path={path} element={ui} /></Routes><LocationProbe /></MemoryRouter></ToastProvider>
  </QueryClientProvider>,
);
const asAdmin = () => window.localStorage.setItem('resolveiq.role', 'admin');
afterEach(() => window.localStorage.removeItem('resolveiq.role'));

describe('Admin review', () => {
  const calls: { url: string; body?: any }[] = [];
  const api = (pending: any[] = [withAdmin()], decided: any[] = []) => {
    calls.length = 0;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.endsWith('/admin-review')) return ok({ message: 'Done.', status: 'RESOLVED' });
      if (url.endsWith('/evidence-summary')) return ok(SUMMARY);
      if (url.includes('status=PENDING_ADMIN_REVIEW')) return ok(pending);
      if (url.includes('status=RESOLVED')) return ok(decided);
      return ok([]);
    }) as any;
  };

  it('is for admins only', async () => {
    api();
    mount(<AdminReviewPage />, '/admin');
    expect(await screen.findByText('Admins only')).toBeInTheDocument();
    expect(screen.queryByText('The carrier delivered to the confirmed address.')).not.toBeInTheDocument();
  });

  it('shows the decision, the reason and the evidence, with what is missing in red', async () => {
    asAdmin(); api();
    mount(<AdminReviewPage />, '/admin');
    const panel = await screen.findByLabelText('Proposed decision');
    expect(within(panel).getByText("Seller's favor")).toBeInTheDocument();
    expect(within(panel).getByText('The carrier delivered to the confirmed address.')).toBeInTheDocument();
    expect(within(panel).getByText(/Abhinav Chitturi/)).toBeInTheDocument();
    const evidence = await screen.findByLabelText('Evidence the decision rests on');
    expect(within(evidence).getByText('UPS shows delivered')).toBeInTheDocument();
    expect(within(evidence).getByText('Not requested yet. Ask the buyer for it.').closest('li')).toHaveAttribute('data-status', 'MISSING');
  });

  it('confirming sends one approval and nothing else', async () => {
    asAdmin(); api();
    mount(<AdminReviewPage />, '/admin');
    fireEvent.click(await screen.findByRole('button', { name: /Confirm decision/ }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin-review'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/admin-review'))!.body).toMatchObject({ action: 'APPROVE', reviewer: 'Priya Raman', role: 'ADMIN' });
  });

  it('deciding differently needs the other call and a note', async () => {
    asAdmin(); api();
    mount(<AdminReviewPage />, '/admin');
    fireEvent.click(await screen.findByRole('button', { name: 'Decide differently' }));
    const send = screen.getByRole('button', { name: /Decide and notify both/ });
    expect(send).toBeDisabled();
    // It starts on the opposite of what the investigator chose.
    expect(screen.getByRole('radio', { name: /Buyer's favor/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByLabelText('Admin note'), { target: { value: 'Footage shows no delivery.' } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin-review'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/admin-review'))!.body).toMatchObject({ action: 'OVERRIDE', outcome: 'BUYER_FAVOR', note: 'Footage shows no delivery.' });
  });

  it('sending a case back needs a note saying what to fix', async () => {
    asAdmin(); api();
    mount(<AdminReviewPage />, '/admin');
    fireEvent.click(await screen.findByRole('button', { name: /Send back/ }));
    const send = screen.getByRole('button', { name: /Send back to the investigator/ });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Admin note'), { target: { value: 'Ask the seller for the address check.' } });
    fireEvent.click(send);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin-review'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/admin-review'))!.body).toMatchObject({ action: 'REOPEN', note: 'Ask the seller for the address check.' });
  });

  it('can reopen a case that was already decided, with a reason', async () => {
    asAdmin(); api([], [dispute({ id: 'D-9', status: 'RESOLVED', outcome: 'BUYER_FAVOR' })]);
    mount(<AdminReviewPage />, '/admin');
    expect(await screen.findByText('Nothing waiting for you')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Reopen/ }));
    const go = screen.getByRole('button', { name: 'Reopen case' });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why reopen D-9'), { target: { value: 'The buyer disputes the outcome.' } });
    fireEvent.click(go);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin-review'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/admin-review'))!.body).toMatchObject({ action: 'REOPEN', note: 'The buyer disputes the outcome.' });
  });
});

describe('Your cases and Ready to decide', () => {
  const list = [
    dispute({ id: 'D-MINE', assigned_to: 'Abhinav Chitturi', status: 'OPEN' }),
    dispute({ id: 'D-THEIRS', assigned_to: 'Someone Else', status: 'OPEN' }),
    dispute({ id: 'D-FREE', assigned_to: null, status: 'OPEN' }),
    dispute({ id: 'D-READY', assigned_to: 'Abhinav Chitturi', status: 'UNDER_REVIEW' }),
    dispute({ id: 'D-ADMIN', assigned_to: 'Abhinav Chitturi', status: 'PENDING_ADMIN_REVIEW' }),
    dispute({ id: 'D-DONE', assigned_to: 'Abhinav Chitturi', status: 'RESOLVED', outcome: 'SELLER_FAVOR' }),
  ];
  const api = () => {
    const calls: { url: string; body?: any }[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.endsWith('/assign')) return ok({ assigned_to: 'Abhinav Chitturi' });
      return ok(list);
    }) as any;
    return calls;
  };

  it('"Your cases" lists every case that is yours, including ones you already decided', async () => {
    api();
    mount(<DisputeQueuePage />, '/queue?view=mine');
    await screen.findByText('D-MINE');
    expect(screen.getByText('D-READY')).toBeInTheDocument();
    expect(screen.getByText('D-ADMIN')).toBeInTheDocument();      // still yours while an admin checks it
    expect(screen.queryByText('D-THEIRS')).not.toBeInTheDocument();
    expect(screen.getByText('D-DONE')).toBeInTheDocument();        // a case you decided stays on your list
    expect(screen.queryByText('D-FREE')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Your cases/ })).toHaveTextContent('4');
  });

  it('Ready to decide means time to act: only cases with the evidence in, and it says so', async () => {
    api();
    mount(<DisputeQueuePage />, '/queue?view=ready');
    expect(await screen.findByText('D-READY')).toBeInTheDocument();
    expect(screen.queryByText('D-MINE')).not.toBeInTheDocument();
    expect(screen.queryByText('D-ADMIN')).not.toBeInTheDocument(); // already decided and with an admin
    expect(screen.getByRole('note')).toHaveTextContent('Time to decide');
    expect(screen.getByRole('note')).toHaveTextContent('reply deadline has passed');
  });

  it('shows who owns each case and lets you take an unassigned one', async () => {
    const calls = api();
    mount(<DisputeQueuePage />, '/queue');
    await screen.findByText('D-FREE');
    expect(screen.getByText('Owner: Someone Else')).toBeInTheDocument();
    expect(screen.getAllByText('Yours').length).toBeGreaterThan(0);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Take case/ })).toHaveLength(1); // only the unassigned one
    fireEvent.click(screen.getByRole('button', { name: 'Take case D-FREE' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/assign'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/assign'))!.url).toContain('/disputes/D-FREE/assign');
    expect(calls.find((c) => c.url.endsWith('/assign'))!.body).toEqual({ assignee: 'Abhinav Chitturi' });
  });

  it('the admin sees a With admin list; investigators do not', async () => {
    api();
    const { unmount } = mount(<DisputeQueuePage />, '/queue');
    await screen.findByText('D-FREE');
    expect(screen.queryByRole('tab', { name: /With admin/ })).not.toBeInTheDocument();
    unmount();
    asAdmin();
    mount(<DisputeQueuePage />, '/queue?view=review');
    expect(await screen.findByText('D-ADMIN')).toBeInTheDocument();
    expect(screen.queryByText('D-MINE')).not.toBeInTheDocument();
  });
});

describe('Sidebar', () => {
  const shell = () => {
    global.fetch = vi.fn().mockImplementation(() => ok([])) as any;
    return mount(<AppShell />, '/queue?view=mine', '/queue');
  };

  it('has Your cases under Workspace, and highlights it instead of Disputes when you are on it', async () => {
    shell();
    const nav = within(screen.getByLabelText('Primary'));
    const mine = nav.getByRole('link', { name: /Your cases/ });
    expect(mine).toHaveAttribute('href', '/queue?view=mine');
    expect(mine.className).toMatch(/ring-1/);
    expect(nav.getByRole('link', { name: /^Disputes/ }).className).not.toMatch(/ring-1/);
    expect(nav.queryByRole('link', { name: /Admin review/ })).not.toBeInTheDocument();
  });

  it('switching to Admin swaps Your cases for Admin review', async () => {
    shell();
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
    const nav = within(screen.getByLabelText('Primary'));
    await waitFor(() => expect(nav.getByRole('link', { name: /Admin review/ })).toBeInTheDocument());
    expect(nav.queryByRole('link', { name: /Your cases/ })).not.toBeInTheDocument();
    expect(screen.getByText('Priya Raman')).toBeInTheDocument();
    expect(window.localStorage.getItem('resolveiq.role')).toBe('admin');
  });
});

describe('Case page', () => {
  const api = (d: any, timeline: any[] = []) => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/timeline')) return ok(timeline);
      if (url.endsWith('/evidence-summary')) return ok(SUMMARY);
      if (url.endsWith('/preview')) return Promise.resolve({ ok: true, text: () => Promise.resolve('<h1>Carrier scan history</h1>') });
      if (url.endsWith('/messages')) return ok([]);
      if (url.endsWith('/similar-cases')) return ok([]);
      if (url.includes('/brief')) return ok({ id: 'B', dispute_id: 'D-1', generated_at: '', provider: 'rule_based', model: null, summary: 's', structured_findings: [], evidence_gaps: [], recommendations: [], generation_status: 'SUCCESS' });
      if (url.includes('/api/disputes/D-1')) return ok(d);
      return ok([]);
    }) as any;
  };
  const page = () => mount(<CaseInvestigationPage />, '/investigate/D-1', '/investigate/:disputeId');

  it('shows what the buyer mentioned, and a click explains it and says whether the proof is on file', async () => {
    api(dispute({ claim_points: [footage] }));
    page();
    const chip = await screen.findByRole('button', { name: /Camera footage/ });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.getByRole('note')).toHaveTextContent('none is on file. Ask the buyer for it before deciding.');
    expect(screen.getByRole('note')).toHaveTextContent('Front porch camera shows nothing arrived.');
    fireEvent.click(chip);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('puts the same notes under the "dispute filed" event in the timeline, so they cannot be skipped', async () => {
    const filed = { id: 'E1', timestamp: '2026-01-01T10:00:00', event_type: 'DISPUTE', title: 'Dispute Filed: X', description: 'Buyer assertion', source: 'synthetic', source_record_id: 'D-1', status: 'OPEN', claim_points: [footage] };
    const order = { id: 'E2', timestamp: '2026-01-02T10:00:00', event_type: 'ORDER', title: 'Order Placed', description: 'd', source: 'synthetic', source_record_id: 'O-1', status: null };
    api(dispute(), [filed, order]);
    page();
    fireEvent.click(await screen.findByRole('tab', { name: /Timeline/ }));
    const list = await screen.findByLabelText('Timeline');
    const chips = within(list).getAllByRole('button', { name: /Camera footage/ });
    expect(chips).toHaveLength(1);                                  // only on the event where the buyer said it
    expect(chips[0].closest('ol[aria-label="Timeline"] > li')).toHaveTextContent('Dispute Filed');
    fireEvent.click(chips[0]);
    expect(within(list).getByRole('note')).toHaveTextContent('Ask the buyer for it');
  });

  it('shows each side\'s evidence on the Evidence tab, with missing items in red', async () => {
    api(dispute());
    page();
    fireEvent.click(await screen.findByRole('tab', { name: /Evidence/ }));
    const evidence = await screen.findByLabelText('What each side has sent');
    expect(within(evidence).getByText('UPS shows delivered')).toBeInTheDocument();
    const missing = within(evidence).getByText('Not requested yet. Ask the buyer for it.');
    expect(missing.closest('li')).toHaveAttribute('data-status', 'MISSING');
    expect(within(evidence).getByText('1 item missing')).toBeInTheDocument();
  });

  it('opens a generated document in a preview, but says a video cannot be previewed', async () => {
    api(dispute());
    page();
    fireEvent.click(await screen.findByRole('tab', { name: /Evidence/ }));
    const evidence = await screen.findByLabelText('What each side has sent');
    // The document has a Preview button. The video does not, and says why.
    expect(within(evidence).getAllByRole('button', { name: /^Preview/ })).toHaveLength(1);
    expect(within(evidence).getByText(/Video can't be previewed here/)).toBeInTheDocument();
    fireEvent.click(within(evidence).getByRole('button', { name: 'Preview Carrier tracking' }));
    const frame = (await screen.findByTitle('Carrier tracking preview')) as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute('srcdoc')).toContain('Carrier scan history'));
    expect(frame.getAttribute('sandbox')).toBe(''); // generated content runs with no permissions
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTitle('Carrier tracking preview')).not.toBeInTheDocument());
  });

  it('says who owns it and lets you take it', async () => {
    api(dispute());
    page();
    expect(await screen.findByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Take this case/ })).toBeInTheDocument();
  });

  it('while an admin reviews the decision, the investigator cannot act and is told why', async () => {
    api(withAdmin({ assigned_to: 'Abhinav Chitturi' }));
    page();
    expect((await screen.findAllByText('With an admin to confirm')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Take action$/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Investigation progress')).toHaveTextContent('Nobody is told until then');
  });

  it('shows the admin\'s note when a case is sent back', async () => {
    api(dispute({ review_note: 'The address check is missing.', reviewed_by: 'Priya Raman' }));
    page();
    expect(await screen.findByText(/Priya Raman sent this case back:/)).toBeInTheDocument();
    expect(screen.getByText(/The address check is missing\./)).toBeInTheDocument();
  });

  it('gives the admin the review controls on the case itself', async () => {
    asAdmin();
    api(withAdmin());
    page();
    expect(await screen.findByText('Review this decision')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm decision/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Take action$/ })).not.toBeInTheDocument();
  });

  it('one side saying settled is not settled', async () => {
    api(dispute({ seller_settled_at: '2026-01-02T10:00:00' }));
    page();
    const note = await screen.findByText(/says this was settled outside PayPal/);
    expect(note.closest('div')).toHaveTextContent('It is not settled until the buyer confirms too');
  });

  it('explains how a settled and a dismissed case ended', async () => {
    api(dispute({ status: 'CLOSED', outcome: 'SETTLED' }));
    const { unmount } = page();
    expect(await screen.findByText('Settled outside PayPal.', { selector: 'p.font-medium' })).toBeInTheDocument();
    expect(screen.getByText(/both confirmed they settled it outside PayPal/)).toBeInTheDocument();
    unmount();
    api(dispute({ status: 'CLOSED', outcome: 'DISMISSED' }));
    page();
    expect(await screen.findByText('Dismissed, buyer withdrew.', { selector: 'p.font-medium' })).toBeInTheDocument();
    expect(screen.getByText(/withdrew the claim/)).toBeInTheDocument();
  });
});
