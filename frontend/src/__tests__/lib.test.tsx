import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { priorityMeta, reasonLabel, timeLeft, timeAgo, money, prettifyCodes } from '../lib/format';
import { Drawer, Modal, ToastProvider, useToast, Segmented } from '../components/ui/kit';
import { AppShell } from '../components/layout/AppShell';

describe('format helpers', () => {
  const now = new Date('2026-01-01T12:00:00Z').getTime();

  it('computes deadline urgency', () => {
    expect(timeLeft('2026-01-01T20:00:00Z', now)).toMatchObject({ tone: 'danger', text: '8h 0m left' });
    expect(timeLeft('2026-01-03T00:00:00Z', now).tone).toBe('warn');
    expect(timeLeft('2026-01-20T00:00:00Z', now)).toMatchObject({ tone: 'neutral', text: '18 days left' });
    expect(timeLeft('2025-12-31T00:00:00Z', now).text).toBe('Overdue');
    expect(timeLeft(null, now).text).toBe('No deadline');
  });

  it('labels reasons, priorities, money and relative times', () => {
    expect(reasonLabel('MERCHANDISE_OR_SERVICE_NOT_RECEIVED')).toBe('Item not received');
    expect(reasonLabel('SOMETHING_NEW')).toBe('Something New');
    expect(priorityMeta(70).label).toBe('CRITICAL');
    expect(priorityMeta(40).label).toBe('MEDIUM');
    expect(priorityMeta(39.9).label).toBe('LOW');
    expect(money(1250, 'USD')).toBe('USD 1,250.00');
    expect(timeAgo(now - 90_000, now)).toBe('1m ago');
  });
});

describe('prettifyCodes', () => {
  it('makes raw codes readable but leaves ids and short codes alone', () => {
    expect(prettifyCodes('Dispute Filed: MERCHANDISE_OR_SERVICE_NOT_RECEIVED')).toBe('Dispute Filed: Item not received');
    expect(prettifyCodes('Carrier Reported DELIVERED')).toBe('Carrier Reported delivered');
    expect(prettifyCodes('Evidence Logged: PROOF_OF_DELIVERY_SIGNATURE')).toBe('Evidence Logged: Proof of delivery signature');
    expect(prettifyCodes('Order Placed (DEMO-ORD-1042)')).toBe('Order Placed (DEMO-ORD-1042)');
    expect(prettifyCodes('Package Dispatched via UPS for USD 450.00')).toBe('Package Dispatched via UPS for USD 450.00');
  });
});

describe('interactive kit', () => {
  it('Segmented switches value and shows counts', () => {
    let picked = '';
    render(<Segmented value="a" onChange={(v) => (picked = v)} options={[{ value: 'a', label: 'One', count: 3 }, { value: 'b', label: 'Two' }]} />);
    expect(screen.getByRole('tab', { name: /One/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: /Two/ }));
    expect(picked).toBe('b');
  });

  it('Modal closes on Escape', () => {
    let closed = false;
    render(<Modal open onClose={() => (closed = true)} title="Hello">body</Modal>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed).toBe(true);
  });

  it('popups are placed at the top of the page, not inside the element they were opened from', () => {
    // A parent with a transform (even the identity one a fade-in animation leaves behind) would otherwise trap "fixed" positioning,
    // so the popup landed off-centre inside the page content instead of in the middle of the window.
    render(
      <div data-testid="page-content" style={{ transform: 'translateY(0)' }}>
        <Modal open onClose={() => undefined} title="A modal">body</Modal>
        <Drawer open onClose={() => undefined} title="A drawer">body</Drawer>
      </div>,
    );
    const page = screen.getByTestId('page-content');
    for (const dialog of screen.getAllByRole('dialog')) {
      expect(page.contains(dialog)).toBe(false);          // not inside the transformed parent
      expect(document.body.contains(dialog)).toBe(true);   // but still on the page
    }
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    // The overlay is a direct child of <body>, which is what makes it cover (and centre in) the whole window.
    expect(screen.getByText('A modal').closest('[role=dialog]')!.parentElement!.parentElement).toBe(document.body);
    expect(screen.getByText('A drawer').closest('[role=dialog]')!.parentElement!.parentElement).toBe(document.body);
  });

  it('toasts appear and can be dismissed', () => {
    function Trigger() { const t = useToast(); return <button onClick={() => t('success', 'Saved it')}>go</button>; }
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText('go'));
    expect(screen.getByText('Saved it')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText('Saved it')).not.toBeInTheDocument();
  });
});

describe('AppShell', () => {
  it('opens the command palette with Ctrl+K and lists pages', () => {
    global.fetch = (() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })) as any;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><AppShell /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByLabelText('Command search')).toBeInTheDocument();
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0);
  });
});
