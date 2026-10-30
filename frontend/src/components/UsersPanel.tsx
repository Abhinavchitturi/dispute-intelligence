import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, UserCheck, UserX } from 'lucide-react';
import { blockUser, createUser, fetchUsers, resetPassword, unblockUser, updateUser } from '../api/client';
import { ManagedUser } from '../types';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Select, Skeleton, useToast } from './ui/kit';
import { cn } from '../lib/format';
import { useCurrentUser } from '../lib/user';

type Action = 'edit' | 'password' | 'block' | null;

function Row({ u, isMe }: { u: ManagedUser; isMe: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [action, setAction] = useState<Action>(null);
  const [name, setName] = useState(u.name);
  const [email, setEmail] = useState(u.email ?? '');
  const [text, setText] = useState('');
  const refresh = () => ['users', 'team', 'dashboardSummary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const done = (message: string) => { toast('success', message); setAction(null); setText(''); refresh(); };
  const fail = (e: Error) => toast('error', e.message);

  const save = useMutation({ mutationFn: () => updateUser(u.id, { display_name: name.trim(), email: email.trim() }), onSuccess: () => done(`${u.name} was updated.`), onError: fail });
  const role = useMutation({ mutationFn: (r: string) => updateUser(u.id, { role: r }), onSuccess: (x) => done(`${x.name} is now a ${x.role.toLowerCase()}.`), onError: fail });
  const active = useMutation({ mutationFn: (on: boolean) => updateUser(u.id, { is_active: on }), onSuccess: (x) => done(x.is_active ? `${x.name} can sign in again.` : `${x.name} was deactivated.`), onError: fail });
  const reset = useMutation({ mutationFn: () => resetPassword(u.id, text), onSuccess: () => done(`New password set for ${u.name}.`), onError: fail });
  const block = useMutation({ mutationFn: () => blockUser(u.id, text.trim()), onSuccess: () => done(`${u.name} is blocked.`), onError: fail });
  const unblock = useMutation({ mutationFn: () => unblockUser(u.id), onSuccess: () => done(`${u.name} is unblocked.`), onError: fail });

  return (
    <li className="py-4" aria-label={`User ${u.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-white">{u.name}</span>
            <Badge tone={u.role === 'MANAGER' ? 'violet' : 'neutral'}>{u.role === 'MANAGER' ? 'Manager' : 'Investigator'}</Badge>
            {!u.is_active && <Badge tone="danger">Deactivated</Badge>}
            {u.is_blocked && <Badge tone="danger" dot>Blocked</Badge>}
            {isMe && <Badge tone="info">You</Badge>}
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            <span className="font-mono">{u.username}</span>{u.email && ` · ${u.email}`} · {u.open_cases} open case{u.open_cases === 1 ? '' : 's'}{u.role === 'INVESTIGATOR' && ` · ${u.strikes} strike${u.strikes === 1 ? '' : 's'}`}
          </p>
          {u.blocked_reason && <p className="mt-0.5 text-xs text-rose-300">{u.blocked_reason}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setAction(action === 'edit' ? null : 'edit')} aria-label={`Edit ${u.name}`}><Pencil className="h-3.5 w-3.5" />Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => { setText(''); setAction(action === 'password' ? null : 'password'); }} aria-label={`Reset password for ${u.name}`}><KeyRound className="h-3.5 w-3.5" />Password</Button>
          {u.role === 'INVESTIGATOR' && (u.is_blocked
            ? <Button size="sm" variant="ghost" loading={unblock.isPending} onClick={() => unblock.mutate()} aria-label={`Unblock ${u.name}`}>Unblock</Button>
            : <Button size="sm" variant="ghost" onClick={() => { setText(''); setAction(action === 'block' ? null : 'block'); }} aria-label={`Block ${u.name}`}>Block</Button>)}
          {!isMe && (u.is_active
            ? <Button size="sm" variant="ghost" loading={active.isPending} onClick={() => active.mutate(false)} aria-label={`Deactivate ${u.name}`}><UserX className="h-3.5 w-3.5" />Deactivate</Button>
            : <Button size="sm" variant="ghost" loading={active.isPending} onClick={() => active.mutate(true)} aria-label={`Reactivate ${u.name}`}><UserCheck className="h-3.5 w-3.5" />Reactivate</Button>)}
        </div>
      </div>

      {action === 'edit' && (
        <div className="mt-3 grid gap-3 rounded-2xl border border-line bg-raised/40 p-4 sm:grid-cols-2 animate-fade-in">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} aria-label={`Name for ${u.name}`} /></Field>
          <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} aria-label={`Email for ${u.name}`} /></Field>
          <Field label="Role">
            <Select value={u.role} disabled={isMe || role.isPending} onChange={(e) => role.mutate(e.target.value)} aria-label={`Role for ${u.name}`}>
              <option value="INVESTIGATOR">Investigator</option><option value="MANAGER">Manager</option>
            </Select>
          </Field>
          <p className="self-end text-xs text-muted">{isMe ? "You can't change your own role." : 'Cases follow a person by name, so renaming moves their cases with them.'}</p>
          <div className="flex gap-2 sm:col-span-2"><Button size="sm" variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Save</Button><Button size="sm" variant="ghost" onClick={() => setAction(null)}>Cancel</Button></div>
        </div>
      )}
      {action === 'password' && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-raised/40 p-4 animate-fade-in">
          <div className="w-full sm:w-72"><Field label="New password (at least 8 characters)"><Input type="password" value={text} onChange={(e) => setText(e.target.value)} autoComplete="new-password" aria-label={`New password for ${u.name}`} /></Field></div>
          <Button size="sm" variant="primary" loading={reset.isPending} disabled={text.length < 8} onClick={() => reset.mutate()}>Set password</Button>
          <Button size="sm" variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
        </div>
      )}
      {action === 'block' && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-raised/40 p-4 animate-fade-in">
          <div className="w-full sm:w-96"><Field label="Why? They will see this."><Input value={text} onChange={(e) => setText(e.target.value)} aria-label={`Reason for blocking ${u.name}`} /></Field></div>
          <Button size="sm" variant="danger" loading={block.isPending} disabled={text.trim().length < 5} onClick={() => block.mutate()}>Block account</Button>
          <Button size="sm" variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
        </div>
      )}
    </li>
  );
}

function AddUser() {
  const toast = useToast();
  const qc = useQueryClient();
  const blank = { username: '', display_name: '', email: '', role: 'INVESTIGATOR', password: '' };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const add = useMutation({
    mutationFn: () => createUser({ ...f, email: f.email.trim() || undefined }),
    onSuccess: (u) => { toast('success', `${u.name} can now sign in as ${u.username}.`); setF(blank); setOpen(false); ['users', 'team'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e: Error) => toast('error', e.message),
  });
  if (!open) return <Button variant="primary" size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add user</Button>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} aria-label="Add a user" className="grid w-full gap-3 rounded-2xl border border-line bg-raised/40 p-4 sm:grid-cols-2 animate-fade-in">
      <Field label="Name"><Input value={f.display_name} onChange={set('display_name')} aria-label="New user's name" /></Field>
      <Field label="Username"><Input value={f.username} onChange={set('username')} autoCapitalize="none" aria-label="New user's username" /></Field>
      <Field label="Email (optional)"><Input value={f.email} onChange={set('email')} aria-label="New user's email" /></Field>
      <Field label="Role"><Select value={f.role} onChange={set('role')} aria-label="New user's role"><option value="INVESTIGATOR">Investigator</option><option value="MANAGER">Manager</option></Select></Field>
      <Field label="Password (at least 8 characters)"><Input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" aria-label="New user's password" /></Field>
      <div className="flex items-end gap-2">
        <Button type="submit" variant="primary" size="sm" loading={add.isPending} disabled={!f.display_name.trim() || !f.username.trim() || f.password.length < 8}>Add user</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

/** Everyone who can sign in: add people, rename them, change their role, reset a password, block or deactivate. */
export function UsersPanel() {
  const { user } = useCurrentUser();
  const users = useQuery({ queryKey: ['users'], queryFn: fetchUsers, refetchInterval: 30_000 });
  return (
    <Card className="p-6">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-[13px] text-muted">Add people, change who can do what, reset passwords, and block or deactivate accounts. A deactivated person can't sign in, but their cases and history stay.</p>
        <AddUser />
      </div>
      {users.isError ? <ErrorState message="Couldn't load the users." onRetry={() => users.refetch()} /> : users.isLoading ? <Skeleton className="h-40" /> : !users.data?.length ? <EmptyState title="No users" /> : (
        <ul className={cn('divide-y divide-line')} aria-label="All users">
          {users.data.map((u) => <Row key={u.id} u={u} isMe={u.id === user.id} />)}
        </ul>
      )}
    </Card>
  );
}
