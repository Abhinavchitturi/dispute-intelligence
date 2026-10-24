import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  AlertTriangle,
  FileQuestion,
  Building,
  ShieldAlert,
  ArrowRight,
  Info,
  CheckCircle2
} from 'lucide-react';
import { fetchPatternInsights } from '../api/client';

export function PatternInsightsPage() {
  const navigate = useNavigate();
  const { data: patterns, isLoading, error } = useQuery({
    queryKey: ['patternInsights'],
    queryFn: fetchPatternInsights,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold text-white tracking-tight">Authorized Dataset Pattern Insights</h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
              AUTHORIZED SCOPE ONLY
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Systemic anomaly detection and evidentiary vulnerability clustering derived strictly from authorized records.
          </p>
        </div>
      </div>

      {/* Scope Disclaimer Box */}
      <div className="p-4 rounded-xl bg-[#111A33] border border-[#233054] text-xs text-slate-300 flex items-start space-x-3">
        <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-slate-200">Data Boundary Notice</p>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            These patterns reflect aggregations strictly within the authorized sandbox and synthetic merchant dataset.
            ResolveIQ does not assert global PayPal platform-wide statistics or cross-merchant fraud scoring.
          </p>
        </div>
      </div>

      {/* Pattern Cards List */}
      {isLoading ? (
        <div className="py-16 text-center text-slate-400 text-xs">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Analyzing dispute clusters and evidentiary patterns...
        </div>
      ) : error ? (
        <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs">
          Failed to load pattern insights.
        </div>
      ) : (
        <div className="space-y-4">
          {patterns?.map((p) => (
            <div
              key={p.pattern_id}
              className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B] shadow-md space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <div className={`p-1.5 rounded ${
                    p.severity === 'HIGH'
                      ? 'bg-rose-950/60 text-rose-400 border border-rose-800/60'
                      : 'bg-amber-950/60 text-amber-400 border border-amber-800/60'
                  }`}>
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white">{p.title}</h2>
                    <span className="text-[10px] font-mono text-slate-400">
                      Category: {p.category} • Time Window: {p.time_window}
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2 self-start sm:self-auto">
                  <span className="text-xs px-2.5 py-1 rounded font-bold font-mono bg-blue-950 text-blue-300 border border-blue-800">
                    {p.case_count} Disputed Cases
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                    p.severity === 'HIGH'
                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                      : 'bg-amber-950 text-amber-300 border border-amber-800'
                  }`}>
                    {p.severity} SEVERITY
                  </span>
                </div>
              </div>

              {/* Why Noteworthy */}
              <div className="p-3 rounded-lg bg-[#161F38] border border-[#233054] text-xs">
                <span className="font-semibold text-slate-200">Why Noteworthy: </span>
                <span className="text-slate-300">{p.why_noteworthy}</span>
              </div>

              {/* Recommended Action */}
              <div className="text-xs text-slate-300 flex items-start space-x-2">
                <span className="font-semibold text-blue-400 flex-shrink-0">Action Recommended:</span>
                <span className="text-slate-200">{p.recommended_action}</span>
              </div>

              {/* Supporting Dispute IDs */}
              <div className="pt-2 border-t border-[#1E293B] flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-400">Supporting Records:</span>
                {p.supporting_record_ids.map((id: string) => (
                  <button
                    key={id}
                    onClick={() => navigate(`/investigate/${id}`)}
                    className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono bg-[#0B132B] hover:bg-blue-900/40 text-blue-300 border border-blue-800/70 transition"
                  >
                    <span>{id}</span>
                    <ArrowRight className="w-2.5 h-2.5" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
