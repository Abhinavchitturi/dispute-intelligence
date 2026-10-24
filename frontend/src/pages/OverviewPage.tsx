import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert,
  Clock,
  FileQuestion,
  UserCheck,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  XCircle,
  HelpCircle,
  ArrowUpRight
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { fetchDashboardSummary } from '../api/client';

export function OverviewPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboardSummary'],
    queryFn: fetchDashboardSummary,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-400">Loading dispute portfolio analytics...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-rose-950/30 border border-rose-800 rounded-lg text-rose-200">
        <p className="font-semibold text-sm">Failed to load dashboard summary.</p>
        <p className="text-xs text-rose-300 mt-1">Please ensure backend server is running on port 8000.</p>
      </div>
    );
  }

  const priorityPieData = [
    { name: 'Critical (>=70)', value: data.priority_distribution.high, color: '#EF4444' },
    { name: 'Medium (40-69)', value: data.priority_distribution.medium, color: '#F59E0B' },
    { name: 'Standard (<40)', value: data.priority_distribution.low, color: '#10B981' },
  ];

  const reasonBarData = data.disputes_by_reason.map(r => ({
    name: r.reason.replace('MERCHANDISE_OR_SERVICE_', '').replace(/_/g, ' '),
    count: r.count
  }));

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-[#111A33] via-[#161F38] to-[#111A33] border border-[#233054] flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg font-bold text-white tracking-tight">Executive Dispute Overview</h1>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-700/60">
              SYNTHETIC DEMO DATASET
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Operational queue health, priority distribution, and evidentiary integrity across authorized records.
          </p>
        </div>
        <button
          onClick={() => navigate('/investigate/DEMO-DSP-1042')}
          className="inline-flex items-center space-x-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-blue-600/20 transition self-start md:self-auto"
        >
          <span>Open Main Demo Case (Alex Morgan #1042)</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div
          onClick={() => navigate('/queue')}
          className="p-4 rounded-xl bg-[#0F172A] border border-[#1E293B] hover:border-blue-500/50 cursor-pointer transition group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Total Open Disputes</span>
            <div className="p-2 rounded-lg bg-blue-950/60 text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-white">{data.total_open_disputes}</span>
            <span className="text-[11px] text-blue-400 font-medium flex items-center">
              View queue <ArrowUpRight className="w-3 h-3 ml-0.5" />
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Requiring investigator review or tracking input</p>
        </div>

        {/* Metric 2 */}
        <div
          onClick={() => navigate('/queue?priority_level=high')}
          className="p-4 rounded-xl bg-[#0F172A] border border-[#1E293B] hover:border-amber-500/50 cursor-pointer transition group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Deadlines &lt; 48h</span>
            <div className="p-2 rounded-lg bg-amber-950/60 text-amber-400 group-hover:bg-amber-600 group-hover:text-white transition">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-amber-300">{data.approaching_deadline_count}</span>
            <span className="text-[11px] text-amber-400 font-medium flex items-center">
              Imminent response <ArrowUpRight className="w-3 h-3 ml-0.5" />
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Risk of automated buyer default settlement</p>
        </div>

        {/* Metric 3 */}
        <div
          onClick={() => navigate('/queue?evidence_status=MISSING')}
          className="p-4 rounded-xl bg-[#0F172A] border border-[#1E293B] hover:border-rose-500/50 cursor-pointer transition group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Evidence Gaps / Conflicts</span>
            <div className="p-2 rounded-lg bg-rose-950/60 text-rose-400 group-hover:bg-rose-600 group-hover:text-white transition">
              <FileQuestion className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-rose-300">{data.missing_evidence_count}</span>
            <span className="text-[11px] text-rose-400 font-medium flex items-center">
              Action needed <ArrowUpRight className="w-3 h-3 ml-0.5" />
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Missing tracking, geocode, or rebuttal artifacts</p>
        </div>

        {/* Metric 4 */}
        <div
          onClick={() => navigate('/queue?status=WAITING_FOR_SELLER_RESPONSE')}
          className="p-4 rounded-xl bg-[#0F172A] border border-[#1E293B] hover:border-emerald-500/50 cursor-pointer transition group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Awaiting Seller Input</span>
            <div className="p-2 rounded-lg bg-emerald-950/60 text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white transition">
              <UserCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-emerald-300">{data.awaiting_review_count}</span>
            <span className="text-[11px] text-emerald-400 font-medium flex items-center">
              Inspect claims <ArrowUpRight className="w-3 h-3 ml-0.5" />
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Active merchant evidence upload window</p>
        </div>
      </div>

      {/* Analytics Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart 1: Volume by Reason */}
        <div className="lg:col-span-2 p-5 rounded-xl bg-[#0F172A] border border-[#1E293B]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Dispute Volume by Category</h2>
              <p className="text-xs text-slate-400">Real distribution across active portfolio</p>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">Total {data.total_open_disputes} claims</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={reasonBarData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <XAxis dataKey="name" tick={{ fill: '#8A99AD', fontSize: 11 }} interval={0} angle={-15} textAnchor="end" />
                <YAxis tick={{ fill: '#8A99AD', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#161F38', borderColor: '#233054', borderRadius: '8px', color: '#fff' }}
                  labelStyle={{ color: '#E2E8F0', fontWeight: 'bold' }}
                />
                <Bar dataKey="count" fill="#3A86FF" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Priority Distribution */}
        <div className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B] flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Priority Distribution</h2>
            <p className="text-xs text-slate-400 mb-4">Explainable 0–100 risk score breakdown</p>
            <div className="h-44 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={priorityPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={4}
                  >
                    {priorityPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#161F38', borderColor: '#233054', borderRadius: '8px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="space-y-2 mt-2 pt-3 border-t border-[#1E293B]">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center text-slate-300">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 mr-2"></span>
                Critical (Score &ge; 70)
              </span>
              <span className="font-semibold text-rose-400">{data.priority_distribution.high}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center text-slate-300">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 mr-2"></span>
                Medium (40–69)
              </span>
              <span className="font-semibold text-amber-400">{data.priority_distribution.medium}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center text-slate-300">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-2"></span>
                Standard (&lt; 40)
              </span>
              <span className="font-semibold text-emerald-400">{data.priority_distribution.low}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Outcomes & Recent Activity Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Action Outcomes Summary */}
        <div className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B]">
          <h2 className="text-sm font-semibold text-white mb-1">Investigator Action Results</h2>
          <p className="text-xs text-slate-400 mb-4">Confirmed sandbox & demo action logs</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-800/40 text-center">
              <CheckCircle className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
              <div className="text-lg font-bold text-emerald-300">{data.action_outcomes_summary.success}</div>
              <div className="text-[10px] text-emerald-400/80 font-medium">Executed</div>
            </div>
            <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/40 text-center">
              <XCircle className="w-4 h-4 text-rose-400 mx-auto mb-1" />
              <div className="text-lg font-bold text-rose-300">{data.action_outcomes_summary.failed}</div>
              <div className="text-[10px] text-rose-400/80 font-medium">Failed</div>
            </div>
            <div className="p-3 rounded-lg bg-blue-950/30 border border-blue-800/40 text-center">
              <HelpCircle className="w-4 h-4 text-blue-400 mx-auto mb-1" />
              <div className="text-lg font-bold text-blue-300">{data.action_outcomes_summary.pending}</div>
              <div className="text-[10px] text-blue-400/80 font-medium">Pending Review</div>
            </div>
          </div>

          <div className="mt-4 p-3 rounded-lg bg-[#161F38] border border-[#233054] text-[11px] text-slate-300">
            <p className="font-semibold text-slate-200 mb-1">Human-in-the-Loop Safeguard</p>
            <p className="text-slate-400">
              ResolveIQ requires explicit investigator review and 2-step confirmation before any API submission to PayPal.
            </p>
          </div>
        </div>

        {/* Recent Activity Audit Feed */}
        <div className="lg:col-span-2 p-5 rounded-xl bg-[#0F172A] border border-[#1E293B]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Recent Case Activity</h2>
              <p className="text-xs text-slate-400">Database audit trail stream</p>
            </div>
            <button
              onClick={() => navigate('/audit')}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center space-x-1"
            >
              <span>Full audit log</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-3">
            {data.recent_activity.map((evt) => (
              <div
                key={evt.id}
                className="p-3 rounded-lg bg-[#161F38] border border-[#233054] flex items-center justify-between text-xs"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-blue-300 font-semibold">{evt.dispute_id || 'SYSTEM'}</span>
                      <span className="text-slate-400">•</span>
                      <span className="font-semibold text-slate-200">{evt.action.replace(/_/g, ' ')}</span>
                    </div>
                    <p className="text-slate-400 truncate text-[11px] mt-0.5">{evt.result_summary}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 pl-3">
                  <span className="text-[10px] text-slate-500 font-mono">
                    {new Date(evt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
