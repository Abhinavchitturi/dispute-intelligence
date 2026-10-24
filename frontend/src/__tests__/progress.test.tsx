import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { computeProgress, InvestigationProgress } from '../components/InvestigationProgress';
import { PriorityScoresPage } from '../pages/PriorityScoresPage';
import { InvestigationLanding } from '../pages/InvestigationLanding';

const msg = (over: Record<string, unknown> = {}): any => ({
  id: 'M', dispute_id: 'D', direction: 'OUTBOUND', counterparty: 'SELLER', action_type: 'REQUEST_SELLER_EVIDENCE', subject: 's', body: 'b', source: 'synthetic',
  awaiting_reply: true, reply_due_at: null, in_reply_to: null, is_read: true, requested_evidence: [], provided_evidence: [], unavailable_evidence: [], deadline: null,
  created_at: '2026-01-01T10:00:00', ...over,
});
const reply = (over = {}) => msg({ id: 'R', direction: 'INBOUND', awaiting_reply: false, in_reply_to: 'M', ...over });
const doc = (over: Record<string, unknown> = {}) => ({ id: 'EV', evidence_type: 'APPRAISAL_LETTER', availability_status: 'AVAILABLE', ...over });
const dispute = (over: Record<string, unknown> = {}): any => ({ id: 'D', status: 'OPEN', outcome: null, evidence_status: 'MISSING', evidence_items: [], ...over });

describe('computeProgress (PayPal investigating a dispute)', () => {
  it('a new case with missing evidence is blocked on asking for it', () => {
    const p = computeProgress(dispute(), []);
    expect(p.steps.map((s) => s.state)).toEqual(['done', 'current', 'todo', 'todo']);
    expect(p.steps[1].blocked).toBe(true);
    expect(p.percent).toBe(25);
    expect(p.next).toMatch(/ask the seller and the buyer/i);
  });

  it('one concrete document on file is enough: the case is not blocked, and the next step says it can be decided', () => {
    const one = computeProgress(dispute({ evidence_status: 'CONFLICTING', evidence_items: [doc()] }), []);
    expect(one.steps[1].blocked).toBeFalsy();
    expect(one.next).toBe('Next: decide with the evidence on file, or ask for more.');

    const several = computeProgress(dispute({ evidence_items: [doc(), doc({ id: 'EV2' }), doc({ id: 'EV3', availability_status: 'MISSING' })] }), []);
    expect(several.next).toBe('Next: decide with the 2 pieces of evidence on file, or ask for more.'); // only AVAILABLE items count

    // Nothing on file at all is still blocked, and still tells you to ask.
    const none = computeProgress(dispute({ evidence_items: [doc({ availability_status: 'MISSING' })] }), []);
    expect(none.steps[1].blocked).toBe(true);
    expect(none.next).toMatch(/ask the seller and the buyer/i);
  });

  it('waiting on one party shows who, and half credit once some replies are in', () => {
    const waitingSeller = computeProgress(dispute({ status: 'WAITING_FOR_SELLER_RESPONSE' }), [msg()]);
    expect(waitingSeller.steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'todo']);
    expect(waitingSeller.steps[2].detail).toBe('Waiting on the seller');
    expect(waitingSeller.percent).toBe(50);

    const half = computeProgress(dispute({ status: 'WAITING_FOR_BUYER_RESPONSE' }), [
      msg({ id: 'M1', awaiting_reply: false }), reply({ id: 'R1' }), msg({ id: 'M2', counterparty: 'BUYER', action_type: 'REQUEST_BUYER_EVIDENCE' }),
    ]);
    expect(half.steps[2].detail).toBe('Waiting on the buyer');
    expect(half.percent).toBe(Math.round(((2 + 0.5) / 4) * 100));
  });

  it('names both parties when both owe a reply', () => {
    const p = computeProgress(dispute({ status: 'WAITING_FOR_BOTH_RESPONSES' }), [
      msg({ id: 'A' }), msg({ id: 'B', counterparty: 'BUYER', action_type: 'REQUEST_BUYER_EVIDENCE' }),
    ]);
    expect(p.steps[2].detail).toBe('Waiting on the seller and the buyer');
    expect(p.next).toMatch(/seller and the buyer to reply/);
  });

  it('is ready to decide once every request is answered', () => {
    const p = computeProgress(dispute({ status: 'UNDER_REVIEW' }), [msg({ awaiting_reply: false }), reply()]);
    expect(p.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'current']);
    expect(p.percent).toBe(75);
    expect(p.next).toMatch(/review the evidence and decide/i);
  });

  it('a decided case is 100% and says which way it went', () => {
    const p = computeProgress(dispute({ status: 'RESOLVED', outcome: 'SELLER_FAVOR' }), [msg({ awaiting_reply: false }), reply()]);
    expect(p.percent).toBe(100);
    expect(p.steps[3].detail).toBe("In the seller's favor");
    expect(p.next).toBe("Decided in the seller's favor.");
  });

  it('a case that arrives already decided, with nobody ever asked, is still fully complete', () => {
    const p = computeProgress(dispute({ status: 'CLOSED', outcome: 'BUYER_FAVOR' }), []);
    expect(p.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done']); // no step left "current"
    expect(p.percent).toBe(100);
    expect(p.steps[1].detail).toBe('Decided from the records'); // not "Nobody asked yet"
    expect(p.steps[2].detail).toBe('None needed');
    expect(p.next).toBe("Decided in the buyer's favor.");
  });

  it('renders the bar with its stages', () => {
    render(<InvestigationProgress dispute={dispute({ status: 'WAITING_FOR_SELLER_RESPONSE' })} messages={[msg()]} />);
    const card = screen.getByLabelText('Investigation progress');
    for (const label of ['Case filed', 'Evidence requested', 'Evidence received', 'Decision made']) expect(within(card).getByText(label)).toBeInTheDocument();
    expect(within(card).getByText('50%')).toBeInTheDocument();
  });
});

