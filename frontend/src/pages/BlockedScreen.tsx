import React from 'react';
import { Ban } from 'lucide-react';
import { SessionUser } from '../types';
import { Button } from '../components/ui/kit';
import { clearSession } from '../lib/auth';

/** What a blocked investigator sees instead of the app. They can't open or approve anything until a manager unblocks them. */
export function BlockedScreen({ user }: { user: SessionUser }) {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4">
      <main role="alert" className="w-full max-w-md animate-fade-in rounded-[22px] border border-rose-400/30 bg-surface p-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose-500/15 text-rose-300"><Ban className="h-7 w-7" /></div>
        <h1 className="mt-5 text-[24px] font-bold tracking-[-0.02em] text-white">Your account is blocked</h1>
        <p className="mt-2 text-[15px] text-slate-300">
          {user.name}, you have {user.strikes} strikes. The limit is {user.block_at}, so you can't open or approve cases right now.
        </p>
        <p className="mt-2 text-[15px] text-muted">Speak to your manager. They can unblock your account once it is sorted.</p>
        <Button className="mt-6" onClick={clearSession}>Sign out</Button>
      </main>
    </div>
  );
}
