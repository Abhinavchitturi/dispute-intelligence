import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PriorityBadge, StatusBadge, EvidenceBadge, SourceBadge } from '../components/ui/StatusBadges';

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
    render(<StatusBadge status="WAITING_FOR_SELLER_RESPONSE" />);
    expect(screen.getByText(/Action Needed: Seller/i)).toBeInTheDocument();

    render(<StatusBadge status="RESOLVED" />);
    expect(screen.getByText(/RESOLVED/i)).toBeInTheDocument();
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
