import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseInvestigationPage } from '../pages/CaseInvestigationPage';
import { ToastProvider } from '../components/ui/kit';

const baseDispute = {
  id: 'D-1', source: 'synthetic', status: 'OPEN', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', outcome: null,
  amount: 450, currency: 'USD', response_due_date: null, created_at: null, priority_score: 58, priority_factors: [],
  evidence_status: 'MISSING', buyer_claim: 'Never arrived', buyer_reference: 'Alex', merchant_reference: 'TechStore', transaction_id: 'T-1',
  transaction: null, order: null, evidence_items: [], latest_brief_id: null, claim_points: [],
  assigned_to: null, proposed_outcome: null, proposed_reason: null, proposed_by: null, proposed_at: null, review_note: null, reviewed_by: null,
  seller_settled_at: null, buyer_settled_at: null,
};
const line = (evidence_type: string, label: string, over: Record<string, unknown> = {}) => ({
  evidence_type, label, party: 'SELLER', status: 'PROVIDED', detail: '', why: '', description: null, evidence_id: `EV-${evidence_type}`, provided_at: null,
  file_name: null, content_type: null, size_bytes: null, duration_seconds: null, storage: null, preview: null, is_video: false, ...over,
});
const SUMMARY = {
  seller: [line('CARRIER_TRACKING', 'Carrier tracking', { description: 'UPS shows delivered' }), line('PROOF_OF_DELIVERY_SIGNATURE', 'Proof of delivery signature', { status: 'MISSING', evidence_id: null, detail: 'Requested, but the seller did not send it.' })],
  buyer: [line('BUYER_CAMERA_FOOTAGE', 'Camera footage', { party: 'BUYER', status: 'MISSING', evidence_id: null, detail: 'Not requested yet. Ask the buyer for it.' })],
  records: [],
};
const option = (evidence_type: string, label: string, over: Record<string, unknown> = {}) => ({ evidence_type, label, why: `Why ${label}`, on_file: false, on_file_description: null, suggested: false, ...over });
const OPTIONS = {
  seller: [option('PROOF_OF_DELIVERY_SIGNATURE', 'Proof of delivery signature', { suggested: true }), option('ADDRESS_VERIFICATION', 'Address verification', { suggested: true }),
    option('CARRIER_TRACKING', 'Carrier tracking', { on_file: true, on_file_description: 'UPS shows delivered' })],
  buyer: [option('BUYER_CAMERA_FOOTAGE', 'Camera footage', { suggested: true }), option('BUYER_STATEMENT', 'Written statement', { suggested: true })],
};
const RECIPIENT: Record<string, string> = { REQUEST_SELLER_EVIDENCE: 'Seller', REQUEST_BUYER_EVIDENCE: 'Buyer', DECIDE_FOR_BUYER: 'Seller and buyer', DECIDE_FOR_SELLER: 'Seller and buyer' };

