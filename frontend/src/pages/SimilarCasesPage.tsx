import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  GitCompare,
  Search,
  Filter,
  CheckCircle,
  XCircle,
  HelpCircle,
  AlertCircle,
  BookOpen
} from 'lucide-react';
import { searchHistoricalCases } from '../api/client';
import { HistoricalCase } from '../types';

export function SimilarCasesPage() {
  const [reason, setReason] = useState('ALL');
  const [outcome, setOutcome] = useState('ALL');
  const [search, setSearch] = useState('');

  const { data: cases, isLoading, error } = useQuery({
    queryKey: ['historicalCases', reason, outcome, search],
    queryFn: () => searchHistoricalCases({ reason, outcome, search }),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold text-white tracking-tight">Historical Precedent Explorer</h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
              SYNTHETIC PRECEDENT DATASET
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Query 20 seeded historical dispute precedents with multi-attribute evidentiary factors and past outcomes.
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search precedents by keyword (e.g. signature, customs, empty box)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Dispute Reasons</option>
              <option value="MERCHANDISE_OR_SERVICE_NOT_RECEIVED">Item Not Received</option>
              <option value="MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED">Item Not As Described</option>
              <option value="UNAUTHORISED">Unauthorized Claim</option>
              <option value="CANCELLED_OR_RETURNED">Cancelled or Returned</option>
              <option value="DUPLICATE_TRANSACTION">Duplicate Charge</option>
            </select>
          </div>

          <div>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="w-full px-3 py-2 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Past Outcomes</option>
              <option value="MERCHANT_FAVOR">Merchant Favor</option>
              <option value="BUYER_FAVOR">Buyer Favor</option>
              <option value="SETTLED">Settled / Compromise</option>
              <option value="DISMISSED">Dismissed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Case Grid */}
      {isLoading ? (
        <div className="py-16 text-center text-slate-400 text-xs">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Querying historical cases...
        </div>
      ) : error ? (
        <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs">
          Failed to load historical cases.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cases?.map((c) => (
            <div
              key={c.id}
              className="p-4 rounded-xl bg-[#0F172A] border border-[#1E293B] hover:border-[#233054] transition space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-bold text-blue-400 text-xs">{c.id}</span>
                    <span className="text-slate-500">•</span>
                    <span className="text-xs font-semibold text-slate-200">
                      {c.reason.replace(/MERCHANDISE_OR_SERVICE_/g, '').replace(/_/g, ' ')}
                    </span>
                  </div>

                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                      c.outcome === 'BUYER_FAVOR'
                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                        : c.outcome === 'MERCHANT_FAVOR'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : 'bg-blue-950 text-blue-300 border border-blue-800'
                    }`}
                  >
                    {c.outcome || 'PENDING'}
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{c.case_summary}</p>
              </div>

              {/* Evidence Factor Chips */}
              <div className="pt-2 border-t border-[#1E293B]">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">
                  Documented Evidentiary Factors:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(c.evidence_attributes).map(([k, v]) => (
                    <span
                      key={k}
                      className="text-[10px] px-2 py-0.5 rounded bg-[#161F38] text-slate-300 border border-[#233054]"
                    >
                      {k.replace(/_/g, ' ')}: <strong className="text-white">{String(v)}</strong>
                    </span>
                  ))}
                  {c.amount && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-blue-950/40 text-blue-300 border border-blue-800/40 font-mono">
                      Exposure: ${c.amount.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
