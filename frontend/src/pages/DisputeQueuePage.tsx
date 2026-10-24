import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  Filter,
  ArrowUpDown,
  ChevronRight,
  Info,
  Clock,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  XCircle,
  FileText
} from 'lucide-react';
import { fetchDisputes } from '../api/client';
import { DisputeSummary, PriorityFactor } from '../types';
import { PriorityBadge, StatusBadge, EvidenceBadge, SourceBadge } from '../components/ui/StatusBadges';

export function DisputeQueuePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [status, setStatus] = useState(searchParams.get('status') || 'ALL');
  const [reason, setReason] = useState(searchParams.get('reason') || 'ALL');
  const [priorityLevel, setPriorityLevel] = useState(searchParams.get('priority_level') || 'ALL');
  const [evidenceStatus, setEvidenceStatus] = useState(searchParams.get('evidence_status') || 'ALL');
  const [source, setSource] = useState(searchParams.get('source') || 'ALL');
  const [sortBy, setSortBy] = useState('priority_score');
  const [sortOrder, setSortOrder] = useState('desc');
  const [selectedFactors, setSelectedFactors] = useState<{ disputeId: string; factors: PriorityFactor[] } | null>(null);

  const { data: disputes, isLoading, error } = useQuery({
    queryKey: ['disputes', search, status, reason, priorityLevel, evidenceStatus, source, sortBy, sortOrder],
    queryFn: () =>
      fetchDisputes({
        search,
        status,
        reason,
        priority_level: priorityLevel,
        evidence_status: evidenceStatus,
        source,
        sort_by: sortBy,
        sort_order: sortOrder,
      }),
  });

  const handleResetFilters = () => {
    setSearch('');
    setStatus('ALL');
    setReason('ALL');
    setPriorityLevel('ALL');
    setEvidenceStatus('ALL');
    setSource('ALL');
    setSortBy('priority_score');
    setSortOrder('desc');
    setSearchParams({});
  };

  const formatDeadline = (dueStr: string | null) => {
    if (!dueStr) return <span className="text-slate-500 font-mono text-xs">Unknown</span>;
    const due = new Date(dueStr);
    const now = new Date();
    const diffHours = (due.getTime() - now.getTime()) / (1000 * 3600);

    if (diffHours < 0) {
      return <span className="text-rose-400 font-semibold text-xs flex items-center"><AlertCircle className="w-3 h-3 mr-1" /> Expired</span>;
    }
    if (diffHours <= 24) {
      return <span className="text-rose-400 font-semibold text-xs flex items-center"><Clock className="w-3 h-3 mr-1" /> {diffHours.toFixed(0)}h remaining</span>;
    }
    if (diffHours <= 48) {
      return <span className="text-amber-400 font-medium text-xs flex items-center"><Clock className="w-3 h-3 mr-1" /> {(diffHours / 24).toFixed(1)}d remaining</span>;
    }
    return <span className="text-slate-300 text-xs">{(diffHours / 24).toFixed(0)} days</span>;
  };

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Dispute Investigation Queue</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Prioritized workbench table with verified source records and explainable scoring.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-slate-400 font-mono">
            {disputes ? `${disputes.length} cases loaded` : 'Loading...'}
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {/* Search Box */}
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Filter by Case, Txn, Buyer, Merchant..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-2 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="WAITING_FOR_SELLER_RESPONSE">Action Needed (Seller)</option>
              <option value="WAITING_FOR_BUYER_RESPONSE">Awaiting Buyer</option>
              <option value="UNDER_REVIEW">Under Review</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>

          {/* Reason Filter */}
          <div>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Reasons</option>
              <option value="MERCHANDISE_OR_SERVICE_NOT_RECEIVED">Item Not Received</option>
              <option value="MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED">Item Not As Described</option>
              <option value="UNAUTHORISED">Unauthorized Claim</option>
              <option value="CANCELLED_OR_RETURNED">Cancelled or Returned</option>
              <option value="DUPLICATE_TRANSACTION">Duplicate Charge</option>
            </select>
          </div>

          {/* Priority Level */}
          <div>
            <select
              value={priorityLevel}
              onChange={(e) => setPriorityLevel(e.target.value)}
              className="w-full px-3 py-2 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Priorities</option>
              <option value="high">Critical (Score &ge; 70)</option>
              <option value="medium">Medium (40–69)</option>
              <option value="low">Standard (&lt; 40)</option>
            </select>
          </div>

          {/* Evidence Completeness */}
          <div>
            <select
              value={evidenceStatus}
              onChange={(e) => setEvidenceStatus(e.target.value)}
              className="w-full px-3 py-2 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Evidence States</option>
              <option value="COMPLETE">Complete</option>
              <option value="CONFLICTING">Conflicting Records</option>
              <option value="MISSING">Missing Docs</option>
              <option value="PARTIAL">Partial</option>
            </select>
          </div>
        </div>

        {/* Sort Controls & Reset */}
        <div className="flex items-center justify-between pt-2 border-t border-[#1E293B] text-xs">
          <div className="flex items-center space-x-3">
            <span className="text-slate-400">Sort by:</span>
            <button
              onClick={() => {
                if (sortBy === 'priority_score') {
                  setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                } else {
                  setSortBy('priority_score');
                  setSortOrder('desc');
                }
              }}
              className={`px-2.5 py-1 rounded border text-xs font-medium flex items-center space-x-1 ${
                sortBy === 'priority_score'
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-[#161F38] text-slate-300 border-[#233054]'
              }`}
            >
              <span>Priority Score</span>
              <ArrowUpDown className="w-3 h-3" />
            </button>
            <button
              onClick={() => {
                if (sortBy === 'amount') {
                  setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                } else {
                  setSortBy('amount');
                  setSortOrder('desc');
                }
              }}
              className={`px-2.5 py-1 rounded border text-xs font-medium flex items-center space-x-1 ${
                sortBy === 'amount'
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-[#161F38] text-slate-300 border-[#233054]'
              }`}
            >
              <span>Amount</span>
              <ArrowUpDown className="w-3 h-3" />
            </button>
            <button
              onClick={() => {
                if (sortBy === 'response_due_date') {
                  setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                } else {
                  setSortBy('response_due_date');
                  setSortOrder('asc');
                }
              }}
              className={`px-2.5 py-1 rounded border text-xs font-medium flex items-center space-x-1 ${
                sortBy === 'response_due_date'
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-[#161F38] text-slate-300 border-[#233054]'
              }`}
            >
              <span>Deadline</span>
              <ArrowUpDown className="w-3 h-3" />
            </button>
          </div>

          <button
            onClick={handleResetFilters}
            className="text-slate-400 hover:text-white underline text-xs"
          >
            Clear all filters
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-xl bg-[#0F172A] border border-[#1E293B] overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#161F38] text-slate-300 font-semibold border-b border-[#233054]">
                <th className="py-3 px-4">Case ID</th>
                <th className="py-3 px-4">Dispute Reason</th>
                <th className="py-3 px-4">Buyer & Merchant</th>
                <th className="py-3 px-4">Disputed Amount</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Response Due</th>
                <th className="py-3 px-4">Evidence Status</th>
                <th className="py-3 px-4">Priority (0-100)</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E293B]">
              {isLoading && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    Loading cases from database...
                  </td>
                </tr>
              )}

              {error && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-rose-400">
                    Failed to query dispute database. Check network or server status.
                  </td>
                </tr>
              )}

              {!isLoading && disputes && disputes.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400">
                    <AlertCircle className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-slate-300">No disputes match the selected filters.</p>
                    <p className="text-xs text-slate-500 mt-1">Try broadening your search term or resetting filters.</p>
                    <button
                      onClick={handleResetFilters}
                      className="mt-3 px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium"
                    >
                      Reset filters
                    </button>
                  </td>
                </tr>
              )}

              {!isLoading &&
                disputes &&
                disputes.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => navigate(`/investigate/${d.id}`)}
                    className="hover:bg-[#161F38]/60 cursor-pointer transition group"
                  >
                    {/* Case ID */}
                    <td className="py-3.5 px-4 font-mono font-semibold text-blue-400 group-hover:text-blue-300">
                      <div>{d.id}</div>
                      <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                        {d.transaction_id || 'NO_TXN'}
                      </div>
                    </td>

                    {/* Reason */}
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-200">
                        {d.reason.replace(/MERCHANDISE_OR_SERVICE_/g, '').replace(/_/g, ' ')}
                      </div>
                      <div className="text-[11px] text-slate-400 line-clamp-1 mt-0.5 max-w-xs">
                        {d.buyer_claim || 'No buyer statement recorded.'}
                      </div>
                    </td>

                    {/* Buyer & Merchant */}
                    <td className="py-3.5 px-4">
                      <div className="text-slate-200 font-medium">{d.buyer_reference || 'Fictional Buyer'}</div>
                      <div className="text-[11px] text-slate-400">{d.merchant_reference || 'Unknown Merchant'}</div>
                    </td>

                    {/* Amount */}
                    <td className="py-3.5 px-4 font-mono font-medium text-slate-100">
                      {d.currency} {d.amount.toFixed(2)}
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4">
                      <StatusBadge status={d.status} />
                    </td>

                    {/* Response Due */}
                    <td className="py-3.5 px-4">
                      {formatDeadline(d.response_due_date)}
                    </td>

                    {/* Evidence Completeness */}
                    <td className="py-3.5 px-4">
                      <EvidenceBadge status={d.evidence_status} />
                    </td>

                    {/* Priority */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center space-x-2">
                        <PriorityBadge score={d.priority_score} />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFactors({ disputeId: d.id, factors: d.priority_factors });
                          }}
                          className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-700/50"
                          title="Inspect priority score factors"
                        >
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <span className="inline-flex items-center text-xs text-blue-400 group-hover:text-blue-300 font-medium">
                        Investigate <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Priority Factors Modal */}
      {selectedFactors && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#0F172A] border border-[#233054] rounded-xl max-w-lg w-full p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#1E293B] pb-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-white">Priority Score Breakdown</h3>
                <p className="text-xs text-slate-400">Explainable scoring factors for Case {selectedFactors.disputeId}</p>
              </div>
              <button
                onClick={() => setSelectedFactors(null)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-[#161F38]"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              {selectedFactors.factors.map((f, i) => (
                <div key={i} className="p-3 rounded-lg bg-[#161F38] border border-[#233054] text-xs">
                  <div className="flex items-center justify-between font-semibold text-slate-200 mb-1">
                    <span>{f.name}</span>
                    <span className="text-blue-400 font-mono">+{f.contribution.toFixed(1)} pts</span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">{f.explanation}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-[#1E293B] flex justify-end">
              <button
                onClick={() => setSelectedFactors(null)}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
