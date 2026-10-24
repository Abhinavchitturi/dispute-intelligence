import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessagesPage } from '../pages/MessagesPage';
import { MessageThread } from '../components/MessageThread';
import { ToastProvider } from '../components/ui/kit';
import { parseServerDate, timeAgo, timeLeft } from '../lib/format';

const base = { dispute_id: 'D-1', subject: 'Evidence needed for dispute D-1', body: 'We need two things.', source: 'synthetic', awaiting_reply: false, reply_due_at: null as string | null,
  in_reply_to: null as string | null, is_read: true, requested_evidence: [] as string[], provided_evidence: [] as string[], unavailable_evidence: [] as string[], deadline: null as string | null,
  created_at: '2026-01-01T10:00:00' };
const toSeller = (over = {}): any => ({ ...base, id: 'MSG-S', direction: 'OUTBOUND', counterparty: 'SELLER', action_type: 'REQUEST_SELLER_EVIDENCE', awaiting_reply: true, reply_due_at: '2099-01-01T00:00:00',
  requested_evidence: ['PROOF_OF_DELIVERY_SIGNATURE', 'ADDRESS_VERIFICATION'], deadline: '2026-01-06T10:00:00', ...over });
const toBuyer = (over = {}): any => ({ ...base, id: 'MSG-B', direction: 'OUTBOUND', counterparty: 'BUYER', action_type: 'REQUEST_BUYER_EVIDENCE', subject: 'We need more information about your dispute D-1',
  body: 'Please send footage.', awaiting_reply: true, reply_due_at: '2099-01-01T00:00:00', requested_evidence: ['BUYER_CAMERA_FOOTAGE'], ...over });
const sellerReply = (over = {}): any => ({ ...base, id: 'MSG-SR', direction: 'INBOUND', counterparty: 'SELLER', action_type: 'REQUEST_SELLER_EVIDENCE', subject: 'Re: Evidence needed for dispute D-1',
  body: 'Thank you.\n\nWHAT WE\'RE SENDING\n- Address verification: GPS matches.', in_reply_to: 'MSG-S', is_read: false,
  provided_evidence: ['ADDRESS_VERIFICATION'], unavailable_evidence: ['PROOF_OF_DELIVERY_SIGNATURE'], created_at: '2026-01-01T10:05:00', ...over });
const decisionTo = (counterparty: string): any => ({ ...base, id: `MSG-D-${counterparty}`, direction: 'OUTBOUND', counterparty, action_type: 'DECIDE_FOR_BUYER', subject: 'Decision on dispute D-1: resolved in the buyer\'s favor',
  body: 'DECISION\nResolved in the buyer\'s favor.', created_at: '2026-01-01T11:00:00' });
const thread = (over = {}): any => ({ dispute_id: 'D-1', buyer_reference: 'Alex', merchant_reference: 'TechStore', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', amount: 450, currency: 'USD',
  dispute_status: 'WAITING_FOR_SELLER_RESPONSE', state: 'WAITING', waiting_on: 'Seller', last_message_preview: 'We need two things.', last_message_at: '2026-01-01T10:00:00',
  last_direction: 'OUTBOUND', unread_count: 0, message_count: 1, awaiting_since: '2026-01-01T10:00:00', expected_reply_at: '2099-01-01T00:00:00', simulated: true,
  pending_message_ids: ['MSG-S'], outcome: null, ...over });

function LocationProbe() { const l = useLocation(); return <div data-testid="loc">{l.pathname + l.search}</div>; }
const wrap = (ui: React.ReactElement, route = '/') => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MemoryRouter initialEntries={[route]}>{ui}<LocationProbe /></MemoryRouter></ToastProvider>
  </QueryClientProvider>
);
const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

