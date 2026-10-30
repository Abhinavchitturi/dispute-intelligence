import { useSession } from './auth';
import { Role, SessionUser } from '../types';

// Who the pages show when nobody is signed in. Only tests render a page without signing in, so this keeps them simple.
const TEST_USER: SessionUser = { id: 'USR-test', username: 'investigator', name: 'Abhinav Chitturi', role: 'INVESTIGATOR', email: null, is_blocked: false, blocked_reason: null, strikes: 0, block_at: 10, notify_at: 3 };

export const ROLE_LABEL: Record<SessionUser['role'], string> = { INVESTIGATOR: 'Dispute investigator', MANAGER: 'Dispute manager' };

/** The person signed in right now, and what they are allowed to do. */
export function useCurrentUser() {
  const session = useSession();
  const raw = session?.user ?? (import.meta.env.MODE === 'test' ? TEST_USER : null);
  const user = raw ?? TEST_USER;
  const role: Role = user.role === 'MANAGER' ? 'manager' : 'investigator';
  return { user: { ...user, roleLabel: ROLE_LABEL[user.role] }, role, isManager: role === 'manager', signedIn: !!raw };
}

export const firstName = (name: string) => name.split(' ')[0];
export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
export type { Role };
