import React, { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { login } from '../api/client';
import { saveSession } from '../lib/auth';
import { Button, Field, Input } from '../components/ui/kit';

/** The front door. */
export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (u: string, p: string) => {
    setBusy(true); setError('');
    try {
      saveSession(await login(u, p));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4">
      <main className="w-full max-w-sm animate-fade-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-[16px] bg-brand"><ShieldCheck className="h-7 w-7 text-white" /></div>
          <h1 className="mt-5 text-[28px] font-bold tracking-[-0.022em] text-white">ResolveIQ</h1>
          <p className="mt-1 text-[15px] text-muted">Sign in to PayPal Disputes</p>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(username, password); }} className="space-y-4 rounded-[22px] border border-line/70 bg-surface p-6">
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus aria-label="Username" />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-label="Password" />
          </Field>
          {error && <p role="alert" className="text-[13px] text-rose-300">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !username || !password}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Sign in
          </Button>
        </form>

      </main>
    </div>
  );
}
