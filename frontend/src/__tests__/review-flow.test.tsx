import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ManagerReviewPage } from '../pages/ManagerReviewPage';
import { AITrainingPage } from '../pages/AITrainingPage';
import { signInAs, signOut } from './session';
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
const withAdmin = (over = {}) => dispute({ status: 'PENDING_AI_REVIEW', proposed_outcome: 'SELLER_FAVOR', proposed_reason: 'The carrier delivered to the confirmed address.', proposed_by: 'Abhinav Chitturi', proposed_at: '2026-01-01T10:00:00', ...over });
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
const asManager = () => signInAs('MANAGER');
afterEach(() => signOut());

describe('Manager review', () => {
  const calls: { url: string; body?: any }[] = [];
  const flagFixture = { id: 'FLG-1', dispute_id: 'D-7', raised_by: 'Abhinav Chitturi', points: 'The AI ignored the signed delivery record.', status: 'OPEN', created_at: '2026-01-01T10:00:00',
    resolved_by: null, resolved_at: null, resolution_note: null, investigator_outcome: 'SELLER_FAVOR', ai_outcome: 'BUYER_FAVOR', ai_rationale: 'No proof of delivery.', ai_verdict: 'OVERTURN' };
  const api = (pending: any[] = [withAdmin()], decided: any[] = [], flags: any[] = [], training: any[] = []) => {
    calls.length = 0;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.endsWith('/admin-review') || url.endsWith('/revise')) return ok({ message: 'Done.', status: 'RESOLVED', outcome: 'SELLER_FAVOR' });
      if (url.includes('/flags/') && url.endsWith('/resolve')) return ok({ ...flagFixture, status: 'OVERTURNED' });
      if (url.includes('/flags')) return ok(flags);
      if (url.endsWith('/ai-training')) return ok(training);
      if (url.endsWith('/evidence-summary')) return ok(SUMMARY);
      if (url.includes('status=PENDING_AI_REVIEW')) return ok(pending);
      if (url.includes('status=RESOLVED')) return ok(decided);
      return ok([]);
    }) as any;
  };
  const posted = (suffix: string) => calls.find((c) => c.url.endsWith(suffix))!.body;

  it('is for managers only', async () => {
    api();
    mount(<ManagerReviewPage />, '/manager');
    expect(await screen.findByText('Managers only')).toBeInTheDocument();
    expect(screen.queryByText('The carrier delivered to the confirmed address.')).not.toBeInTheDocument();
  });

  it('shows what the investigator decided and why, and the evidence, with what is missing in red', async () => {
    asManager(); api();
    mount(<ManagerReviewPage />, '/manager');
    const panel = await screen.findByLabelText('Proposed decision');
    expect(within(panel).getByText("Seller's favor")).toBeInTheDocument();
    expect(within(panel).getByText('The carrier delivered to the confirmed address.')).toBeInTheDocument();
    expect(within(panel).getByText(/Abhinav Chitturi/)).toBeInTheDocument();
    expect(within(panel).getByText(/Waiting for the AI reviewer/)).toBeInTheDocument();
    const evidence = await screen.findByLabelText('Evidence the decision rests on');
    expect(within(evidence).getByText('Not requested yet. Ask the buyer for it.').closest('li')).toHaveAttribute('data-status', 'MISSING');
  });

  it('confirming decides it now, with no reviewer name sent (the server knows who you are)', async () => {
    asManager(); api();
    mount(<ManagerReviewPage />, '/manager');
    fireEvent.click(await screen.findByRole('button', { name: /Confirm decision/ }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin-review'))).toBe(true));
    expect(posted('/admin-review')).toEqual({ action: 'APPROVE', note: undefined, outcome: undefined, role: undefined });
  });

  it('deciding differently needs the other call and a note', async () => {
    asManager(); api();
    mount(<ManagerReviewPage />, '/manager');
    fireEvent.click(await screen.findByRole('button', { name: 'Decide differently' }));
    const send = screen.getByRole('button', { name: /Decide and notify both/ });
    expect(send).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Buyer's favor/ })).toHaveAttribute('aria-checked', 'true'); // starts on the opposite of the investigator's call
    fireEvent.change(screen.getByLabelText('Manager note'), { target: { value: 'Footage shows no delivery.' } });
    fireEvent.click(send);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin-review'))).toBe(true));
    expect(posted('/admin-review')).toMatchObject({ action: 'OVERRIDE', outcome: 'BUYER_FAVOR', note: 'Footage shows no delivery.' });
  });

  it('sending a case back needs a note saying what to fix', async () => {
    asManager(); api();
    mount(<ManagerReviewPage />, '/manager');
    fireEvent.click(await screen.findByRole('button', { name: /Send back/ }));
    const send = screen.getByRole('button', { name: /Send back to the investigator/ });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Manager note'), { target: { value: 'Ask the seller for the address check.' } });
    fireEvent.click(send);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin-review'))).toBe(true));
    expect(posted('/admin-review')).toMatchObject({ action: 'REOPEN', note: 'Ask the seller for the address check.' });
  });

  it('lists the investigators\' flags in short, with one button that opens the case where it is settled', async () => {
    asManager(); api([], [], [flagFixture]);
    mount(<ManagerReviewPage />, '/manager?tab=flags');                 // an alert or tile can open this tab directly
    const card = await screen.findByLabelText('Flag on D-7');
    expect(within(card).getByText(/decided in seller's favor/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Open case details/ })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Train the AI/ })).not.toBeInTheDocument();    // the decision is made on the case itself
    expect(within(card).queryByRole('button', { name: /Keep the AI decision/ })).not.toBeInTheDocument();
  });

  it('can overturn a decided case, and says the correction goes to the AI team', async () => {
    asManager(); api([], [dispute({ id: 'D-9', status: 'RESOLVED', outcome: 'BUYER_FAVOR', ai_verdict: 'OVERTURN', decided_by: 'AI' })]);
    mount(<ManagerReviewPage />, '/manager');
    fireEvent.click(await screen.findByRole('tab', { name: /Decided cases/ }));
    expect(await screen.findByText(/decided by the AI/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Overturn decision/ }));
    expect(screen.getByText(/saved for the AI team to train on/)).toBeInTheDocument();
    const go = screen.getByRole('button', { name: 'Overturn and notify both' });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why overturn D-9'), { target: { value: 'The tracking shows delivery.' } });
    fireEvent.click(go);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/D-9/revise'))).toBe(true));
    expect(posted('/D-9/revise')).toEqual({ outcome: 'SELLER_FAVOR', note: 'The tracking shows delivery.' });
  });

  it('the AI Training page lays out each correction as a lesson: what it saw, what it ruled, what was right, what it missed', async () => {
    asManager();
    api([], [], [], [{ review_id: 'R1', dispute_id: 'D-3', model: null, investigator_decision: 'SELLER_FAVOR', ai_verdict: 'OVERTURN', ai_outcome: 'BUYER_FAVOR', ai_rationale: 'No proof of delivery.',
      correct_outcome: 'SELLER_FAVOR', correction_note: 'The signature was on file.', corrected_by: 'PayPal', corrected_at: '2026-01-02T10:00:00', source: 'INVESTIGATOR_FLAG', already_exported: false,
      case: { reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', amount: 205, currency: 'USD', buyer_claim: 'Never came.', investigator_reason: 'UPS delivered on 31 October.' },
      evidence: { seller: [{ type: 'CARRIER_TRACKING', label: 'Carrier tracking', status: 'PROVIDED', description: 'x', concern: null }],
                  buyer: [{ type: 'BUYER_CAMERA_FOOTAGE', label: 'Camera footage', status: 'PROVIDED', description: 'y', concern: 'The footage is from Oct 26, but the carrier delivered on Oct 31.' }], records: [] },
      ai_analysis: { reasoning: 'The footage shows no carrier.' },
      lesson: { id: 'LSN-1', summary: 'In "not received" disputes, the camera footage can be on file and still not count when it does not hold up.', evidence_types: [], doubtful_types: ['BUYER_CAMERA_FOOTAGE'], times_applied: 2, applied_to: ['D-8', 'D-9'], created_at: '2026-01-02T10:00:00' } }]);
    mount(<AITrainingPage />, '/training');
    const lesson = await screen.findByLabelText('Lesson from D-3');
    expect(within(lesson).getByText('Learned')).toBeInTheDocument();
    const learned = within(lesson).getByLabelText('What it learned');
    expect(learned).toHaveTextContent('camera footage can be on file and still not count');
    expect(learned).toHaveTextContent('Used on 2 new cases: D-8, D-9');
    expect(within(lesson).getByText('What it ruled before (the mistake)')).toBeInTheDocument();
    expect(within(lesson).getByText('The footage shows no carrier.')).toBeInTheDocument();      // the AI's own analysis, as it was
    expect(within(lesson).getByText('What was right (your correction)')).toBeInTheDocument();
    expect(within(lesson).getByText('The signature was on file.')).toBeInTheDocument();
    expect(within(lesson).getByText('Camera footage (doubtful)')).toBeInTheDocument();
    const summary = screen.getByLabelText('Training summary');
    expect(summary).toHaveTextContent('Lessons learned');
    expect(within(summary).getByText('Times it used a lesson').nextSibling).toHaveTextContent('2');
    expect(summary).toHaveTextContent('0 of 1');
  });
});

describe('Your cases and Ready to decide', () => {
  const list = [
    dispute({ id: 'D-MINE', assigned_to: 'Abhinav Chitturi', status: 'OPEN' }),
    dispute({ id: 'D-THEIRS', assigned_to: 'Someone Else', status: 'OPEN' }),
    dispute({ id: 'D-FREE', assigned_to: null, status: 'OPEN' }),
    dispute({ id: 'D-READY', assigned_to: 'Abhinav Chitturi', status: 'UNDER_REVIEW' }),
    dispute({ id: 'D-ADMIN', assigned_to: 'Abhinav Chitturi', status: 'PENDING_AI_REVIEW' }),
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

  it('has a Completed tab for cases that are decided, settled or dismissed', async () => {
    api();
    mount(<DisputeQueuePage />, '/queue');
    const tab = await screen.findByRole('tab', { name: /Completed/ });
    await waitFor(() => expect(tab).toHaveTextContent('1'));
    fireEvent.click(tab);
    expect(await screen.findByText('D-DONE')).toBeInTheDocument();
    expect(screen.queryByText('D-MINE')).not.toBeInTheDocument();
  });

  it('"Your cases" lists every case that is yours, including ones you already decided', async () => {
    api();
    mount(<DisputeQueuePage />, '/queue?view=mine');
    await screen.findByText('D-MINE');
    expect(screen.getByText('D-READY')).toBeInTheDocument();
    expect(screen.getByText('D-ADMIN')).toBeInTheDocument();      // still yours while an admin checks it
    expect(screen.queryByText('D-THEIRS')).not.toBeInTheDocument();
    expect(screen.getByText('D-DONE')).toBeInTheDocument();        // a case you decided stays on your list
    expect(screen.queryByText('D-FREE')).not.toBeInTheDocument();
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

  it('shows who owns each case, and an investigator has no way to take one', async () => {
    api();
    mount(<DisputeQueuePage />, '/queue');
    await screen.findByText('D-FREE');
    expect(screen.getByText('Owner: Someone Else')).toBeInTheDocument();
    expect(screen.getAllByText('Yours').length).toBeGreaterThan(0);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    // The manager hands cases out. An investigator asks, they don't pick.
    expect(screen.queryByRole('button', { name: /^Take case/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Assign / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Distribute cases/ })).not.toBeInTheDocument();
  });

  it('the admin sees a With admin list; investigators do not', async () => {
    api();
    const { unmount } = mount(<DisputeQueuePage />, '/queue');
    await screen.findByText('D-FREE');
    expect(screen.queryByRole('tab', { name: /With admin/ })).not.toBeInTheDocument();
    unmount();
    asManager();
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
    // Their case list is the only list there is: they never see anyone else's cases, so there is no separate "all disputes".
    expect(nav.getByRole('link', { name: /Your cases/ })).toHaveAttribute('href', '/queue');
    expect(nav.queryByRole('link', { name: /^Disputes/ })).not.toBeInTheDocument();
    expect(nav.queryByRole('link', { name: /Patterns/ })).not.toBeInTheDocument();       // portfolio-wide, so the manager's
    // An investigator doesn't get the manager's pages.
    expect(nav.queryByRole('link', { name: /Manager review/ })).not.toBeInTheDocument();
    expect(nav.queryByRole('link', { name: /^Team/ })).not.toBeInTheDocument();
    expect(nav.queryByRole('link', { name: /High profile/ })).not.toBeInTheDocument();
  });

  it('a manager also gets High profile, Manager review and Team, but owns no cases so has no Your cases', async () => {
    asManager(); shell();
    const nav = within(screen.getByLabelText('Primary'));
    expect(nav.getByRole('link', { name: /Manager review/ })).toHaveAttribute('href', '/manager');
    expect(nav.getByRole('link', { name: /^Team/ })).toHaveAttribute('href', '/team');
    expect(nav.getByRole('link', { name: /High profile/ })).toHaveAttribute('href', '/queue?view=high');
    expect(nav.queryByRole('link', { name: /Your cases/ })).not.toBeInTheDocument();   // the manager assigns cases, they don't hold any
    expect(nav.getByRole('link', { name: /^Disputes/ })).toHaveAttribute('href', '/queue');              // and the list of everything
    expect(nav.getByRole('link', { name: /Patterns/ })).toBeInTheDocument();
    expect(screen.getByText('PayPal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument(); // no more switching hats: you sign in as one person
  });

  it('signing out clears the session, and the header no longer shows strikes (the Overview does)', async () => {
    signInAs('INVESTIGATOR', { strikes: 4 }); shell();
    expect(screen.queryByText(/strikes/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(window.localStorage.getItem('resolveiq.session')).toBeNull();
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

  it('shows an investigator who owns the case, with no way to take it', async () => {
    api(dispute());
    page();
    expect(await screen.findByText('Unassigned')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Take this case/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Assign this case' })).not.toBeInTheDocument();
  });

  it('while the AI reviewer has the decision, the investigator cannot act and is told why', async () => {
    api(withAdmin({ assigned_to: 'Abhinav Chitturi' }));
    page();
    expect((await screen.findAllByText('With the AI reviewer')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Take action$/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Investigation progress')).toHaveTextContent('Nobody is told until then');
  });

  it('shows the manager\'s note when a case is sent back', async () => {
    api(dispute({ review_note: 'The address check is missing.', reviewed_by: 'PayPal' }));
    page();
    expect(await screen.findByText(/PayPal sent this case back:/)).toBeInTheDocument();
    expect(screen.getByText(/The address check is missing\./)).toBeInTheDocument();
  });

  it('gives the manager the controls to step in on a case waiting for the AI', async () => {
    asManager();
    api(withAdmin());
    page();
    expect(await screen.findByText('Step in on this decision')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm decision/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Take action$/ })).not.toBeInTheDocument();
  });

  it('shows a dismissed case as dismissed in the header, with no separate decision block', async () => {
    api(dispute({ status: 'CLOSED', outcome: 'DISMISSED' }));
    page();
    expect((await screen.findAllByText(/Dismissed/)).length).toBeGreaterThan(0);
    expect(screen.queryByText('Decision')).not.toBeInTheDocument();
  });
});