function setup(route = '/investigate/D-1', opts: { timeline?: any[]; messages?: any[]; status?: string; outcome?: string | null; evidence_items?: any[]; failBuyer?: boolean; claim_points?: any[] } = {}) {
  const calls: { url: string; body?: any }[] = [];
  let sent: any[] = opts.messages ?? []; // messages the (fake) server has stored so far
  global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, body });
    const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
    if (url.endsWith('/evidence-requests/options')) return ok(OPTIONS);
    if (url.endsWith('/actions/draft')) {
      const items = (body.requested_evidence ?? []).join(', ');
      return ok({ dispute_id: 'D-1', action_type: body.action_type, recipient: RECIPIENT[body.action_type], subject: `Subject for ${body.action_type}`,
        body: `Draft for ${body.action_type}${items ? `: ${items}` : ''}`, cited_record_ids: ['D-1'], source: 'rules', model: null,
        evidence_balance: body.action_type.startsWith('DECIDE')
          ? { toward_buyer: ['Return tracking shows the return arriving at the seller', 'The seller has shown no refund'], toward_seller: [], other: ['Appraisal letter (on file)'] }
          : null,
        warnings: body.action_type.startsWith('DECIDE') ? ["A decision closes the case and moves money. It can't be undone."] : [],
        notes: body.action_type.startsWith('REQUEST') ? ['The reply is due soon.'] : ['This one notice goes to both the seller and the buyer.'] });
    }
    if (url.endsWith('/evidence-summary')) return ok(SUMMARY);
    if (url.endsWith('/decision')) return ok({ success: true, status: 'PENDING_ADMIN_REVIEW', message: 'Sent to an admin for review. Nobody has been told yet.' });
    if (url.endsWith('/actions/preview')) return ok({ dispute_id: 'D-1', action_type: body.action_type, is_supported: true, requires_confirmation: true, impact_summary: 'Impact text', warning_message: null, target_environment: 'demo', api_endpoint: null });
    if (url.endsWith('/actions/execute')) {
      if (opts.failBuyer && body.action_type === 'REQUEST_BUYER_EVIDENCE') {
        return Promise.resolve({ ok: false, status: 400, statusText: 'Bad Request', json: () => Promise.resolve({ detail: 'Buyer service is down' }) });
      }
      const request = body.action_type.startsWith('REQUEST');
      const n = sent.length + 1;
      sent = [...sent, { id: `MSG-${n}`, dispute_id: 'D-1', direction: 'OUTBOUND', counterparty: body.action_type === 'REQUEST_BUYER_EVIDENCE' ? 'BUYER' : 'SELLER', action_type: body.action_type,
        subject: body.subject, body: body.message, source: 'synthetic', awaiting_reply: request, reply_due_at: null, in_reply_to: null, is_read: true,
        requested_evidence: body.requested_evidence ?? [], provided_evidence: [], unavailable_evidence: [], deadline: null, created_at: '2026-01-01T10:00:00' }];
      return ok({ success: true, action_type: body.action_type, dispute_id: 'D-1', message: 'Done in demo', audit_event_id: `AUD-${n}`, environment: 'demo', message_id: `MSG-${n}` });
    }
    if (url.endsWith('/messages')) return ok(sent);
    if (url.includes('/message-threads')) return ok([]);
    if (url.endsWith('/timeline')) return ok(opts.timeline ?? []);
    if (url.endsWith('/similar-cases')) return ok([]);
    if (url.includes('/brief')) return ok({ id: 'B', dispute_id: 'D-1', generated_at: '', provider: 'rule_based', model: null, summary: 's', structured_findings: [], evidence_gaps: [], recommendations: [], generation_status: 'SUCCESS' });
    if (url.includes('/api/disputes/D-1')) return ok({ ...baseDispute, status: opts.status ?? baseDispute.status, outcome: opts.outcome ?? null, evidence_items: opts.evidence_items ?? [], claim_points: opts.claim_points ?? [] });
    return Promise.reject(new Error(`Unhandled url: ${url}`));
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes><Route path="/investigate/:disputeId" element={<CaseInvestigationPage />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return calls;
}

