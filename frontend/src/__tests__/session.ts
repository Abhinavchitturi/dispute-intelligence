import { SessionUser } from '../types';

/** Signs a person in the way the app does: a saved session. Tests that render a page directly use this to pick who is looking. */
export function signInAs(role: 'INVESTIGATOR' | 'MANAGER', over: Partial<SessionUser> = {}) {
  const user: SessionUser = role === 'MANAGER'
    ? { id: 'USR-m', username: 'manager', name: 'PayPal', role, email: null, is_blocked: false, blocked_reason: null, strikes: 0, block_at: 10, notify_at: 3, ...over }
    : { id: 'USR-i', username: 'investigator', name: 'Abhinav Chitturi', role, email: null, is_blocked: false, blocked_reason: null, strikes: 0, block_at: 10, notify_at: 3, ...over };
  window.localStorage.setItem('resolveiq.session', JSON.stringify({ token: 'test-token', user }));
}

export const signOut = () => window.localStorage.removeItem('resolveiq.session');
