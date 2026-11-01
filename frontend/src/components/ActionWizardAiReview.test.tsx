import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActionWizard } from './ActionWizard';
import * as client from '../api/client';

vi.mock('../lib/user', () => ({
  useCurrentUser: () => ({ user: { name: 'Test Investigator', role: 'INVESTIGATOR' }, isManager: false }),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual('../api/client');
  return {
    ...actual,
    fetchDisputeDetail: vi.fn().mockResolvedValue({
      id: 'DEMO-DSP-1042',
      status: 'UNDER_REVIEW',
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      evidence_items: [],
      claim_points: [],
    }),
    draftActionMessage: vi.fn().mockResolvedValue({
      action_type: 'DECIDE_FOR_BUYER',
      body: 'Test draft body',
      subject: 'Dispute Decision',
      cited_record_ids: [],
      evidence_balance: { toward_buyer: ['Tracking missing geocode'], toward_seller: ['Carrier scan delivered'], other: [] },
    }),
    requestAiReview: vi.fn().mockResolvedValue({
      ai_verdict: 'DISAGREES',
      ai_decision: 'FULFILL_BUYER',
      reasoning: 'Carrier coordinates do not match the order address.',
      key_evidence: {
        supporting_evidence: ['Carrier telemetry records mismatch in delivery address coordinates.'],
        contradicting_evidence: ['Seller generated dispatch label.'],
      },
      investigator_comparison: "The investigator decided in Seller's favor, overlooking misdelivery.",
      evidence_gaps: 'No carrier re-route proof provided.',
      verdict: 'DISAGREE',
      agrees: false,
      assessment: "Disagrees with Seller's favor: Lack of delivery proof",
      explanation: 'Carrier coordinates do not match the order address.',
      model: 'gpt-4o-mini',
      provider: 'openai',
    }),
    submitDecision: vi.fn().mockResolvedValue({
      success: true,
      message: 'Decision submitted',
    }),
  };
});

describe('ActionWizard AI Review in Decision Popup', () => {
  const renderWizard = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <ActionWizard
          open={true}
          onClose={vi.fn()}
          disputeId="DEMO-DSP-1042"
          onJumpToRecord={vi.fn()}
          onDone={vi.fn()}
        />
      </QueryClientProvider>
    );
  };

  it('renders Ready for Review when clicking Ready to decide and displays AI Review button', async () => {
    renderWizard();

    // Click "Ready to decide" to enter the decision popup
    const readyBtn = await screen.findByText('Ready to decide');
    fireEvent.click(readyBtn);

    // Modal title becomes "Ready for Review"
    expect(await screen.findByRole('heading', { name: 'Ready for Review' })).toBeInTheDocument();

    // Decision options are rendered
    expect(screen.getByRole('radio', { name: /Buyer's favor/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Seller's favor/i })).toBeInTheDocument();

    // AI Review button is present
    const aiReviewBtn = screen.getByRole('button', { name: /AI Review/i });
    expect(aiReviewBtn).toBeInTheDocument();
    // Initially disabled before selecting decision and typing reasoning
    expect(aiReviewBtn).toBeDisabled();
  });

  it('enables AI Review button and shows independent assessment on click', async () => {
    renderWizard();

    const readyBtn = await screen.findByText('Ready to decide');
    fireEvent.click(readyBtn);

    // Select Seller's favor
    const sellerRadio = screen.getByRole('radio', { name: /Seller's favor/i });
    fireEvent.click(sellerRadio);

    // Type reasoning
    const reasonInput = screen.getByLabelText(/Reason for your decision/i);
    fireEvent.change(reasonInput, { target: { value: 'Carrier marked item delivered.' } });

    // AI Review button is now enabled
    const aiReviewBtn = screen.getByRole('button', { name: /AI Review/i });
    expect(aiReviewBtn).not.toBeDisabled();

    // Click AI Review
    fireEvent.click(aiReviewBtn);

    // AI Assessment card is displayed inside the popup
    await waitFor(() => {
      expect(screen.getByText('1. AI Verdict:')).toBeInTheDocument();
    });
    expect(screen.getByText('DISAGREES')).toBeInTheDocument();
    expect(screen.getByText('FULFILL_BUYER')).toBeInTheDocument();
    expect(screen.getByText('Carrier coordinates do not match the order address.')).toBeInTheDocument();
    expect(screen.getByText(/4\. Key Evidence:/i)).toBeInTheDocument();
    expect(screen.getByText('Carrier telemetry records mismatch in delivery address coordinates.')).toBeInTheDocument();
    expect(screen.getByText(/5\. Investigator Decision Comparison:/i)).toBeInTheDocument();
    expect(screen.getByText(/6\. Evidence Gaps:/i)).toBeInTheDocument();
  });
});
