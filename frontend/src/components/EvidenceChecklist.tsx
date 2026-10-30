import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Eye, FileText, Film, Image as ImageIcon } from 'lucide-react';
import { fetchEvidencePreview, fetchEvidenceSummary } from '../api/client';
import { EvidenceLine } from '../types';
import { Button, Modal, Skeleton } from './ui/kit';
import { cn, fileSize, parseServerDate } from '../lib/format';

type Side = 'seller' | 'buyer' | 'records';
const TITLE: Record<Side, string> = { seller: 'From the seller', buyer: 'From the buyer', records: "PayPal's own records" };

function fileIcon(type: string | null) {
  if (type?.startsWith('video')) return Film;
  if (type?.startsWith('image')) return ImageIcon;
  return FileText;
}

/** The generated document, in a frame with no permissions: nothing in it can run or reach the app. */
function PreviewFrame({ evidenceId, label }: { evidenceId: string; label: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['evidencePreview', evidenceId], queryFn: () => fetchEvidencePreview(evidenceId), staleTime: 60_000 });
  if (isLoading) return <Skeleton className="h-[60vh]" />;
  if (error || !data) return <p className="text-sm text-red-300">{(error as Error | null)?.message ?? 'No preview available.'}</p>;
  const doc = data.trimStart().startsWith('<svg') ? `<body style="margin:0;background:#fff">${data}</body>` : data;
  return <iframe title={`${label} preview`} srcDoc={doc} sandbox="" className="h-[60vh] w-full rounded-xl border border-line bg-white" />;
}

/** One piece of evidence. What was sent is shown with its file details; what was not sent is red and says why. */
export function EvidenceRow({ line }: { line: EvidenceLine }) {
  const [previewing, setPreviewing] = useState(false);
  const missing = line.status === 'MISSING';
  const Icon = fileIcon(line.content_type);
  return (
    <li
      data-status={line.status}
      className={cn('rounded-xl border px-3.5 py-3', missing ? 'border-red-500/30 bg-red-500/[.07]' : 'border-line bg-raised/40')}
    >
      <div className="flex items-start gap-2.5">
        {missing
          ? <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          : <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 text-[14px] font-medium text-white">{line.label}</span>
            <span className={cn('shrink-0 whitespace-nowrap text-xs font-semibold', missing ? 'text-red-400' : 'text-emerald-400')}>{missing ? 'Missing' : 'Received'}</span>
          </div>
          {missing ? (
            <p className="mt-0.5 text-[13px] text-red-300/90">{line.detail || 'Not on file.'}</p>
          ) : (
            <>
              {line.description && <p className="mt-0.5 text-[13px] text-slate-300">{line.description}</p>}
              {line.file_name && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/[.04] px-2.5 py-1.5 text-xs text-slate-300">
                  <Icon aria-hidden className="h-3.5 w-3.5 text-muted" />
                  <span className="font-mono text-slate-100">{line.file_name}</span>
                  {line.content_type && <span>{line.content_type}</span>}
                  {line.size_bytes ? <span>{fileSize(line.size_bytes)}</span> : null}
                  {line.duration_seconds ? <span>{Math.floor(line.duration_seconds / 60)}m {line.duration_seconds % 60}s</span> : null}
                </div>
              )}
              {line.storage && <p className="mt-1 text-xs text-muted">{line.storage}</p>}
              {line.preview && line.evidence_id && (
                <Button size="sm" className="mt-2" onClick={() => setPreviewing(true)} aria-label={`Preview ${line.label}`}>
                  <Eye className="h-3.5 w-3.5" />Preview
                </Button>
              )}
              {line.is_video && <p className="mt-1.5 text-xs text-muted">Video can't be previewed here. PayPal holds the file.</p>}
              {line.provided_at && <p className="mt-1 text-xs text-muted">Received {parseServerDate(line.provided_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>}
            </>
          )}
        </div>
      </div>
      {previewing && line.evidence_id && (
        <Modal open onClose={() => setPreviewing(false)} size="lg" title={line.label}>
          <PreviewFrame evidenceId={line.evidence_id} label={line.label} />
        </Modal>
      )}
    </li>
  );
}

/** Everything the seller and the buyer have sent, and what is still missing. */
export function EvidenceChecklist({ disputeId, sides = ['seller', 'buyer', 'records'], columns = true, title }: {
  disputeId: string; sides?: Side[]; columns?: boolean; title?: string;
}) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['evidenceSummary', disputeId], queryFn: () => fetchEvidenceSummary(disputeId), staleTime: 5_000 });
  if (isLoading) return <Skeleton className="h-40" />;
  if (isError || !data) return <p className="text-sm text-red-300">Couldn't load the evidence.</p>;

  const lines = (s: Side): EvidenceLine[] => data[s] ?? [];
  const shown = sides.filter((s) => s === 'seller' || s === 'buyer' || lines(s).length > 0);
  const missingTotal = shown.reduce((n, s) => n + lines(s).filter((l) => l.status === 'MISSING').length, 0);
  return (
    <section aria-label={title ?? 'Evidence on this case'}>
      {title && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-white">{title}</h3>
          <span className={cn('text-xs font-medium', missingTotal ? 'text-red-400' : 'text-emerald-400')}>
            {missingTotal ? `${missingTotal} item${missingTotal === 1 ? '' : 's'} missing` : 'Nothing missing'}
          </span>
        </div>
      )}
      <div className={cn('grid gap-5', columns && shown.length > 1 && (shown.length > 2 ? 'lg:grid-cols-3' : 'md:grid-cols-2'))}>
        {shown.map((s) => (
          <div key={s}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{TITLE[s]}</h4>
            <ul className="space-y-2" aria-label={TITLE[s]}>
              {lines(s).map((l) => <EvidenceRow key={`${l.evidence_type}-${l.evidence_id ?? 'missing'}`} line={l} />)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
