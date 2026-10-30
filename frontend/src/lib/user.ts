import { useStoredRole } from './hooks';
import { Role } from '../types';

// Signed-in people shown in the header and greeting. There is no sign-in yet, so the role is a switch in the header
// and the server trusts it. Edit these to change who you are.
export const INVESTIGATOR = { name: 'Abhinav Chitturi', role: 'Dispute investigator' };
export const ADMIN = { name: 'Priya Raman', role: 'Dispute operations admin' };

/** The person using the app right now, from the role switch. */
export function useCurrentUser() {
  const [role, setRole] = useStoredRole();
  return { role, setRole, isAdmin: role === 'admin', user: role === 'admin' ? ADMIN : INVESTIGATOR };
}

// Kept for code that only needs the default investigator (greeting, tests).
export const CURRENT_USER = INVESTIGATOR;

export const firstName = (name: string) => name.split(' ')[0];
export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
export type { Role };
