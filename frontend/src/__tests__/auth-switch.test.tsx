import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { App } from '../App';
import { clearSession, readSession, updateSessionUser } from '../lib/auth';
import { signInAs, signOut } from './session';

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const MANAGER = { id: 'USR-m', username: 'paypal', name: 'PayPal', role: 'MANAGER', email: null, is_blocked: false, blocked_reason: null, strikes: 0, block_at: 10, notify_at: 3 };
const ABHINAV = { id: 'USR-i', username: 'abhinav', name: 'Abhinav Chitturi', role: 'INVESTIGATOR', email: null, is_blocked: false, blocked_reason: null, strikes: 0, block_at: 10, notify_at: 3 };

/** A server that answers as whoever is signed in right now, the way the real one does from the token. */
function server() {
  const calls: string[] = [];
  global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push(url);
    const who = readSession()?.user.role === 'MANAGER' ? MANAGER : ABHINAV;
    if (url.endsWith('/auth/login')) {
      const body = JSON.parse(init!.body as string);
      return ok({ token: `token-${body.username}-0000000000`, user: body.username === 'paypal' ? MANAGER : ABHINAV });
    }
    if (url.endsWith('/auth/me')) return ok(who);
    if (url.includes('/dashboard/summary')) return ok({ environment_mode: 'demo', total_open_disputes: 4, approaching_deadline_count: 0, missing_evidence_count: 0, awaiting_review_count: 0, new_cases_count: 0, waiting_on_parties_count: 0,
      unassigned_count: 0, ai_owned_count: 0, high_profile_count: 4, my_cases_count: 2, pending_admin_review_count: 0, disputes_by_reason: [], priority_distribution: { high: 0, medium: 0, low: 0 }, recent_activity: [],
      action_outcomes_summary: { success: 0, failed: 0, pending: 0 } });
    if (url.endsWith('/notifications')) return ok({ unread: 0, items: [], open_alerts: [] });
    if (url.endsWith('/api/health')) return ok({ status: 'healthy', mode: 'demo' });
    return ok([]);
  }) as any;
  return calls;
}

beforeEach(() => { vi.stubEnv('MODE', 'production'); window.history.pushState({}, '', '/'); });
afterEach(() => { cleanup(); signOut(); vi.unstubAllEnvs(); });

const header = () => screen.getByText('Dispute manager', { exact: false }).closest('div')!.parentElement as HTMLElement;

describe('Signing in as someone else', () => {
  it('shows who you signed in as straight away, and never the person who was signed in before', async () => {
    server();
    signInAs('MANAGER');
    render(<App />);
    expect(await screen.findByText('Good morning, PayPal', { exact: false }).catch(() => screen.findByText(/PayPal/))).toBeInTheDocument();
    expect(await screen.findAllByText('PayPal')).not.toHaveLength(0);          // the manager's name, in the header

    // Sign out, then sign in as Abhinav through the real form, without reloading the page.
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'abhinav' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findAllByText('Abhinav Chitturi')).length).toBeGreaterThan(0);
    // Not PayPal, not even for a moment, and not after the background refresh either.
    expect(screen.queryByText('PayPal')).not.toBeInTheDocument();
    expect(screen.queryByText('Dispute manager')).not.toBeInTheDocument();
    expect(screen.getByText('Dispute investigator')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByText('PayPal')).not.toBeInTheDocument();
    expect(readSession()!.user.name).toBe('Abhinav Chitturi');
  });

  it("does not show the last person's tiles or lists either", async () => {
    server();
    signInAs('MANAGER');
    render(<App />);
    expect(await screen.findByText('High profile')).toBeInTheDocument();       // the manager's tile
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'abhinav' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Your cases')).toBeInTheDocument();         // the investigator's tile
    expect(screen.queryByText('High profile')).not.toBeInTheDocument();
  });

  it('a late answer about the previous person cannot overwrite who is signed in now', () => {
    signInAs('INVESTIGATOR');
    updateSessionUser({ ...MANAGER } as any);                                    // a stale "who am I" for someone else
    expect(readSession()!.user.name).toBe('Abhinav Chitturi');
    updateSessionUser({ ...ABHINAV, strikes: 4 } as any);                        // the same person's fresh details do apply
    expect(readSession()!.user.strikes).toBe(4);
  });

  it('signing out clears the session, and the login page comes straight back', async () => {
    server();
    signInAs('INVESTIGATOR');
    render(<App />);
    await screen.findAllByText('Abhinav Chitturi');
    clearSession();
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByText('Abhinav Chitturi')).not.toBeInTheDocument();
  });
});
