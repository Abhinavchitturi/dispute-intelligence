import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisputeQueuePage } from '../pages/DisputeQueuePage';
import { MessagesPage } from '../pages/MessagesPage';
import { MessageThread } from '../components/MessageThread';
import { ToastProvider } from '../components/ui/kit';
import { statusMeta } from '../lib/format';

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const wrap = (ui: React.ReactElement, route = '/') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MemoryRouter initialEntries={[route]}><Routes><Route path="*" element={ui} /></Routes></MemoryRouter></ToastProvider>
  </QueryClientProvider>,
);
const d = (over: Record<string, unknown>): any => ({ id: 'D-X', source: 'synthetic', status: 'OPEN', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', outcome: null, amount: 100, currency: 'USD', response_due_date: null, created_at: null,
  priority_score: 30, priority_factors: [], evidence_status: 'PARTIAL', buyer_claim: 'x', buyer_reference: 'Alex', merchant_reference: 'Shop', transaction_id: 'T', assigned_to: 'Susmitha', is_high_profile: false, ai_owned: false, ...over });

describe('In progress: some evidence is in, but not from both sides', () => {
  it('has its own label', () => {
    expect(statusMeta('IN_PROGRESS').label).toBe('In progress');
    expect(statusMeta('UNDER_REVIEW').label).toBe('Ready to decide');
  });

  it('the Disputes page has an In progress tab that is separate from Ready to decide', async () => {
    global.fetch = vi.fn().mockImplementation(() => ok([d({ id: 'D-NEW' }), d({ id: 'D-HALF', status: 'IN_PROGRESS' }), d({ id: 'D-READY', status: 'UNDER_REVIEW' }), d({ id: 'D-WAIT', status: 'WAITING_FOR_BUYER_RESPONSE' })])) as any;
    wrap(<DisputeQueuePage />, '/queue?view=progress');
    expect(await screen.findByText('D-HALF')).toBeInTheDocument();
    expect(screen.queryByText('D-READY')).not.toBeInTheDocument();      // one side answering doesn't make it ready
    expect(screen.queryByText('D-NEW')).not.toBeInTheDocument();
    expect(screen.queryByText('D-WAIT')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /In progress/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Ready to decide/ })).toHaveTextContent('1');
  });

  it('Ready to decide lists only cases where both sides have answered', async () => {
    global.fetch = vi.fn().mockImplementation(() => ok([d({ id: 'D-HALF', status: 'IN_PROGRESS' }), d({ id: 'D-READY', status: 'UNDER_REVIEW' })])) as any;
    wrap(<DisputeQueuePage />, '/queue?view=ready');
    expect(await screen.findByText('D-READY')).toBeInTheDocument();
    expect(screen.queryByText('D-HALF')).not.toBeInTheDocument();
  });

  const msg = (over: Record<string, unknown>): any => ({ dispute_id: 'D-1', subject: 's', body: 'b', source: 'synthetic', awaiting_reply: false, reply_due_at: null, in_reply_to: null, is_read: true, requested_evidence: [], provided_evidence: [],
    unavailable_evidence: [], deadline: null, emailed_to: null, email_status: null, needs_recording: false, attachments: [], created_at: '2026-01-01T10:00:00', ...over });
  const messages = [msg({ id: 'Q', direction: 'OUTBOUND', counterparty: 'SELLER', action_type: 'REQUEST_SELLER_EVIDENCE' }), msg({ id: 'R', direction: 'INBOUND', counterparty: 'SELLER', in_reply_to: 'Q', created_at: '2026-01-01T11:00:00' })];

  it("the conversation does not say it is time to decide just because the last message came from the seller", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => ok(url.endsWith('/messages') ? messages : url.endsWith('/evidence-summary') ? { seller: [], buyer: [], records: [] } : url.endsWith('/messages/read') ? { marked_read: 0 } : [])) as any;
    wrap(<MessageThread disputeId="D-1" disputeStatus="IN_PROGRESS" onTakeAction={() => undefined} />);
    await screen.findByLabelText('Seller conversation');
    expect(screen.queryByText(/The evidence is in/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ready to decide' })).not.toBeInTheDocument();
  });

  it('it says so, with both sides answered, once the case is ready', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => ok(url.endsWith('/messages') ? messages : url.endsWith('/evidence-summary') ? { seller: [], buyer: [], records: [] } : url.endsWith('/messages/read') ? { marked_read: 0 } : [])) as any;
    wrap(<MessageThread disputeId="D-1" disputeStatus="UNDER_REVIEW" onTakeAction={() => undefined} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Both sides have answered');
    expect(screen.getByRole('button', { name: 'Ready to decide' })).toBeInTheDocument();
  });

  it('the Messages list shows an In progress badge', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => ok(url.includes('/message-threads') ? [{ dispute_id: 'D-1', buyer_reference: 'Alex', merchant_reference: 'Shop', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', amount: 5, currency: 'USD',
      dispute_status: 'IN_PROGRESS', state: 'IN_PROGRESS', waiting_on: null, last_message_preview: 'hi', last_message_at: '2026-01-01T10:00:00', last_direction: 'INBOUND', unread_count: 0, message_count: 2, awaiting_since: null,
      expected_reply_at: null, simulated: true, pending_message_ids: [], outcome: null }] : [])) as any;
    wrap(<MessagesPage />, '/messages');
    const list = await screen.findByLabelText('Conversations');
    expect(within(list).getByText('In progress')).toBeInTheDocument();
    expect(within(list).queryByText('Ready to decide')).not.toBeInTheDocument();
  });
});