describe('server dates', () => {
  it('reads timestamps without a timezone as UTC, not local time', () => {
    expect(parseServerDate('2026-01-01T10:00:00').toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(parseServerDate('2026-01-01T10:00:00Z').toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(parseServerDate('2026-01-01T15:30:00+05:30').toISOString()).toBe('2026-01-01T10:00:00.000Z');
    const now = Date.parse('2026-01-01T10:30:00Z');
    expect(timeAgo('2026-01-01T10:00:00', now)).toBe('30m ago'); // would be hours off if parsed as local time
    expect(timeLeft('2026-01-01T18:00:00', now).hours).toBeCloseTo(7.5, 1);
  });
});

describe('MessageThread (PayPal, the seller and the buyer)', () => {
  it('shows what was asked of the seller and that we are waiting, then the seller\'s reply and that PayPal can decide', async () => {
    let replied = false;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/simulate-reply')) { replied = true; return ok(sellerReply()); }
      if (url.endsWith('/messages/read')) return ok({ marked_read: 0 });
      if (url.endsWith('/messages')) return ok(replied ? [toSeller({ awaiting_reply: false }), sellerReply()] : [toSeller()]);
      return ok([]);
    }) as any;
    const onTake = vi.fn();
    render(wrap(<MessageThread disputeId="D-1" disputeStatus="WAITING_FOR_SELLER_RESPONSE" onTakeAction={onTake} />));

    const convo = await screen.findByLabelText('Conversation');
    expect(within(convo).getByText('You → Seller')).toBeInTheDocument();
    expect(within(convo).getByText('Proof of delivery signature')).toBeInTheDocument(); // what PayPal asked for
    expect(within(convo).getByText('Address verification')).toBeInTheDocument();
    expect(within(convo).getByText(/reply by/)).toBeInTheDocument();
    expect(within(convo).getByText(/Waiting for the/)).toHaveTextContent('Waiting for the seller to reply');
    expect(screen.queryByText(/The evidence is in/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Simulate seller reply/i }));
    await waitFor(() => expect(within(screen.getByLabelText('Conversation')).getByText('Seller → You')).toBeInTheDocument());
    const c2 = screen.getByLabelText('Conversation');
    expect(within(c2).getByText('Simulated reply')).toBeInTheDocument();
    expect(within(c2).getByText('✓ Address verification')).toBeInTheDocument();
    expect(within(c2).getByText(/Couldn't provide: proof of delivery signature/)).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the/)).not.toBeInTheDocument();
  });

  it('with both sides asked, shows each wait separately with its own simulate button', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => (url.endsWith('/messages') ? ok([toSeller(), toBuyer()]) : ok({ marked_read: 0 }))) as any;
    render(wrap(<MessageThread disputeId="D-1" disputeStatus="WAITING_FOR_BOTH_RESPONSES" />));
    const waits = await screen.findAllByText(/Waiting for the/);
    expect(waits.map((w) => w.textContent)).toEqual([expect.stringContaining('seller'), expect.stringContaining('buyer')]);
    expect(screen.getByRole('button', { name: /Simulate seller reply/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Simulate buyer reply/i })).toBeInTheDocument();
  });

  it('tells PayPal the evidence is in once every request is answered, and offers to decide', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => (url.endsWith('/messages') ? ok([toSeller({ awaiting_reply: false }), sellerReply({ is_read: true })]) : ok({ marked_read: 0 }))) as any;
    const onTake = vi.fn();
    render(wrap(<MessageThread disputeId="D-1" disputeStatus="UNDER_REVIEW" onTakeAction={onTake} />));
    expect(await screen.findByRole('status')).toHaveTextContent('The evidence is in');
    fireEvent.click(screen.getByRole('button', { name: /Review and decide/i }));
    expect(onTake).toHaveBeenCalled();
  });

  it('shows a decision once, addressed to both parties, and says how the case ended', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => (url.endsWith('/messages')
      ? ok([toSeller({ awaiting_reply: false }), sellerReply({ is_read: true }), decisionTo('SELLER'), decisionTo('BUYER')]) : ok({ marked_read: 0 }))) as any;
    render(wrap(<MessageThread disputeId="D-1" disputeStatus="RESOLVED" outcome="BUYER_FAVOR" />));
    const convo = await screen.findByLabelText('Conversation');
    expect(within(convo).getAllByText('You → Seller and buyer')).toHaveLength(1); // one notice, not two
    expect(within(convo).getByText('Decision')).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent("Decided in the buyer's favor");
    expect(screen.queryByRole('button', { name: /Review and decide/i })).not.toBeInTheDocument();
  });

  it('lays the conversation out like a chat: their replies on the left, PayPal\'s messages on the right, a decision in the middle', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => (url.endsWith('/messages')
      ? ok([toSeller({ awaiting_reply: false }), sellerReply({ is_read: true }), toBuyer(), decisionTo('SELLER'), decisionTo('BUYER')]) : ok({ marked_read: 0 }))) as any;
    render(wrap(<MessageThread disputeId="D-1" disputeStatus="WAITING_FOR_BUYER_RESPONSE" />));
    const convo = await screen.findByLabelText('Conversation');
    const row = (text: string) => within(convo).getByText(text).closest('li') as HTMLElement;

    expect(row('You → Seller')).toHaveClass('justify-end');                    // PayPal's request: right
    expect(row('Seller → You')).toHaveClass('justify-start');                  // the seller's reply: left
    expect(row('You → Buyer')).toHaveClass('justify-end');                     // PayPal's other request: right
    expect(row('You → Seller and buyer')).toHaveClass('justify-center');       // a decision addresses both, so it's centred
    expect(within(convo).getByText(/Waiting for the/).closest('li')).toHaveClass('justify-start'); // the awaited reply will land on the left
    // Bubbles are narrower than the pane, so the two sides are visibly apart.
    for (const t of ['You → Seller', 'Seller → You']) expect(row(t).querySelector('article')!.className).toMatch(/md:max-w-\[70%\]/);
  });

  it('marks new replies read and highlights them as New', async () => {
    const calls: string[] = [];
    global.fetch = vi.fn().mockImplementation((url: string) => {
      calls.push(url);
      if (url.endsWith('/messages/read')) return ok({ marked_read: 1 });
      if (url.endsWith('/messages')) return ok([toSeller({ awaiting_reply: false }), sellerReply()]);
      return ok([]);
    }) as any;
    render(wrap(<MessageThread disputeId="D-1" disputeStatus="UNDER_REVIEW" />));
    expect(await screen.findByText('New')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((u) => u.endsWith('/messages/read'))).toBe(true));
  });

  it("is honest that real replies aren't synced", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => (url.endsWith('/messages') ? ok([toSeller({ source: 'paypal_sandbox', reply_due_at: null })]) : ok([]))) as any;
    render(wrap(<MessageThread disputeId="D-1" />));
    expect(await screen.findByText(/aren't synced into this app yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Simulate/i })).not.toBeInTheDocument();
  });

  it('explains the empty state', async () => {
    global.fetch = vi.fn().mockImplementation(() => ok([])) as any;
    render(wrap(<MessageThread disputeId="D-1" />));
    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
  });
});

