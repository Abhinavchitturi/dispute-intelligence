import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessageThread } from '../components/MessageThread';
import { ToastProvider } from '../components/ui/kit';

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const fail = (detail: string) => Promise.resolve({ ok: false, status: 400, statusText: 'Bad', json: () => Promise.resolve({ detail }) });
const base = { dispute_id: 'D-1', subject: 'Evidence needed for dispute D-1', body: 'Please send these.', source: 'synthetic', awaiting_reply: false, reply_due_at: null as string | null, in_reply_to: null as string | null,
  is_read: true, requested_evidence: [] as string[], provided_evidence: [] as string[], unavailable_evidence: [] as string[], deadline: null as string | null, emailed_to: null as string | null,
  email_status: null as string | null, needs_recording: false, attachments: [] as string[], created_at: '2026-01-01T10:00:00' };
const ask = (over = {}): any => ({ ...base, id: 'MSG-Q', direction: 'OUTBOUND', counterparty: 'SELLER', action_type: 'REQUEST_SELLER_EVIDENCE', awaiting_reply: true,
  requested_evidence: ['PROOF_OF_DELIVERY_SIGNATURE', 'ADDRESS_VERIFICATION'], emailed_to: 'techstore@sellers.example', email_status: 'QUEUED', ...over });
const emailReply = (over = {}): any => ({ ...base, id: 'MSG-R', direction: 'INBOUND', counterparty: 'SELLER', action_type: 'REQUEST_SELLER_EVIDENCE', subject: 'Re: [D-1] Evidence request',
  body: 'Signature attached.', source: 'email', in_reply_to: 'MSG-Q', is_read: false, needs_recording: true, attachments: ['signature.pdf', 'scan.jpg'], created_at: '2026-01-01T11:00:00', ...over });

const dispute = { id: 'D-1', source: 'synthetic', status: 'WAITING_FOR_SELLER_RESPONSE', merchant_reference: 'TechStore', buyer_reference: 'Alex', seller_settled_at: null, buyer_settled_at: null, evidence_items: [], claim_points: [] };
const calls: { url: string; body?: any }[] = [];
const api = (messages: () => any[], recordResult: () => Promise<any> = () => ok({ ...emailReply({ needs_recording: false }), provided_evidence: ['PROOF_OF_DELIVERY_SIGNATURE'], unavailable_evidence: ['ADDRESS_VERIFICATION'] })) => {
  calls.length = 0;
  global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (url.includes('/replies/') && url.endsWith('/record')) return recordResult();
    if (url.endsWith('/inbound/simulate')) return ok({ reply_recorded_for: 'D-1' });
    if (url.endsWith('/messages/read')) return ok({ marked_read: 0 });
    if (url.endsWith('/evidence-summary')) return ok({ seller: [], buyer: [], records: [] });
    if (url.endsWith('/messages')) return ok(messages());
    if (/\/api\/disputes\/D-\d$/.test(url)) return ok(dispute);
    return ok([]);
  }) as any;
};
const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MemoryRouter><MessageThread disputeId="D-1" disputeStatus="WAITING_FOR_SELLER_RESPONSE" /></MemoryRouter></ToastProvider>
  </QueryClientProvider>,
);