const openWizard = async () => {
  const [btn] = await screen.findAllByRole('button', { name: /^Take action$/i });
  fireEvent.click(btn);
  return screen.findByRole('dialog');
};
const press = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('Case page: take-action popup', () => {
  it('keeps the page clean: no action form until you ask for it', async () => {
    setup();
    await screen.findAllByRole('button', { name: /^Take action$/i });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Message to send')).not.toBeInTheDocument();
  });

  it('offers two ways to ask, a separate Ready to decide button, and says where the case stands', async () => {
    setup();
    const dialog = await openWizard();
    expect(within(dialog).getByText(/Nobody has been asked for anything yet/)).toBeInTheDocument();
    expect(within(dialog).getByText('Ask for evidence')).toBeInTheDocument();
    // Asking can be combined, so those are tick boxes.
    for (const name of ['Ask the seller for evidence', 'Ask the buyer for evidence']) {
      expect(within(dialog).getByRole('checkbox', { name: new RegExp(name, 'i') })).toBeInTheDocument();
    }
    // Deciding is no longer one of the choices. It has its own button.
    expect(within(dialog).queryByText('Make the call')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Decide in the (buyer|seller)'s favor/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Ready to decide' })).toBeEnabled();
    expect(within(dialog).queryByText(/Accept claim|Send tracking/i)).not.toBeInTheDocument();
  });

  it('says one document on file is enough to decide, and counts only what is actually available', async () => {
    const doc = (id: string, availability_status: string) => ({ id, dispute_id: 'D-1', evidence_type: 'APPRAISAL_LETTER', description: 'Letter', availability_status, metadata_json: null });
    setup('/investigate/D-1', { evidence_items: [doc('EV-1', 'AVAILABLE'), doc('EV-2', 'MISSING')] });
    const dialog = await openWizard();
    expect(await within(dialog).findByText(/1 piece of evidence on file\. That's enough to decide now, or you can ask for more\./)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Nobody has been asked for anything yet/)).not.toBeInTheDocument();
  });

  it('asking the seller: pre-ticks what the case lacks, redrafts as you change the list, then sends exactly that', async () => {
    const calls = setup();
    await openWizard();
    press(/Next: write message/i); // first card (ask the seller) is selected by default

    const list = await screen.findByLabelText('What to ask for');
    const sig = within(list).getByRole('checkbox', { name: 'Proof of delivery signature' });
    const addr = within(list).getByRole('checkbox', { name: 'Address verification' });
    const tracking = within(list).getByRole('checkbox', { name: 'Carrier tracking' });
    expect(sig).toBeChecked(); expect(addr).toBeChecked(); expect(tracking).not.toBeChecked();
    expect(within(list).getByText('On file')).toBeInTheDocument();
    expect(within(list).getAllByText('Missing')).toHaveLength(2);

    const box = (await screen.findByLabelText('Message to send')) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe('Draft for REQUEST_SELLER_EVIDENCE: PROOF_OF_DELIVERY_SIGNATURE, ADDRESS_VERIFICATION'));
    expect(screen.getByText('Auto draft')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Draft notes')).getByText('The reply is due soon.')).toBeInTheDocument();

    fireEvent.click(addr); // drop one item: the draft follows
    await waitFor(() => expect((screen.getByLabelText('Message to send') as HTMLTextAreaElement).value).toBe('Draft for REQUEST_SELLER_EVIDENCE: PROOF_OF_DELIVERY_SIGNATURE'));
    fireEvent.change(screen.getByLabelText('Reply within'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Message to send'), { target: { value: 'My own careful wording' } });
    expect(screen.getByText('Reset')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('button', { name: /Next: review/i })).toBeEnabled()); // the redraft for the new deadline has landed
    press(/Next: review/i);
    await screen.findByText(/Message that will be sent to seller/i);
    expect(screen.getAllByText('My own careful wording').length).toBeGreaterThan(0);
    press(/Send request/i);

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/actions/execute'))).toBe(true));
    const exec = calls.find((c) => c.url.endsWith('/actions/execute'))!;
    expect(exec.body).toMatchObject({ action_type: 'REQUEST_SELLER_EVIDENCE', confirmed: true, message: 'My own careful wording', subject: 'Subject for REQUEST_SELLER_EVIDENCE',
      requested_evidence: ['PROOF_OF_DELIVERY_SIGNATURE'], deadline_days: 7 });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Done in demo');
    // You land on the conversation: your message is there and we're waiting on the seller.
    expect(await screen.findByRole('tab', { name: /Messages/i, selected: true })).toBeInTheDocument();
    const convo = await screen.findByLabelText('Seller conversation');
    expect(within(convo).getByText('My own careful wording')).toBeInTheDocument();
    expect(within(convo).getByText(/Waiting for the/)).toHaveTextContent('Waiting for the seller to reply');
    expect(within(screen.getByLabelText('Buyer conversation')).getByText(/Nothing sent to the buyer yet/)).toBeInTheDocument(); // the buyer has their own chat
  });

  it('cannot continue to the message with nothing ticked', async () => {
    setup();
    await openWizard();
    press(/Next: write message/i);
    const list = await screen.findByLabelText('What to ask for');
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Proof of delivery signature' }));
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Address verification' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Next: review/i })).toBeDisabled());
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Carrier tracking' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Next: review/i })).toBeEnabled());
  });

  it('asking the buyer offers the buyer\'s own list, and addresses the buyer', async () => {
    const calls = setup();
    await openWizard();
    // Switch from the default (seller) to the buyer: untick the seller, tick the buyer.
    fireEvent.click(screen.getByRole('checkbox', { name: /Ask the buyer for evidence/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Ask the seller for evidence/i }));
    press(/Next: write message/i);
    const list = await screen.findByLabelText('What to ask for');
    expect(within(list).getByText('What do you need from the buyer?')).toBeInTheDocument();
    expect(within(list).getByRole('checkbox', { name: 'Camera footage' })).toBeChecked();
    expect(within(list).queryByRole('checkbox', { name: 'Address verification' })).not.toBeInTheDocument(); // seller-only item
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/actions/draft') && c.body.action_type === 'REQUEST_BUYER_EVIDENCE')).toBe(true));
  });

  describe('choosing several things at once', () => {
    const asked = (calls: { url: string; body?: any }[]) => calls.filter((c) => c.url.endsWith('/actions/execute')).map((c) => c.body);

    it('lets you tick both seller and buyer and always keeps one', async () => {
      const dialog = await (async () => { setup(); return openWizard(); })();
      const seller = within(dialog).getByRole('checkbox', { name: /Ask the seller for evidence/i });
      const buyer = within(dialog).getByRole('checkbox', { name: /Ask the buyer for evidence/i });
      expect(seller).toBeChecked(); expect(buyer).not.toBeChecked();

      fireEvent.click(buyer);                                   // add the buyer: both ticked
      expect(seller).toBeChecked(); expect(buyer).toBeChecked();
      expect(screen.getByRole('button', { name: /Next: write messages/i })).toBeInTheDocument();

      fireEvent.click(seller);                                  // drop the seller: buyer remains
      expect(seller).not.toBeChecked(); expect(buyer).toBeChecked();
      fireEvent.click(buyer);                                   // can't drop the last one
      expect(buyer).toBeChecked();
    });

    it('asks both sides in one pass: a list and an editable message for each, then sends both', async () => {
      const calls = setup();
      const dialog = await openWizard();
      fireEvent.click(within(dialog).getByRole('checkbox', { name: /Ask the buyer for evidence/i }));
      press(/Next: write messages/i);

      // Each side gets its own checklist and its own message.
      const sellerList = await screen.findByLabelText('What to ask the seller for');
      const buyerList = await screen.findByLabelText('What to ask the buyer for');
      expect(within(sellerList).getByRole('checkbox', { name: 'Proof of delivery signature (seller)' })).toBeChecked();
      expect(within(buyerList).getByRole('checkbox', { name: 'Camera footage (buyer)' })).toBeChecked();
      expect(within(buyerList).queryByText('Address verification')).not.toBeInTheDocument(); // a seller-only item

      const toSeller = (await screen.findByLabelText('Message to the seller')) as HTMLTextAreaElement;
      const toBuyer = (await screen.findByLabelText('Message to the buyer')) as HTMLTextAreaElement;
      await waitFor(() => expect(toSeller.value).toBe('Draft for REQUEST_SELLER_EVIDENCE: PROOF_OF_DELIVERY_SIGNATURE, ADDRESS_VERIFICATION'));
      await waitFor(() => expect(toBuyer.value).toBe('Draft for REQUEST_BUYER_EVIDENCE: BUYER_CAMERA_FOOTAGE, BUYER_STATEMENT'));
      expect(within(screen.getByLabelText('Draft notes (seller)')).getByText('The reply is due soon.')).toBeInTheDocument();

      // They're independent: editing one, or changing one list, leaves the other alone.
      fireEvent.change(toBuyer, { target: { value: 'Buyer wording I wrote myself' } });
      fireEvent.click(within(sellerList).getByRole('checkbox', { name: 'Address verification (seller)' }));
      await waitFor(() => expect((screen.getByLabelText('Message to the seller') as HTMLTextAreaElement).value).toBe('Draft for REQUEST_SELLER_EVIDENCE: PROOF_OF_DELIVERY_SIGNATURE'));
      expect((screen.getByLabelText('Message to the buyer') as HTMLTextAreaElement).value).toBe('Buyer wording I wrote myself');

      await waitFor(() => expect(screen.getByRole('button', { name: /Next: review/i })).toBeEnabled());
      press(/Next: review/i);
      await screen.findByText('Buyer wording I wrote myself', { selector: 'pre' });
      expect(screen.getAllByText(/Message that will be sent to/i)).toHaveLength(2);
      press(/Send 2 requests/i);

      await waitFor(() => expect(asked(calls)).toHaveLength(2));
      const [first, second] = asked(calls);
      expect(first).toMatchObject({ action_type: 'REQUEST_SELLER_EVIDENCE', requested_evidence: ['PROOF_OF_DELIVERY_SIGNATURE'], confirmed: true });
      expect(second).toMatchObject({ action_type: 'REQUEST_BUYER_EVIDENCE', requested_evidence: ['BUYER_CAMERA_FOOTAGE', 'BUYER_STATEMENT'], message: 'Buyer wording I wrote myself' });

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByRole('status')).toHaveTextContent('Requests sent to the seller and the buyer.');
      // You land on the conversation, waiting on both.
      // Each side has its own chat, and each is waiting.
      expect(within(await screen.findByLabelText('Seller conversation')).getByText(/Waiting for the/)).toHaveTextContent('seller');
      expect(within(screen.getByLabelText('Buyer conversation')).getByText(/Waiting for the/)).toHaveTextContent('buyer');
    });

    it("can't continue while one of the two lists is empty", async () => {
      setup();
      const dialog = await openWizard();
      fireEvent.click(within(dialog).getByRole('checkbox', { name: /Ask the buyer for evidence/i }));
      press(/Next: write messages/i);
      const buyerList = await screen.findByLabelText('What to ask the buyer for');
      await waitFor(() => expect(screen.getByRole('button', { name: /Next: review/i })).toBeEnabled());
      for (const name of ['Camera footage (buyer)', 'Written statement (buyer)']) fireEvent.click(within(buyerList).getByRole('checkbox', { name }));
      await waitFor(() => expect(screen.getByRole('button', { name: /Next: review/i })).toBeDisabled());
    });

    it('is honest when the second request fails after the first went out', async () => {
      const calls = setup('/investigate/D-1', { failBuyer: true });
      const dialog = await openWizard();
      fireEvent.click(within(dialog).getByRole('checkbox', { name: /Ask the buyer for evidence/i }));
      press(/Next: write messages/i);
      await waitFor(() => expect((screen.getByLabelText('Message to the buyer') as HTMLTextAreaElement).value).toContain('Draft for REQUEST_BUYER_EVIDENCE'));
      await waitFor(() => expect(screen.getByRole('button', { name: /Next: review/i })).toBeEnabled());
      press(/Next: review/i);
      await screen.findAllByText(/Message that will be sent to/i);
      press(/Send 2 requests/i);

      expect(await screen.findByText(/The request to the seller was sent, but the one to the buyer failed: Buyer service is down/)).toBeInTheDocument();
      expect(asked(calls).map((b) => b.action_type)).toEqual(['REQUEST_SELLER_EVIDENCE', 'REQUEST_BUYER_EVIDENCE']);
      expect(screen.getByRole('dialog')).toBeInTheDocument(); // stays open so nothing is lost
    });
  });

  it('Ready to decide opens one page: the evidence (missing in red), the facts, then a reason and two buttons', async () => {
    const calls = setup();
    const dialog = await openWizard();
    press(/^Ready to decide$/);

    // Choose, then Decide. There is no message to write: an admin sends the notice.
    const steps = within(screen.getByLabelText('Steps'));
    expect(steps.getAllByRole('listitem').map((li) => (li.textContent ?? '').replace(/^\d/, ''))).toEqual(['Choose', 'Decide']);
    expect(screen.queryByLabelText('Message to send')).not.toBeInTheDocument();

    // What each side sent is shown, and what is missing is red and says why.
    const evidence = await screen.findByLabelText('Evidence on this case');
    expect(within(evidence).getByText('UPS shows delivered')).toBeInTheDocument();
    const missing = within(evidence).getByText('Requested, but the seller did not send it.');
    expect(missing).toHaveClass('text-red-300/90');
    expect(missing.closest('li')).toHaveAttribute('data-status', 'MISSING');
    expect(within(evidence).getByText('2 items missing')).toBeInTheDocument();

    // The facts panel is a summary, not a verdict.
    expect(await screen.findByLabelText('How the evidence stacks up')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm decision/i })).not.toBeInTheDocument();

    const forBuyer = within(dialog).getByRole('button', { name: /^Buyer's favor$/ });
    const forSeller = within(dialog).getByRole('button', { name: /^Seller's favor$/ });
    expect(forBuyer).toBeDisabled(); expect(forSeller).toBeDisabled();

    // A reason is required, and so is ticking that you reviewed the evidence.
    fireEvent.click(screen.getByRole('checkbox', { name: /reviewed the evidence on file/i }));
    expect(forBuyer).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for your decision'), { target: { value: 'too short' } });
    expect(forBuyer).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for your decision'), { target: { value: 'The carrier delivered to the confirmed address.' } });
    await waitFor(() => expect(forSeller).toBeEnabled());
    fireEvent.click(forSeller);

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/decision'))).toBe(true));
    const sent = calls.find((c) => c.url.endsWith('/decision'))!;
    expect(sent.body).toMatchObject({ outcome: 'SELLER_FAVOR', reason: 'The carrier delivered to the confirmed address.', confirmed: true, actor: 'Abhinav Chitturi' });
    expect(calls.some((c) => c.url.endsWith('/actions/execute'))).toBe(false); // nobody is told yet
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Sent to an admin for review. Nobody has been told yet.');
  });

  it('before you decide, shows what points toward each side, says it is not a verdict, and shows nothing like it when asking for evidence', async () => {
    setup();
    await openWizard();
    // Asking for evidence: no balance panel.
    press(/Next: write message/i);
    await screen.findByLabelText('Message to send');
    expect(screen.queryByLabelText('How the evidence stacks up')).not.toBeInTheDocument();
    press(/Back/i);

    press(/^Ready to decide$/);
    const panel = await screen.findByLabelText('How the evidence stacks up');
    expect(within(panel).getByText(/It isn't a verdict\. The call is yours\./)).toBeInTheDocument();
    expect(within(panel).getByText(/Toward the buyer/)).toHaveTextContent('(2)');
    expect(within(panel).getByText('Return tracking shows the return arriving at the seller')).toBeInTheDocument();
    expect(within(panel).getByText('The seller has shown no refund')).toBeInTheDocument();
    expect(within(panel).getByText(/Toward the seller/)).toHaveTextContent('(0)');
    expect(within(panel).getByText('Nothing on this side.')).toBeInTheDocument(); // an empty side says so
    expect(within(panel).getByText('Also on file: Appraisal letter (on file)')).toBeInTheDocument();
  });

  it('going back from the decision page returns to asking for evidence', async () => {
    setup();
    await openWizard();
    press(/^Ready to decide$/);
    await screen.findByLabelText('Reason for your decision');
    press(/Back/i);
    expect(screen.getByRole('group', { name: 'Ask for evidence' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Reason for your decision')).not.toBeInTheDocument();
  });

  it('Back and Cancel work and nothing is sent', async () => {
    const calls = setup();
    await openWizard();
    press(/Next: write message/i);
    await screen.findByLabelText('Message to send');
    press(/Back/i);
    expect(screen.getByRole('group', { name: 'Ask for evidence' })).toBeInTheDocument();
    press(/Cancel/i);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.some((c) => c.url.endsWith('/actions/execute'))).toBe(false);
  });

  it('opens straight into the popup from the ?action=1 deep link', async () => {
    setup('/investigate/D-1?action=1');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('a decided case shows how it ended and offers no more actions', async () => {
    setup('/investigate/D-1', { status: 'RESOLVED', outcome: 'BUYER_FAVOR' });
    expect(await screen.findByText("Decided: buyer's favor")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Take action$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Decide by')).not.toBeInTheDocument(); // no countdown once it's decided
    expect(screen.getByLabelText('Investigation progress')).toHaveTextContent("Decided in the buyer's favor.");
    expect(screen.getByLabelText('Investigation progress')).toHaveTextContent('100%');
    // Where the button would be, say why there isn't one. And don't advise on a case that's finished.
    expect(screen.getByText('Decided. No further action.')).toBeInTheDocument();
    expect(await screen.findByText("Decided in the buyer's favor.", { selector: 'p.font-medium' })).toBeInTheDocument();
    expect(screen.queryByText('What to do next')).not.toBeInTheDocument();
    expect(screen.queryByText(/Review the evidence on file and make your decision/)).not.toBeInTheDocument();
  });
});

describe('Case page: remembered for the Investigation link', () => {
  it('records the case you opened', async () => {
    window.localStorage.removeItem('resolveiq.lastCase');
    setup('/investigate/D-1');
    await screen.findAllByRole('button', { name: /^Take action$/i });
    expect(window.localStorage.getItem('resolveiq.lastCase')).toBe('D-1');
  });
});

describe('Case page: evidence from both sides', () => {
  const footage = { id: 'EV-F', dispute_id: 'D-1', evidence_type: 'BUYER_CAMERA_FOOTAGE', description: 'Provided by buyer: Porch camera video', availability_status: 'AVAILABLE',
    metadata_json: JSON.stringify({ provided_by: 'BUYER', file_name: 'porch-camera.mp4', content_type: 'video/mp4', size_bytes: 24117248, duration_seconds: 108, storage: 'File is stored by PayPal. The demo keeps this reference only.' }) };
  const signature = { id: 'EV-S', dispute_id: 'D-1', evidence_type: 'PROOF_OF_DELIVERY_SIGNATURE', description: 'Provided by seller: Signed', availability_status: 'AVAILABLE', metadata_json: JSON.stringify({ provided_by: 'SELLER' }) };
  const plain = { id: 'EV-T', dispute_id: 'D-1', evidence_type: 'CARRIER_TRACKING', description: 'UPS shows delivered', availability_status: 'AVAILABLE', metadata_json: '{not json' };

  it('says who provided each document, and shows a video as a file reference', async () => {
    setup('/investigate/D-1', { evidence_items: [footage, signature, plain] });
    fireEvent.click(await screen.findByRole('tab', { name: /Evidence/i }));
    const clip = (await screen.findByText('Provided by buyer: Porch camera video')).closest('li') as HTMLElement;
    expect(within(clip).getByText('From the buyer')).toBeInTheDocument();
    expect(within(clip).getByText('Camera footage')).toBeInTheDocument();
    expect(within(clip).getByText('porch-camera.mp4')).toBeInTheDocument();
    expect(within(clip).getByText('video/mp4')).toBeInTheDocument();
    expect(within(clip).getByText('24 MB')).toBeInTheDocument();
    expect(within(clip).getByText('1m 48s')).toBeInTheDocument();
    expect(within(clip).getByText(/stored by PayPal/)).toBeInTheDocument();

    const sig = screen.getByText('Provided by seller: Signed').closest('li') as HTMLElement;
    expect(within(sig).getByText('From the seller')).toBeInTheDocument();
    // Malformed metadata can't break the page.
    const trk = screen.getByText('UPS shows delivered').closest('li') as HTMLElement;
    expect(within(trk).queryByText(/From the/)).not.toBeInTheDocument();
  });
});

describe('Case page: timeline', () => {
  const events = [
    { id: 'E1', timestamp: '2026-10-18T10:00:00', event_type: 'DISPUTE', title: 'Dispute Filed: MERCHANDISE_OR_SERVICE_NOT_RECEIVED', description: 'Buyer assertion: "It never came."', source: 'synthetic', source_record_id: 'D-1', status: 'WAITING_FOR_SELLER_RESPONSE' },
    { id: 'E2', timestamp: '2026-10-19T10:00:00', event_type: 'SHIPMENT', title: 'Carrier Reported DELIVERED', description: 'Delivery confirmation to Springfield, IL. Address match: unknown', source: 'synthetic', source_record_id: 'DEMO-SHIP-1', status: 'DELIVERED' },
    { id: 'E3', timestamp: '2026-10-20T10:00:00', event_type: 'EVIDENCE', title: 'Evidence Logged: CARRIER_TRACKING', description: 'Carrier tracking shows delivered.', source: 'synthetic', source_record_id: 'EV-1', status: 'AVAILABLE' },
    { id: 'E4', timestamp: '2026-10-21T10:00:00', event_type: 'ORDER', title: 'Order Placed (DEMO-ORD-1042)', description: 'Purchased headphones for USD 450.00', source: 'synthetic', source_record_id: 'DEMO-ORD-1042', status: null },
  ];
  const openTimeline = async () => {
    fireEvent.click(await screen.findByRole('tab', { name: /Timeline/i }));
    return screen.findByLabelText('Timeline');
  };

  it('shows only the headline of each event, with codes made readable', async () => {
    setup('/investigate/D-1', { timeline: events });
    const list = await openTimeline();
    expect(within(list).getByText('Dispute Filed: Item not received')).toBeInTheDocument();
    expect(within(list).getByText('Carrier Reported delivered')).toBeInTheDocument();
    expect(within(list).getByText('Evidence Logged: Carrier tracking')).toBeInTheDocument();
    expect(within(list).getByText('Order Placed (DEMO-ORD-1042)')).toBeInTheDocument(); // record ids are not mangled
    // The details are not on the page until you ask for them.
    expect(screen.queryByText(/Address match: unknown/)).not.toBeInTheDocument();
    expect(screen.queryByText(/It never came/)).not.toBeInTheDocument();
  });

  it('opens the details in a popup when you select an event, and closes it again', async () => {
    setup('/investigate/D-1', { timeline: events });
    const list = await openTimeline();
    fireEvent.click(within(list).getByText('Carrier Reported delivered'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Carrier Reported delivered')).toBeInTheDocument();
    expect(within(dialog).getByText(/Address match: unknown/)).toBeInTheDocument();
    expect(within(dialog).getByText('DEMO-SHIP-1')).toBeInTheDocument();
    expect(within(dialog).getByText('Shipment')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(/Address match: unknown/)).not.toBeInTheDocument();
  });

  it('offers a shortcut to the evidence record from an evidence event', async () => {
    setup('/investigate/D-1', { timeline: events });
    const list = await openTimeline();
    fireEvent.click(within(list).getByText('Evidence Logged: Carrier tracking'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /View in Evidence/i }));
    expect(await screen.findByRole('tab', { name: /Evidence/i, selected: true })).toBeInTheDocument();
  });
});