describe('Messages workspace', () => {
  const threads = [
    thread({ dispute_id: 'D-1', state: 'WAITING', waiting_on: 'Seller and buyer' }),
    thread({ dispute_id: 'D-2', state: 'YOUR_TURN', waiting_on: null, unread_count: 1, dispute_status: 'UNDER_REVIEW', last_direction: 'INBOUND', last_message_preview: 'Thank you.', pending_message_ids: [] }),
    thread({ dispute_id: 'D-3', state: 'CLOSED', waiting_on: null, dispute_status: 'RESOLVED', outcome: 'BUYER_FAVOR', pending_message_ids: [] }),
  ];
  const api = () => vi.fn().mockImplementation((url: string) => {
    if (url.includes('/message-threads')) return ok(threads);
    if (url.endsWith('/evidence-requests/options')) return ok({ seller: [], buyer: [] });
    if (url.endsWith('/messages')) return ok([toSeller()]);
    if (/\/api\/disputes\/D-\d$/.test(url)) return ok({ id: 'D-1', status: 'OPEN', evidence_items: [] });
    return ok({ marked_read: 0 });
  }) as any;

  it('lists who we are waiting on, which cases are ready to decide, and how decided ones ended', async () => {
    global.fetch = api();
    render(wrap(<MessagesPage />, '/messages'));
    const list = await screen.findByLabelText('Conversations');
    expect(within(list).getByText('Waiting on seller and buyer')).toBeInTheDocument();
    expect(within(list).getByText('Ready to decide')).toBeInTheDocument();
    expect(within(list).getByText("Decided: buyer's favor")).toBeInTheDocument();
    expect(within(list).getByLabelText('1 unread')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /^Ready to decide/ }));
    await waitFor(() => {
      const l = screen.getByLabelText('Conversations');
      expect(within(l).queryByText('D-1')).not.toBeInTheDocument();
      expect(within(l).getByText('D-2')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: /^Waiting/ }));
    await waitFor(() => expect(within(screen.getByLabelText('Conversations')).getByText('D-1')).toBeInTheDocument());
    expect(within(screen.getByLabelText('Conversations')).queryByText('D-2')).not.toBeInTheDocument();
  });

  it('puts the conversation on the left and the list (All / Waiting / Ready to decide) on the right', async () => {
    global.fetch = api();
    render(wrap(<MessagesPage />, '/messages?case=D-2'));
    const list = (await screen.findByLabelText('Conversations')).closest('[aria-label="Conversation list"]') as HTMLElement;
    const heading = await screen.findByRole('heading', { name: 'D-2' });
    const conversation = heading.closest('div.rounded-2xl') as HTMLElement;
    const grid = list.parentElement as HTMLElement;

    expect(grid.className).toMatch(/lg:grid-cols-\[1fr_380px\]/);   // wide conversation column, then the narrow list column
    expect(conversation.className).toMatch(/lg:order-1/);          // conversation first (left) on a wide screen
    expect(list.className).toMatch(/lg:order-2/);                  // list second (right)
    expect(within(list).getByRole('tab', { name: /Ready to decide/ })).toBeInTheDocument(); // the tabs live with the list
    expect(within(conversation).queryByRole('tab')).not.toBeInTheDocument();
    // On a narrow screen the order is list, then conversation, so you choose before you read.
    expect(list.compareDocumentPosition(conversation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the selected conversation and can jump to the case', async () => {
    global.fetch = api();
    render(wrap(<MessagesPage />, '/messages?case=D-2'));
    expect(await screen.findByRole('heading', { name: 'D-2' })).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent('/messages?case=D-2');
    fireEvent.click(screen.getByRole('button', { name: /Open case/i }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/investigate/D-2'));
  });

  it('lets PayPal take action right here, without leaving the page, but not on a decided case', async () => {
    global.fetch = api();
    render(wrap(<MessagesPage />, '/messages?case=D-1'));
    fireEvent.click(await screen.findByRole('button', { name: /^Take action$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Ask for evidence')).toBeInTheDocument();
    expect(within(dialog).getByText('Make the call')).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent('/messages?case=D-1'); // never left the page
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(within(screen.getByLabelText('Conversations')).getByText('D-3'));
    await screen.findByRole('heading', { name: 'D-3' });
    expect(screen.queryByRole('button', { name: /^Take action$/i })).not.toBeInTheDocument();
  });

  it('explains what to do when nothing has been sent', async () => {
    global.fetch = vi.fn().mockImplementation(() => ok([])) as any;
    render(wrap(<MessagesPage />, '/messages'));
    expect(await screen.findByText('Nothing sent yet')).toBeInTheDocument();
  });
});
