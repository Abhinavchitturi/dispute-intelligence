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

const detail = (over = {}) => ({ id: 'D-1', source: 'synthetic', status: 'OPEN', merchant_reference: 'TechStore', buyer_reference: 'Alex', seller_settled_at: null, buyer_settled_at: null, evidence_items: [], claim_points: [], ...over });
const emptySummary = { seller: [], buyer: [], records: [] };
/** A fetch for one dispute's conversation. Anything it doesn't know about answers with an empty list. */
const talk = (messages: () => any[], extra: (url: string, init?: RequestInit) => any = () => undefined, disp = detail()) => vi.fn().mockImplementation((url: string, init?: RequestInit) => {
  const special = extra(url, init);
  if (special !== undefined) return special;
  if (url.endsWith('/messages/read')) return ok({ marked_read: 0 });
  if (url.endsWith('/evidence-summary')) return ok(emptySummary);
  if (url.endsWith('/messages')) return ok(messages());
  if (/\/api\/disputes\/D-\d$/.test(url)) return ok(disp);
  return ok([]);
}) as any;

describe('MessageThread (PayPal, the seller and the buyer)', () => {
  it('gives the seller and the buyer their own chat, side by side', async () => {
    global.fetch = talk(() => [toSeller(), toBuyer()]);
    render(wrap(<MessageThread disputeId="D-1" disputeStatus="WAITING_FOR_BOTH_RESPONSES" />));
    const seller = await screen.findByLabelText('Seller conversation');
    const buyer = screen.getByLabelText('Buyer conversation');
    // Each side only sees what was sent to them.
    expect(within(seller).getByText('Evidence needed for dispute D-1')).toBeInTheDocument();
    expect(within(seller).queryByText('We need more information about your dispute D-1')).not.toBeInTheDocument();
    expect(within(buyer).getByText('We need more information about your dispute D-1')).toBeInTheDocument();
    expect(within(buyer).queryByText('Evidence needed for dispute D-1')).not.toBeInTheDocument();
    // They sit next to each other on a wide screen.
    expect(seller.closest('div.grid')).toBe(buyer.closest('div.grid'));
    expect((seller.closest('div.grid') as HTMLElement).className).toMatch(/lg:grid-cols-2/);
    expect(within(seller).getByText(/Waiting for the/)).toHaveTextContent('seller');
    expect(within(buyer).getByText(/Waiting for the/)).toHaveTextContent('buyer');
    expect(within(buyer).getByRole('button', { name: /Simulate buyer reply/i })).toBeInTheDocument();
    expect(within(seller).queryByRole('button', { name: /Simulate buyer reply/i })).not.toBeInTheDocument();
  });

  it('shows what was asked of the seller and that we are waiting, then the seller\'s reply and that PayPal can decide', async () => {
    let replied = false;
    global.fetch = talk(() => (replied ? [toSeller({ awaiting_reply: false }), sellerReply()] : [toSeller()]), (url) => {
      if (url.endsWith('/simulate-reply')) { replied = true; return ok(sellerReply()); }
      return undefined;
    });
    render(wrap(<MessageThread disputeId="D-1" disputeStatus="WAITING_FOR_SELLER_RESPONSE" onTakeAction={vi.fn()} />));

    const convo = await screen.findByLabelText('Seller conversation');
    expect(within(convo).getByText('PayPal')).toBeInTheDocument();
    expect(within(convo).getByText('Proof of delivery signature')).toBeInTheDocument(); // what PayPal asked for
    expect(within(convo).getByText('Address verification')).toBeInTheDocument();
    expect(within(convo).getByText(/reply by/)).toBeInTheDocument();
    expect(within(convo).getByText(/Waiting for the/)).toHaveTextContent('Waiting for the seller to reply');
    expect(screen.queryByText(/The evidence is in/)).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Buyer conversation')).getByText(/Nothing sent to the buyer yet/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Simulate seller reply/i }));
    await waitFor(() => expect(within(screen.getByLabelText('Seller conversation')).getByText('Simulated')).toBeInTheDocument());
    const c2 = screen.getByLabelText('Seller conversation');
    expect(within(c2).getByText('✓ Address verification')).toBeInTheDocument();
    expect(within(c2).getByText(/Couldn't provide: proof of delivery signature/)).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the/)).not.toBeInTheDocument();
  });

  it('tells PayPal the evidence is in once every request is answered, and offers Ready to decide', async () => {
    global.fetch = talk(() => [toSeller({ awaiting_reply: false }), sellerReply({ is_read: true })]);
    const onTake = vi.fn();
    render(wrap(<MessageThread disputeId="D-1" disputeStatus="UNDER_REVIEW" onTakeAction={onTake} />));
    expect(await screen.findByRole('status')).toHaveTextContent('The evidence is in');
    fireEvent.click(screen.getByRole('button', { name: /^Ready to decide$/i }));
    expect(onTake).toHaveBeenCalled();
  });

  it('puts a decision in both chats, and says how the case ended', async () => {
    global.fetch = talk(() => [toSeller({ awaiting_reply: false }), sellerReply({ is_read: true }), decisionTo('SELLER'), decisionTo('BUYER')]);
    render(wrap(<MessageThread disputeId="D-1" disputeStatus="RESOLVED" outcome="BUYER_FAVOR" />));
    const seller = await screen.findByLabelText('Seller conversation');
    const buyer = screen.getByLabelText('Buyer conversation');
    for (const chat of [seller, buyer]) {
      expect(within(chat).getByText('Decision')).toBeInTheDocument();
      expect(within(chat).getByText(/Decision on dispute D-1/)).toBeInTheDocument();
    }
    expect(await screen.findByRole('status')).toHaveTextContent("Decided in the buyer's favor");
    expect(screen.queryByRole('button', { name: /Ready to decide/i })).not.toBeInTheDocument();
  });

  it('says a decision is with an admin and not yet sent', async () => {
    global.fetch = talk(() => [toSeller({ awaiting_reply: false }), sellerReply({ is_read: true })]);
    render(wrap(<MessageThread disputeId="D-1" disputeStatus="PENDING_ADMIN_REVIEW" onTakeAction={vi.fn()} />));
    expect(await screen.findByRole('status')).toHaveTextContent('Waiting for an admin');
    expect(screen.queryByRole('button', { name: /Ready to decide/i })).not.toBeInTheDocument();
  });

  it('puts PayPal on the right and the party on the left in each chat', async () => {
    global.fetch = talk(() => [toSeller({ awaiting_reply: false }), sellerReply({ is_read: true }), toBuyer()]);
    render(wrap(<MessageThread disputeId="D-1" disputeStatus="WAITING_FOR_BUYER_RESPONSE" />));
    const seller = await screen.findByLabelText('Seller conversation');
    const row = (chat: HTMLElement, text: string) => within(chat).getByText(text).closest('li') as HTMLElement;
    expect(row(seller, 'Evidence needed for dispute D-1')).toHaveClass('justify-end');   // PayPal's request: right
    expect(row(seller, 'Re: Evidence needed for dispute D-1')).toHaveClass('justify-start'); // the seller's reply: left
    expect(row(screen.getByLabelText('Buyer conversation'), 'We need more information about your dispute D-1')).toHaveClass('justify-end');
    expect(within(screen.getByLabelText('Buyer conversation')).getByText(/Waiting for the/).closest('li')).toHaveClass('justify-start');
  });

  it('marks new replies read and highlights them as New', async () => {
    const calls: string[] = [];
    global.fetch = talk(() => [toSeller({ awaiting_reply: false }), sellerReply()], (url) => { calls.push(url); return url.endsWith('/messages/read') ? ok({ marked_read: 1 }) : undefined; });
    render(wrap(<MessageThread disputeId="D-1" disputeStatus="UNDER_REVIEW" />));
    expect(await screen.findByText('New')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((u) => u.endsWith('/messages/read'))).toBe(true));
  });

  it("is honest that real replies aren't synced", async () => {
    global.fetch = talk(() => [toSeller({ source: 'paypal_sandbox', reply_due_at: null })], undefined, detail({ source: 'paypal_sandbox' }));
    render(wrap(<MessageThread disputeId="D-1" />));
    expect(await screen.findByText(/aren't synced into this app yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Simulate/i })).not.toBeInTheDocument();
  });

  it('explains the empty state', async () => {
    global.fetch = vi.fn().mockImplementation(() => ok([])) as any;
    render(wrap(<MessageThread disputeId="D-1" />));
    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
  });

  describe('settled and withdrawn', () => {
    const declared: any[] = [];
    const run = (disp = detail()) => {
      declared.length = 0;
      global.fetch = talk(() => [toSeller(), toBuyer()], (url, init) => {
        if (url.includes('/parties/')) { declared.push({ url, body: JSON.parse(init!.body as string) }); return ok(sellerReply()); }
        return undefined;
      }, disp);
      render(wrap(<MessageThread disputeId="D-1" disputeStatus="WAITING_FOR_BOTH_RESPONSES" />));
    };

    it('records that the seller says settled, and says it is NOT settled until the buyer agrees', async () => {
      run(detail({ seller_settled_at: '2026-01-02T10:00:00' }));
      const status = await screen.findByRole('status');
      expect(status).toHaveTextContent('The seller says this was settled outside PayPal');
      expect(status).toHaveTextContent('not settled until the buyer confirms too');
      expect(within(screen.getByLabelText('Seller chat')).getByText("Says it's settled")).toBeInTheDocument();
      expect(within(screen.getByLabelText('Buyer chat')).queryByText("Says it's settled")).not.toBeInTheDocument();
      // The seller has already said it, so they can't say it twice.
      expect(within(screen.getByLabelText('Demo controls for the seller')).getByRole('button', { name: /Seller says settled/ })).toBeDisabled();
    });

    it('lets the demo play each side saying settled, and only the buyer withdrawing', async () => {
      run();
      fireEvent.click(await screen.findByRole('button', { name: /Seller says settled/ }));
      await waitFor(() => expect(declared).toHaveLength(1));
      expect(declared[0].url).toMatch(/\/parties\/SELLER\/declare$/);
      expect(declared[0].body).toEqual({ kind: 'SETTLED' });
      fireEvent.click(screen.getByRole('button', { name: /Buyer withdraws claim/ }));
      await waitFor(() => expect(declared).toHaveLength(2));
      expect(declared[1].url).toMatch(/\/parties\/BUYER\/declare$/);
      expect(declared[1].body).toEqual({ kind: 'WITHDRAWN' });
      expect(within(screen.getByLabelText('Demo controls for the seller')).queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
    });

    it('says how a settled or dismissed case ended', async () => {
      global.fetch = talk(() => [toSeller({ awaiting_reply: false })]);
      const { unmount } = render(wrap(<MessageThread disputeId="D-1" disputeStatus="CLOSED" outcome="SETTLED" />));
      expect(await screen.findByRole('status')).toHaveTextContent('Settled outside PayPal.');
      unmount();
      render(wrap(<MessageThread disputeId="D-1" disputeStatus="CLOSED" outcome="DISMISSED" />));
      expect(await screen.findByRole('status')).toHaveTextContent('Dismissed, buyer withdrew.');
    });
  });
});

describe('Messages workspace', () => {
  const threads = [
    thread({ dispute_id: 'D-1', state: 'WAITING', waiting_on: 'Seller and buyer' }),
    thread({ dispute_id: 'D-2', state: 'YOUR_TURN', waiting_on: null, unread_count: 1, dispute_status: 'UNDER_REVIEW', last_direction: 'INBOUND', last_message_preview: 'Thank you.', pending_message_ids: [] }),
    thread({ dispute_id: 'D-3', state: 'CLOSED', waiting_on: null, dispute_status: 'RESOLVED', outcome: 'BUYER_FAVOR', pending_message_ids: [] }),
    thread({ dispute_id: 'D-4', state: 'IN_REVIEW', waiting_on: null, dispute_status: 'PENDING_ADMIN_REVIEW', pending_message_ids: [] }),
    thread({ dispute_id: 'D-5', state: 'CLOSED', waiting_on: null, dispute_status: 'CLOSED', outcome: 'SETTLED', pending_message_ids: [] }),
  ];
  const api = () => vi.fn().mockImplementation((url: string) => {
    if (url.includes('/message-threads')) return ok(threads);
    if (url.endsWith('/evidence-requests/options')) return ok({ seller: [], buyer: [] });
    if (url.endsWith('/evidence-summary')) return ok(emptySummary);
    if (url.endsWith('/messages')) return ok([toSeller()]);
    if (/\/api\/disputes\/D-\d$/.test(url)) return ok(detail());
    return ok({ marked_read: 0 });
  }) as any;

  it('opens on the list of every case you have messaged, not on one conversation', async () => {
    global.fetch = api();
    render(wrap(<MessagesPage />, '/messages'));
    const list = await screen.findByLabelText('Conversations');
    expect(within(list).getAllByRole('button')).toHaveLength(5);
    expect(within(list).getByText('Waiting on seller and buyer')).toBeInTheDocument();
    expect(within(list).getByText('Ready to decide')).toBeInTheDocument();
    expect(within(list).getByText('With admin')).toBeInTheDocument();
    expect(within(list).getByText("Decided: buyer's favor")).toBeInTheDocument();
    expect(within(list).getByText('Settled outside PayPal')).toBeInTheDocument();
    expect(within(list).getByLabelText('1 unread')).toBeInTheDocument();
    // No conversation is open until you pick one.
    expect(screen.queryByLabelText('Seller conversation')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Buyer conversation')).not.toBeInTheDocument();
  });

  it('filters the list by who we are waiting on and which cases are ready to decide', async () => {
    global.fetch = api();
    render(wrap(<MessagesPage />, '/messages'));
    await screen.findByLabelText('Conversations');
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

  it('picking a case shows the seller and the buyer side by side, and the way back to the list', async () => {
    global.fetch = api();
    render(wrap(<MessagesPage />, '/messages'));
    fireEvent.click(within(await screen.findByLabelText('Conversations')).getByText('D-2'));
    expect(await screen.findByRole('heading', { name: 'D-2' })).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent('/messages?case=D-2');
    expect(await screen.findByLabelText('Seller conversation')).toBeInTheDocument();
    expect(screen.getByLabelText('Buyer conversation')).toBeInTheDocument();
    expect(screen.queryByLabelText('Conversations')).not.toBeInTheDocument(); // the list is replaced, not squeezed beside it

    fireEvent.click(screen.getByRole('button', { name: /All conversations/i }));
    expect(await screen.findByLabelText('Conversations')).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent('/messages');
  });

  it('opens straight into a conversation from a link, and can jump to the case', async () => {
    global.fetch = api();
    render(wrap(<MessagesPage />, '/messages?case=D-2'));
    expect(await screen.findByRole('heading', { name: 'D-2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open case/i }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/investigate/D-2'));
  });

  it('lets PayPal take action right here, but not on a decided case or one with an admin', async () => {
    global.fetch = api();
    render(wrap(<MessagesPage />, '/messages?case=D-1'));
    fireEvent.click(await screen.findByRole('button', { name: /^Take action$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Ask for evidence')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Ready to decide' })).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent('/messages?case=D-1'); // never left the page
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    for (const id of ['D-3', 'D-4']) {
      fireEvent.click(screen.getByRole('button', { name: /All conversations/i }));
      fireEvent.click(within(await screen.findByLabelText('Conversations')).getByText(id));
      await screen.findByRole('heading', { name: id });
      expect(screen.queryByRole('button', { name: /^Take action$/i })).not.toBeInTheDocument();
    }
  });

  it('explains what to do when nothing has been sent', async () => {
    global.fetch = vi.fn().mockImplementation(() => ok([])) as any;
    render(wrap(<MessagesPage />, '/messages'));
    expect(await screen.findByText('Nothing sent yet')).toBeInTheDocument();
  });
});
