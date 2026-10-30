import { useEffect, useState } from 'react';
import { SessionUser } from '../types';

const KEY = 'resolveiq.session';
const EVENT = 'resolveiq:session';

export interface Session { token: string; user: SessionUser }

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch { return null; }
}

function emit() { window.dispatchEvent(new Event(EVENT)); }

export function saveSession(s: Session) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
  emit();
}

/**
 * Updates the saved user (strike count, blocked flag) without signing in again.
 * Only if it is still the same person: a late answer about someone who has since signed out must never overwrite who is signed in now.
 */
export function updateSessionUser(user: SessionUser) {
  const s = readSession();
  if (s && s.user.id === user.id) saveSession({ ...s, user });
}

export function clearSession() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  emit();
}

/** Changes whenever someone signs in, signs out, or a different person signs in. Anything cached for the last person must go. */
export function useSessionKey(): string {
  const s = useSession();
  return s ? `${s.user.id}:${s.token.slice(-12)}` : 'signed-out';
}

/** Who is signed in. Re-renders everything that asks, the moment someone signs in or out. */
export function useSession(): Session | null {
  const [s, setS] = useState<Session | null>(readSession);
  useEffect(() => {
    const sync = () => setS(readSession());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  return s;
}

/**
 * Sends the signed-in user's token with every call to our own API, and signs you out if the server says the token is no good.
 * Installed once in main.tsx, so tests that stub fetch are untouched.
 */
export function installAuthFetch() {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const session = readSession();
    const ours = url.startsWith('/api/');
    const headers = new Headers(init?.headers);
    if (ours && session && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await original(input, { ...init, headers });
    if (ours && res.status === 401 && !url.startsWith('/api/auth/login')) clearSession();
    return res;
  };
}