describe('Reaching sellers and buyers, who are not on this app', () => {
  it('says plainly that they are emailed, when nothing has been sent yet', async () => {
    api(() => [ask({ counterparty: 'SELLER' })].map((m) => ({ ...m, counterparty: 'SELLER' })));
    mount();
    const buyer = await screen.findByLabelText('Buyer conversation');
    expect(buyer).toHaveTextContent('Nothing sent to the buyer yet.');
    expect(buyer).toHaveTextContent("The buyer isn't on this app. Requests go to them by email, and their replies come back here.");
  });

  it('shows who a request was emailed to, and says so when it was only kept here', async () => {
    api(() => [ask()]);
    mount();
    const seller = await screen.findByLabelText('Seller conversation');
    expect(within(seller).getByText('techstore@sellers.example')).toBeInTheDocument();
    expect(within(seller).getByText('Kept here, not sent')).toBeInTheDocument();
    expect(within(seller).getByText(/Waiting for the/)).toHaveTextContent('Waiting for the seller to reply');
  });

  it('shows a sent email, and a failed one', async () => {
    api(() => [ask({ email_status: 'SENT' })]);
    const { unmount } = mount();
    expect(await screen.findByText('Sent')).toBeInTheDocument();
    unmount();
    api(() => [ask({ email_status: 'FAILED' })]);
    mount();
    expect(await screen.findByText('Email failed')).toBeInTheDocument();
  });

  it('an emailed reply shows as an email, with its attachments, and asks what really came', async () => {
    api(() => [ask(), emailReply()]);
    mount();
    const seller = await screen.findByLabelText('Seller conversation');
    expect(within(seller).getByText('Email reply')).toBeInTheDocument();
    expect(within(seller).getByText('signature.pdf')).toBeInTheDocument();
    expect(within(seller).getByText('scan.jpg')).toBeInTheDocument();
    const panel = within(seller).getByLabelText('Record what they sent');
    // It lists what was asked for, nothing is ticked, and the button says so.
    expect(within(panel).getByRole('checkbox', { name: 'Proof of delivery signature' })).not.toBeChecked();
    expect(within(panel).getByRole('checkbox', { name: 'Address verification' })).not.toBeChecked();
    expect(within(panel).getByRole('button', { name: 'Record: nothing came' })).toBeEnabled();
  });

  it('recording sends only what was ticked, with the file name', async () => {
    api(() => [ask(), emailReply()]);
    mount();
    const panel = await screen.findByLabelText('Record what they sent');
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Proof of delivery signature' }));
    fireEvent.change(within(panel).getByLabelText('File for Proof of delivery signature'), { target: { value: 'signature.pdf' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Record 1 of 2' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/replies/MSG-R/record'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/record'))!.body).toEqual({ provided: [{ evidence_type: 'PROOF_OF_DELIVERY_SIGNATURE', file_name: 'signature.pdf' }], note: undefined });
    expect(await screen.findByText('Recorded 1 of 2 items.')).toBeInTheDocument();
  });

  it('suggests the attachment names, so the right file name is a click away', async () => {
    api(() => [ask(), emailReply()]);
    mount();
    const panel = await screen.findByLabelText('Record what they sent');
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Address verification' }));
    const input = within(panel).getByLabelText('File for Address verification');
    const list = document.getElementById(input.getAttribute('list')!)!;
    expect([...list.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['signature.pdf', 'scan.jpg']);
  });

  it("shows the server's reason when recording fails, and keeps what was ticked", async () => {
    api(() => [ask(), emailReply()], () => fail('This reply has already been gone through.'));
    mount();
    const panel = await screen.findByLabelText('Record what they sent');
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Address verification' }));
    fireEvent.click(within(panel).getByRole('button', { name: /^Record/ }));
    expect(await screen.findByText('This reply has already been gone through.')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Record what they sent')).getByRole('checkbox', { name: 'Address verification' })).toBeChecked();
  });

  it('a reply that is already recorded shows what was received and what was not, with no form', async () => {
    api(() => [ask({ awaiting_reply: false }), emailReply({ needs_recording: false, is_read: true, provided_evidence: ['PROOF_OF_DELIVERY_SIGNATURE'], unavailable_evidence: ['ADDRESS_VERIFICATION'] })]);
    mount();
    const seller = await screen.findByLabelText('Seller conversation');
    expect(within(seller).getByText('✓ Proof of delivery signature')).toBeInTheDocument();
    expect(within(seller).getByText(/Couldn't provide: address verification/)).toBeInTheDocument();
    expect(within(seller).queryByLabelText('Record what they sent')).not.toBeInTheDocument();
  });

  it('in the demo, can send an email reply in the real way', async () => {
    api(() => [ask()]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Simulate seller email reply' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/inbound/simulate'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/inbound/simulate'))!.body).toMatchObject({ party: 'SELLER', attachments: ['documents.pdf'] });
  });
});
