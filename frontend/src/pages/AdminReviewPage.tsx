import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { fetchDisputes } from '../api/client';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SectionTitle, Skeleton } from '../components/ui/kit';
import { AdminReviewPanel, ReopenButton } from '../components/AdminReviewPanel';
import { money, outcomeText, reasonLabel } from '../lib/format';
import { useCurrentUser } from '../lib/user';

/** Where an admin confirms, changes or sends back the decisions investigators have made. */
export function AdminReviewPage() {
  const navigate = useNavigate();
  const { isAdmin } = useCurrentUser();

  const pending = useQuery({ queryKey: ['disputes', 'adminPending'], queryFn: () => fetchDisputes({ status: 'PENDING_ADMIN_REVIEW', sort_by: 'priority_score', sort_order: 'desc' }), refetchInterval: 15_000 });
  const decided = useQuery({ queryKey: ['disputes', 'adminDecided'], queryFn: () => fetchDisputes({ status: 'RESOLVED', sort_by: 'updated_at', sort_order: 'desc' }), enabled: isAdmin });

  if (!isAdmin) {
    return (
      <Card>
        <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="Admins only" hint="Switch to Admin in the header to review decisions. Investigators send their decisions here." />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Admin review"
        subtitle="Investigators decide and give a reason. Nobody outside PayPal hears about a decision until you confirm it. You can also decide differently, or send a case back."
      />

      {pending.isError ? <ErrorState message="Couldn't load the decisions." onRetry={() => pending.refetch()} /> : pending.isLoading ? (
        <div className="space-y-4"><Skeleton className="h-64 rounded-2xl" /></div>
      ) : !pending.data?.length ? (
        <Card><EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Nothing waiting for you" hint="When an investigator decides a case, it shows up here." /></Card>
      ) : (
        <ul className="space-y-5" aria-label="Decisions waiting for review">
          {pending.data.map((d) => (
            <li key={d.id}>
              <Card className="p-6">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="font-mono text-lg font-semibold text-white">{d.id}</h2>
                      <Badge tone="warn" dot>With admin</Badge>
                    </div>
                    <p className="mt-1 text-[13px] text-muted">{d.buyer_reference ?? 'Buyer'} vs {d.merchant_reference ?? 'Seller'} · {reasonLabel(d.reason)} · {money(d.amount, d.currency)}</p>
                    {d.buyer_claim && <p className="mt-2 text-sm italic text-slate-300">“{d.buyer_claim}”</p>}
                  </div>
                  <Button size="sm" onClick={() => navigate(`/investigate/${d.id}`)}>Open case <ArrowRight className="h-3.5 w-3.5" /></Button>
                </div>
                <AdminReviewPanel dispute={d} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card className="p-6">
        <SectionTitle title="Decided cases" hint="If something looks wrong, reopen it. It returns to the investigator with your note." />
        {decided.isLoading ? <Skeleton className="h-24" /> : !decided.data?.length ? (
          <p className="text-sm text-muted">No decided cases yet.</p>
        ) : (
          <ul className="divide-y divide-line" aria-label="Decided cases">
            {decided.data.slice(0, 10).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <button onClick={() => navigate(`/investigate/${d.id}`)} className="font-mono text-[13px] font-semibold text-white hover:underline">{d.id}</button>
                  <p className="text-[13px] text-muted">{reasonLabel(d.reason)} · {money(d.amount, d.currency)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone="success">{outcomeText(d.outcome) ?? 'Resolved'}</Badge>
                  <ReopenButton dispute={d} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