const disputes = [
  { id: 'DEMO-DSP-1', status: 'OPEN', reason: 'UNAUTHORISED', amount: 100, currency: 'USD', response_due_date: null, priority_score: 85,
    priority_factors: [{ name: 'Urgency', weight: 35, contribution: 30, explanation: 'Due soon' }, { name: 'Exposure', weight: 20, contribution: 10, explanation: 'Large amount' }] },
  { id: 'DEMO-DSP-2', status: 'UNDER_REVIEW', reason: 'UNAUTHORISED', amount: 50, currency: 'USD', response_due_date: null, priority_score: 20,
    priority_factors: [{ name: 'Urgency', weight: 35, contribution: 5, explanation: 'Plenty of time' }] },
  { id: 'DEMO-DSP-3', status: 'RESOLVED', reason: 'UNAUTHORISED', amount: 50, currency: 'USD', response_due_date: null, priority_score: 90, priority_factors: [] },
];
const wrap = (ui: React.ReactElement, route = '/') => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></QueryClientProvider>
);

describe('Priority scores page', () => {
  it('ranks open disputes only, filters by band and expands the factor breakdown', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(disputes) }) as any;
    render(wrap(<PriorityScoresPage />));
    await waitFor(() => expect(screen.getByText('DEMO-DSP-1')).toBeInTheDocument());
    expect(screen.queryByText('DEMO-DSP-3')).not.toBeInTheDocument(); // decided disputes are excluded

    fireEvent.click(screen.getByRole('tab', { name: /Low/ }));
    await waitFor(() => expect(screen.queryByText('DEMO-DSP-1')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: /All open/ }));
    fireEvent.click(screen.getByText('DEMO-DSP-1'));
    await waitFor(() => expect(screen.getByText('Due soon')).toBeInTheDocument());
  });
});

describe('Investigation link', () => {
  function CasePage() { const { id } = useParams(); return <div>case page for {id}</div>; }
  const landing = () => render(wrap(<Routes><Route path="/" element={<InvestigationLanding />} /><Route path="/investigate/:id" element={<CasePage />} /></Routes>));
  const KEY = 'resolveiq.lastCase';
  const serve = () => { global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(disputes) }) as any; };

  it('with nothing opened yet, goes to the most urgent open dispute', async () => {
    window.localStorage.removeItem(KEY);
    serve(); landing();
    await waitFor(() => expect(screen.getByText('case page for DEMO-DSP-1')).toBeInTheDocument());
  });

  it('goes back to the case you were last on, not always the same one', async () => {
    window.localStorage.setItem(KEY, 'DEMO-DSP-2'); // a lower-priority case than DEMO-DSP-1
    serve(); landing();
    await waitFor(() => expect(screen.getByText('case page for DEMO-DSP-2')).toBeInTheDocument());
  });

  it('can return to a decided case too', async () => {
    window.localStorage.setItem(KEY, 'DEMO-DSP-3');
    serve(); landing();
    await waitFor(() => expect(screen.getByText('case page for DEMO-DSP-3')).toBeInTheDocument());
  });

  it('ignores a remembered case that no longer exists', async () => {
    window.localStorage.setItem(KEY, 'DEMO-DSP-GONE');
    serve(); landing();
    await waitFor(() => expect(screen.getByText('case page for DEMO-DSP-1')).toBeInTheDocument());
  });
});
