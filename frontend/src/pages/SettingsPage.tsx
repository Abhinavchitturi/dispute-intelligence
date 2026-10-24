import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Cpu, Database, Plug, RotateCcw, XCircle } from 'lucide-react';
import { fetchIntegrationStatus, resetDemoData, testAIConnectivity, testPayPalConnectivity } from '../api/client';
import { Badge, Button, Card, ErrorState, KeyValue, Modal, PageHeader, SectionTitle, Skeleton, useToast } from '../components/ui/kit';
import { cn, titleCase } from '../lib/format';

type TestResult = { connected: boolean; message: string } | null;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 border-b border-line py-3 text-sm last:border-0"><span className="text-muted">{label}</span><span className="text-right text-slate-100">{children}</span></div>;
}

function Result({ r }: { r: TestResult }) {
  if (!r) return null;
  return (
    <div className={cn('mt-4 flex items-start gap-2 rounded-xl border p-3 text-sm animate-fade-in', r.connected ? 'border-emerald-400/20 bg-emerald-400/5 text-emerald-200' : 'border-rose-400/20 bg-rose-400/5 text-rose-200')}>
      {r.connected ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <XCircle className="mt-0.5 h-4 w-4" />}
      <div><p className="font-medium">{r.connected ? 'Connected' : 'Not connected'}</p><p className="opacity-80">{r.message}</p></div>
    </div>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [paypal, setPaypal] = useState<TestResult>(null);
  const [ai, setAi] = useState<TestResult>(null);
  const [busy, setBusy] = useState<'paypal' | 'ai' | 'reset' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const { data: status, isLoading, error, refetch } = useQuery({ queryKey: ['integrationStatus'], queryFn: fetchIntegrationStatus });

  const run = async (kind: 'paypal' | 'ai') => {
    setBusy(kind);
    try {
      const res = await (kind === 'paypal' ? testPayPalConnectivity() : testAIConnectivity());
      (kind === 'paypal' ? setPaypal : setAi)(res);
    } catch (e: any) {
      (kind === 'paypal' ? setPaypal : setAi)({ connected: false, message: e.message });
    } finally { setBusy(null); }
  };

  const reset = async () => {
    setBusy('reset');
    try {
      const res = await resetDemoData();
      toast('success', res.message || 'Demo data reset.');
      setConfirmReset(false);
      queryClient.invalidateQueries();
    } catch { toast('error', 'Failed to reset demo data.'); }
    finally { setBusy(null); }
  };

  if (error) return <ErrorState message="Couldn't load integration status." onRetry={() => refetch()} />;

  return (
    <>
      <PageHeader title="Settings" subtitle="Settings & Integration Connectivity — check what's connected and reset the sample data." />

      {isLoading || !status ? (
        <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>
      ) : (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted">Environment</div>
              <div className="mt-1 flex items-center gap-3">
                <Badge tone={status.environment_mode === 'demo' ? 'violet' : 'info'} dot>{status.environment_mode.toUpperCase()} MODE</Badge>
                <span className="text-sm text-muted">{status.environment_mode === 'demo' ? 'Sample data. Nothing is sent to PayPal.' : 'Connected to the PayPal sandbox.'}</span>
              </div>
            </div>
            <Button onClick={() => setConfirmReset(true)}><RotateCcw className="h-4 w-4" />Reset demo data</Button>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-6">
              <SectionTitle title="PayPal Sandbox REST API" action={<Badge tone={status.paypal.configured ? 'success' : 'warn'} dot>{status.paypal.configured ? 'Configured' : 'Not configured'}</Badge>} />
              <div>
                <Row label="Environment">{titleCase(status.paypal.environment)}</Row>
                <Row label="Endpoint"><span className="font-mono text-xs">{status.paypal.base_url}</span></Row>
                <Row label="Client ID">{status.paypal.client_id_configured ? <Badge tone="success">Set</Badge> : <Badge>Not set</Badge>}</Row>
                <Row label="Client secret">{status.paypal.client_secret_configured ? <Badge tone="success">Set</Badge> : <Badge>Not set</Badge>}</Row>
              </div>
              <Button className="mt-5 w-full" variant="primary" loading={busy === 'paypal'} onClick={() => run('paypal')}><Plug className="h-4 w-4" />Test connection</Button>
              <Result r={paypal} />
            </Card>

            <Card className="p-6">
              <SectionTitle title="AI summaries" action={<Badge tone="success" dot>Operational</Badge>} />
              <div>
                <Row label="Provider"><span className="uppercase">{status.ai_provider.provider}</span></Row>
                <Row label="Model"><span className="font-mono text-xs">{status.ai_provider.model}</span></Row>
                <Row label="Deterministic Rule Engine"><span className="text-emerald-300">Always on (works offline)</span></Row>
                <Row label="Citation checking"><span className="text-emerald-300">Enforced</span></Row>
              </div>
              <Button className="mt-5 w-full" variant="primary" loading={busy === 'ai'} onClick={() => run('ai')}><Cpu className="h-4 w-4" />Test AI provider</Button>
              <Result r={ai} />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-6">
              <SectionTitle title="Database" />
              <dl className="grid grid-cols-2 gap-4">
                <KeyValue label="Type"><span className="flex items-center gap-2"><Database className="h-4 w-4 text-brand-soft" />{status.database.type}</span></KeyValue>
                <KeyValue label="Location" mono>{status.database.url_sanitized}</KeyValue>
              </dl>
            </Card>
            <Card className="p-6">
              <SectionTitle title="Features" />
              <ul className="flex flex-wrap gap-2">
                {Object.entries(status.features_available).map(([k, on]) => (
                  <Badge key={k} tone={on ? 'success' : 'neutral'}>{on ? '✓' : '–'} {titleCase(k)}</Badge>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset demo data?"
        footer={<><Button onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="danger" loading={busy === 'reset'} onClick={reset}>Reset data</Button></>}
      >
        <p className="text-sm text-slate-300">This restores the original sample disputes and clears any actions you've taken in the demo.</p>
      </Modal>
    </>
  );
}
