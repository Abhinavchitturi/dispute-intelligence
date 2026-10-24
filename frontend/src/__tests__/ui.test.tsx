import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PriorityBadge, StatusBadge, EvidenceBadge, SourceBadge, OutcomeBadge } from '../components/ui/StatusBadges';

describe('Fintech Status Badges', () => {
  it('renders critical priority badge for score >= 70', () => {
    render(<PriorityBadge score={85.5} />);
    expect(screen.getByText(/86 • CRITICAL/i)).toBeInTheDocument();
  });

  it('renders medium priority badge for score 40-69', () => {
    render(<PriorityBadge score={55} />);
    expect(screen.getByText(/55 • MEDIUM/i)).toBeInTheDocument();
  });

  it('renders standard priority badge for score < 40', () => {
    render(<PriorityBadge score={25} />);
    expect(screen.getByText(/25 • LOW/i)).toBeInTheDocument();
  });

  it('renders status badges with human-readable labels', () => {
    // Statuses are PayPal's view of a case: who we're waiting on, or whose move it is.
    const labels: Record<string, string> = {
      OPEN: 'New', WAITING_FOR_SELLER_RESPONSE: 'Waiting on seller', WAITING_FOR_BUYER_RESPONSE: 'Waiting on buyer',
      WAITING_FOR_BOTH_RESPONSES: 'Waiting on both', UNDER_REVIEW: 'Ready to decide', RESOLVED: 'Resolved', CLOSED: 'Closed',
    };
    for (const [status, label] of Object.entries(labels)) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders the outcome of a decided case, and nothing for an open one', () => {
    const { unmount } = render(<OutcomeBadge outcome="BUYER_FAVOR" />);
    expect(screen.getByText("Decided: buyer's favor")).toBeInTheDocument();
    unmount();
    render(<OutcomeBadge outcome="SELLER_FAVOR" />);
    expect(screen.getByText("Decided: seller's favor")).toBeInTheDocument();
    const empty = render(<OutcomeBadge outcome={null} />);
    expect(empty.container).toBeEmptyDOMElement();
  });

  it('renders evidence completeness states correctly', () => {
    render(<EvidenceBadge status="CONFLICTING" />);
    expect(screen.getByText(/CONFLICTING/i)).toBeInTheDocument();

    render(<EvidenceBadge status="MISSING" />);
    expect(screen.getByText(/MISSING/i)).toBeInTheDocument();
  });

  it('renders demo mode badge vs sandbox badge', () => {
    const { rerender } = render(<SourceBadge source="synthetic" />);
    expect(screen.getByText(/SYNTHETIC DEMO/i)).toBeInTheDocument();

    rerender(<SourceBadge source="paypal_sandbox" />);
    expect(screen.getByText(/PAYPAL SANDBOX/i)).toBeInTheDocument();
  });
});
