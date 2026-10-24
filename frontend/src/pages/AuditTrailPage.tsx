import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ScrollText,
  Search,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ShieldCheck,
  ArrowRight
} from 'lucide-react';
import { fetchAuditTrail } from '../api/client';
import { SourceBadge } from '../components/ui/StatusBadges';

export function AuditTrailPage() {
  const navigate = useNavigate();
  const [disputeFilter, setDisputeFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const { data: auditEvents, isLoading, error } = useQuery({
    queryKey: ['auditEvents', disputeFilter, actionFilter, statusFilter],
    queryFn: () =>
      fetchAuditTrail({
        dispute_id: disputeFilter || undefined,
        action: actionFilter,
        status: statusFilter,
      }),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Compliance &amp; Investigation Audit Trail</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Immutable, database-persisted ledger of all AI briefs generated, priority scores computed, and investigator actions executed.
          </p>
        </div>
        <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#0F172A] border border-[#1E293B] text-xs text-slate-300">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Credential Sanitization Active</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-[#0F172A] border border-[#1E293B]">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Filter by Dispute ID (e.g. DEMO-DSP-1042)..."
              value={disputeFilter}
              onChange={(e) => setDisputeFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full px-3 py-2 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Logged Actions</option>
              <option value="BRIEF_GENERATED">Brief Generated</option>
              <option value="PROVIDE_EVIDENCE">Provide Evidence</option>
              <option value="ACCEPT_CLAIM">Accept Claim</option>
              <option value="PRIORITY_SCORED">Priority Scored</option>
              <option value="DISPUTE_INGESTED">Dispute Ingested</option>
            </select>
          </div>

          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Outcomes</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILED">Failed</option>
              <option value="PENDING_APPROVAL">Pending Approval</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-[#0F172A] border border-[#1E293B] overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#161F38] text-slate-300 font-semibold border-b border-[#233054]">
                <th className="py-3 px-4">Event ID</th>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Dispute ID</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Result Summary</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E293B]">
              {isLoading && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    Querying audit events from database...
                  </td>
                </tr>
              )}

              {error && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-rose-400">
                    Failed to query audit trail.
                  </td>
                </tr>
              )}

              {!isLoading && auditEvents && auditEvents.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No audit records found matching criteria.
                  </td>
                </tr>
              )}

              {!isLoading &&
                auditEvents?.map((evt) => (
                  <tr key={evt.id} className="hover:bg-[#161F38]/40 transition">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-400">{evt.id}</td>
                    <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                      {new Date(evt.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-mono">
                      {evt.dispute_id ? (
                        <button
                          onClick={() => navigate(`/investigate/${evt.dispute_id}`)}
                          className="text-blue-400 hover:text-blue-300 hover:underline flex items-center space-x-1"
                        >
                          <span>{evt.dispute_id}</span>
                          <ArrowRight className="w-2.5 h-2.5" />
                        </button>
                      ) : (
                        <span className="text-slate-500">SYSTEM</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-300 font-mono text-[11px]">{evt.actor}</td>
                    <td className="py-3 px-4 font-medium text-slate-200">
                      {evt.action.replace(/_/g, ' ')}
                    </td>
                    <td className="py-3 px-4 text-slate-300 text-[11px] max-w-md">
                      {evt.result_summary}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                          evt.status === 'SUCCESS'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}
                      >
                        {evt.status === 'SUCCESS' ? (
                          <CheckCircle2 className="w-3 h-3 mr-0.5" />
                        ) : (
                          <XCircle className="w-3 h-3 mr-0.5" />
                        )}
                        <span>{evt.status}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <SourceBadge source={evt.source} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
