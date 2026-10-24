import React, { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldAlert,
  Clock,
  Sparkles,
  RotateCw,
  FileText,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ArrowLeft,
  Truck,
  CreditCard,
  ShoppingBag,
  Send,
  User,
  Building,
  ExternalLink,
  ChevronDown,
  Info,
  Layers,
  History,
  Lock,
  Compass
} from 'lucide-react';
import {
  fetchDisputeDetail,
  fetchDisputeTimeline,
  fetchInvestigationBrief,
  fetchSimilarCasesForDispute,
  previewAction,
  executeAction
} from '../api/client';
import { PriorityBadge, StatusBadge, EvidenceBadge, SourceBadge } from '../components/ui/StatusBadges';
import { ActionPreviewResult } from '../types';

export function CaseInvestigationPage() {
  const { disputeId = 'DEMO-DSP-1042' } = useParams<{ disputeId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'brief' | 'evidence' | 'timeline' | 'similar' | 'audit'>('brief');
  const [selectedActionType, setSelectedActionType] = useState('PROVIDE_EVIDENCE');
  const [actionNotes, setActionNotes] = useState('');
  const [carrierInput, setCarrierInput] = useState('UPS');
  const [trackingInput, setTrackingInput] = useState('1Z9999999999999999');
  const [highlightedRecordId, setHighlightedRecordId] = useState<string | null>(null);

  // Confirmation modal state
  const [previewData, setPreviewData] = useState<ActionPreviewResult | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [executionResult, setExecutionResult] = useState<any | null>(null);

  const evidencePanelRef = useRef<HTMLDivElement>(null);

  // Queries
  const { data: dispute, isLoading: isDisputeLoading } = useQuery({
    queryKey: ['disputeDetail', disputeId],
    queryFn: () => fetchDisputeDetail(disputeId),
  });

  const { data: timeline, isLoading: isTimelineLoading } = useQuery({
    queryKey: ['disputeTimeline', disputeId],
    queryFn: () => fetchDisputeTimeline(disputeId),
  });

  const { data: brief, isLoading: isBriefLoading, refetch: refetchBrief } = useQuery({
    queryKey: ['investigationBrief', disputeId],
    queryFn: () => fetchInvestigationBrief(disputeId, false),
  });

  const { data: similarCases } = useQuery({
    queryKey: ['similarCases', disputeId],
    queryFn: () => fetchSimilarCasesForDispute(disputeId),
  });

  // Brief Regeneration Mutation
  const regenerateBriefMutation = useMutation({
    mutationFn: () => fetchInvestigationBrief(disputeId, true),
    onSuccess: (newBrief) => {
      queryClient.setQueryData(['investigationBrief', disputeId], newBrief);
    },
  });

  // Action Preview Handler
  const handlePreviewAction = async () => {
    try {
      setIsPreviewLoading(true);
      const preview = await previewAction(disputeId, {
        action_type: selectedActionType,
        notes: actionNotes,
        evidence_type: 'CARRIER_TRACKING',
        tracking_number: trackingInput,
        carrier: carrierInput,
      });
      setPreviewData(preview);
    } catch (err: any) {
      alert(`Preview failed: ${err.message}`);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Action Execution Handler
  const executeActionMutation = useMutation({
    mutationFn: async () => {
      return executeAction(disputeId, {
        action_type: selectedActionType,
        confirmed: true,
        notes: actionNotes,
        evidence_type: 'PROOF_OF_FULFILLMENT',
        tracking_number: trackingInput,
        carrier: carrierInput,
      });
    },
    onSuccess: (res) => {
      setExecutionResult(res);
      setPreviewData(null);
      queryClient.invalidateQueries({ queryKey: ['disputeDetail', disputeId] });
      queryClient.invalidateQueries({ queryKey: ['disputeTimeline', disputeId] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
    },
    onError: (err: any) => {
      alert(`Action execution failed: ${err.message}`);
    },
  });

  const handleCitationClick = (recordId: string) => {
    setHighlightedRecordId(recordId);
    setActiveTab('evidence');
    setTimeout(() => {
      const el = document.getElementById(`record-${recordId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  if (isDisputeLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-400">Loading case investigation workbench...</p>
        </div>
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="p-6 bg-rose-950/30 border border-rose-800 rounded-lg text-rose-200">
        <p className="font-semibold text-sm">Dispute not found.</p>
        <button onClick={() => navigate('/queue')} className="mt-2 text-xs text-blue-400 underline">
          Return to Dispute Queue
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button and breadcrumb */}
      <div className="flex items-center justify-between text-xs">
        <button
          onClick={() => navigate('/queue')}
          className="flex items-center space-x-1 text-slate-400 hover:text-white transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Dispute Queue</span>
        </button>
        <div className="flex items-center space-x-2 text-slate-400">
          <span>Disputes</span>
          <span>/</span>
          <span className="text-slate-200 font-mono font-medium">{dispute.id}</span>
        </div>
      </div>

      {/* 1. Case Header */}
      <div className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B] shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-tight font-mono">{dispute.id}</h1>
              <SourceBadge source={dispute.source} />
              <StatusBadge status={dispute.status} />
              <EvidenceBadge status={dispute.evidence_status} />
            </div>
            <p className="text-sm font-medium text-slate-200">
              {dispute.reason.replace(/MERCHANDISE_OR_SERVICE_/g, '').replace(/_/g, ' ')}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 pt-0.5">
              <span className="flex items-center space-x-1">
                <User className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-slate-300">{dispute.buyer_reference || 'Fictional Buyer'}</span>
              </span>
              <span>•</span>
              <span className="flex items-center space-x-1">
                <Building className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-slate-300">{dispute.merchant_reference || 'Merchant'}</span>
              </span>
              <span>•</span>
              <span className="font-mono text-slate-300">
                Txn: {dispute.transaction_id || 'N/A'}
              </span>
            </div>
          </div>

          {/* Right Header Metrics */}
          <div className="flex items-center space-x-4 self-start lg:self-auto border-t lg:border-t-0 pt-3 lg:pt-0 border-[#1E293B]">
            <div className="text-right">
              <div className="text-xs text-slate-400">Disputed Amount</div>
              <div className="text-xl font-bold text-white font-mono">
                {dispute.currency} {dispute.amount.toFixed(2)}
              </div>
            </div>

            <div className="h-9 w-px bg-slate-800" />

            <div className="text-right">
              <div className="text-xs text-slate-400">Response Due</div>
              <div className="text-xs font-semibold text-amber-300 flex items-center justify-end space-x-1">
                <Clock className="w-3.5 h-3.5" />
                <span>
                  {dispute.response_due_date
                    ? new Date(dispute.response_due_date).toLocaleDateString()
                    : 'Unknown'}
                </span>
              </div>
            </div>

            <div className="h-9 w-px bg-slate-800" />

            <div>
              <div className="text-xs text-slate-400 mb-0.5">Priority Risk</div>
              <PriorityBadge score={dispute.priority_score} />
            </div>
          </div>
        </div>

        {/* Buyer claim banner */}
        {dispute.buyer_claim && (
          <div className="mt-4 p-3 rounded-lg bg-[#161F38] border border-[#233054] text-xs">
            <span className="font-semibold text-blue-300 uppercase tracking-wider text-[10px] mr-2">
              Buyer Assertion:
            </span>
            <span className="text-slate-200 italic">"{dispute.buyer_claim}"</span>
          </div>
        )}
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Navigation Tabs & Investigation Brief */}
        <div className="lg:col-span-2 space-y-4">
          {/* Section Navigation Tabs */}
          <div className="flex items-center space-x-1 p-1 bg-[#0F172A] border border-[#1E293B] rounded-xl text-xs font-medium">
            <button
              onClick={() => setActiveTab('brief')}
              className={`flex-1 py-2 px-3 rounded-lg transition flex items-center justify-center space-x-1.5 ${
                activeTab === 'brief'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-[#161F38]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Investigation Brief</span>
            </button>
            <button
              onClick={() => setActiveTab('evidence')}
              className={`flex-1 py-2 px-3 rounded-lg transition flex items-center justify-center space-x-1.5 ${
                activeTab === 'evidence'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-[#161F38]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Source Evidence ({dispute.evidence_items.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('timeline')}
              className={`flex-1 py-2 px-3 rounded-lg transition flex items-center justify-center space-x-1.5 ${
                activeTab === 'timeline'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-[#161F38]'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Timeline ({timeline?.length || 0})</span>
            </button>
            <button
              onClick={() => setActiveTab('similar')}
              className={`flex-1 py-2 px-3 rounded-lg transition flex items-center justify-center space-x-1.5 ${
                activeTab === 'similar'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-[#161F38]'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>Similar Cases ({similarCases?.length || 0})</span>
            </button>
          </div>

          {/* TAB 1: AI INVESTIGATION BRIEF */}
          {activeTab === 'brief' && (
            <div className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-5">
              {/* Brief Subheader */}
              <div className="flex items-center justify-between pb-3 border-b border-[#1E293B]">
                <div className="flex items-center space-x-2">
                  <div className="p-1.5 rounded bg-blue-950 text-blue-400 border border-blue-800">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white">AI-Assisted Investigation Brief</h2>
                    <p className="text-[11px] text-slate-400">
                      Generated via {brief?.provider || 'rules_engine'} ({brief?.model || 'deterministic-fallback'}) • Citation Validated
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => regenerateBriefMutation.mutate()}
                  disabled={regenerateBriefMutation.isPending}
                  className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-[#161F38] hover:bg-[#233054] text-slate-200 rounded text-xs border border-[#233054] transition disabled:opacity-50"
                >
                  <RotateCw className={`w-3 h-3 ${regenerateBriefMutation.isPending ? 'animate-spin' : ''}`} />
                  <span>{regenerateBriefMutation.isPending ? 'Regenerating...' : 'Regenerate Brief'}</span>
                </button>
              </div>

              {isBriefLoading ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Building structured investigation brief...
                </div>
              ) : brief ? (
                <div className="space-y-5">
                  {/* Executive Summary */}
                  <div className="p-3.5 rounded-lg bg-[#161F38] border border-[#233054]">
                    <div className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider mb-1">
                      Investigation Executive Summary
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed">{brief.summary}</p>
                  </div>

                  {/* Structured Findings (Evidence-Linked) */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                        Evidence-Linked Findings ({brief.structured_findings.length})
                      </h3>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Click citations to inspect source records
                      </span>
                    </div>

                    <div className="space-y-2">
                      {brief.structured_findings.map((f) => (
                        <div
                          key={f.finding_id}
                          className="p-3 rounded-lg bg-[#161F38]/70 border border-[#233054] text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-slate-100">{f.claim}</span>
                            <div className="flex items-center space-x-1.5">
                              <span
                                className={`text-[10px] px-1.5 py-0.2 rounded font-mono uppercase font-medium ${
                                  f.classification === 'fact'
                                    ? 'bg-blue-950 text-blue-300 border border-blue-800'
                                    : 'bg-purple-950 text-purple-300 border border-purple-800'
                                }`}
                              >
                                {f.classification}
                              </span>
                              <span
                                className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-medium ${
                                  f.verification_status === 'verified'
                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                    : 'bg-amber-950 text-amber-300 border border-amber-800'
                                }`}
                              >
                                {f.verification_status}
                              </span>
                            </div>
                          </div>

                          <p className="text-[11px] text-slate-400">{f.explanation}</p>

                          {/* Citations */}
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-[10px] text-slate-500 font-medium">Source Citations:</span>
                            {f.source_record_ids.map((cid) => (
                              <button
                                key={cid}
                                onClick={() => handleCitationClick(cid)}
                                className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono bg-[#0B132B] hover:bg-blue-900/40 text-blue-300 border border-blue-800/70 transition"
                              >
                                <span>{cid}</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Evidentiary Gaps & Inconsistencies */}
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center space-x-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <span>Missing Evidence & Contradictions ({brief.evidence_gaps.length})</span>
                    </h3>

                    <div className="space-y-2">
                      {brief.evidence_gaps.map((gap, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-amber-950/20 border border-amber-800/40 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between font-semibold text-amber-200">
                            <span>{gap.evidence_type.replace(/_/g, ' ')}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-900/40 text-amber-300 border border-amber-700/50">
                              {gap.current_status}
                            </span>
                          </div>
                          <p className="text-[11px] text-amber-300/80">{gap.reason_required}</p>
                          <div className="text-[11px] text-slate-300 pt-0.5">
                            <span className="font-semibold text-slate-200">Recommended Follow-up: </span>
                            {gap.suggested_follow_up}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Suggested Next Steps */}
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                      Investigator Recommendations (Human Review Required)
                    </h3>

                    <div className="space-y-2">
                      {brief.recommendations.map((rec, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 rounded-lg bg-[#161F38] border border-[#233054] text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-emerald-300">{rec.recommendation}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-950 text-emerald-300 border border-emerald-800">
                              Requires Confirmation
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-300">{rec.rationale}</p>
                          <div className="text-[10px] text-slate-400 italic">
                            Limitations: {rec.limitations}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* TAB 2: EVIDENCE & SHIPMENT RECORDS */}
          {activeTab === 'evidence' && (
            <div ref={evidencePanelRef} className="space-y-4">
              {/* Order & Shipment Record Card */}
              <div
                id={`record-${dispute.order?.shipment?.id || 'DEMO-SHIP-1042'}`}
                className={`p-4 rounded-xl bg-[#0F172A] border transition ${
                  highlightedRecordId === dispute.order?.shipment?.id ||
                  highlightedRecordId === 'DEMO-SHIP-1042'
                    ? 'border-blue-400 ring-2 ring-blue-500/30'
                    : 'border-[#1E293B]'
                }`}
              >
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#1E293B]">
                  <div className="flex items-center space-x-2">
                    <Truck className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-bold text-white">Shipment & Carrier Record</span>
                    <span className="font-mono text-[10px] text-slate-400">
                      ({dispute.order?.shipment?.id || 'DEMO-SHIP-1042'})
                    </span>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded font-mono font-medium bg-blue-950 text-blue-300 border border-blue-800">
                    {dispute.order?.shipment?.carrier || 'Carrier'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-[11px] text-slate-400 block">Tracking Reference</span>
                    <span className="font-mono text-slate-200 font-semibold">
                      {dispute.order?.shipment?.tracking_reference || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">Tracking Status</span>
                    <span className="font-semibold text-emerald-400">
                      {dispute.order?.shipment?.status || 'UNKNOWN'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">Address Verification</span>
                    <span className="font-medium text-amber-300 uppercase">
                      {dispute.order?.shipment?.delivery_address_match || 'unknown'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">Delivered At</span>
                    <span className="text-slate-300">
                      {dispute.order?.shipment?.delivered_at
                        ? new Date(dispute.order.shipment.delivered_at).toLocaleDateString()
                        : 'Not delivered'}
                    </span>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-[#1E293B] text-[11px] text-slate-400">
                  Destination: <span className="text-slate-200">{dispute.order?.shipment?.shipping_address_masked || 'Springfield, IL'}</span>
                </div>
              </div>

              {/* Transaction Record Card */}
              <div
                id={`record-${dispute.transaction?.id || 'DEMO-TXN-1042'}`}
                className={`p-4 rounded-xl bg-[#0F172A] border transition ${
                  highlightedRecordId === dispute.transaction?.id ||
                  highlightedRecordId === 'DEMO-TXN-1042'
                    ? 'border-blue-400 ring-2 ring-blue-500/30'
                    : 'border-[#1E293B]'
                }`}
              >
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#1E293B]">
                  <div className="flex items-center space-x-2">
                    <CreditCard className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-white">Payment Transaction Ledger</span>
                    <span className="font-mono text-[10px] text-slate-400">
                      ({dispute.transaction?.id || 'DEMO-TXN-1042'})
                    </span>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded font-mono font-medium bg-emerald-950 text-emerald-300 border border-emerald-800">
                    {dispute.transaction?.status || 'COMPLETED'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-[11px] text-slate-400 block">Payment Method</span>
                    <span className="text-slate-200">{dispute.transaction?.payment_method || 'PayPal Gateway'}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">External Gateway ID</span>
                    <span className="font-mono text-slate-200">{dispute.transaction?.external_transaction_id || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">Masked Buyer Account</span>
                    <span className="font-mono text-slate-200">{dispute.transaction?.buyer_email_masked || 'a***n@example.com'}</span>
                  </div>
                </div>
              </div>

              {/* Evidence Items Table */}
              <div className="p-4 rounded-xl bg-[#0F172A] border border-[#1E293B]">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">
                  Documentary Evidence Checklist ({dispute.evidence_items.length})
                </h3>

                <div className="space-y-2">
                  {dispute.evidence_items.map((ev) => (
                    <div
                      key={ev.id}
                      id={`record-${ev.id}`}
                      className={`p-3 rounded-lg bg-[#161F38] border transition ${
                        highlightedRecordId === ev.id
                          ? 'border-blue-400 ring-2 ring-blue-500/30'
                          : 'border-[#233054]'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-semibold text-blue-300">{ev.id}</span>
                          <span className="text-slate-400">•</span>
                          <span className="font-semibold text-slate-200">{ev.evidence_type.replace(/_/g, ' ')}</span>
                        </div>
                        <EvidenceBadge status={ev.availability_status} />
                      </div>
                      <p className="text-[11px] text-slate-300">{ev.description}</p>
                      {ev.source_record_id && (
                        <div className="mt-1 text-[10px] text-slate-400 font-mono">
                          Source Ref: {ev.source_record_id}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TIMELINE */}
          {activeTab === 'timeline' && (
            <div className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B]">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">
                Evidence-Backed Event Stream
              </h3>

              {isTimelineLoading ? (
                <div className="py-8 text-center text-slate-400 text-xs">Loading chronological timeline...</div>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#233054]">
                  {timeline?.map((evt, idx) => (
                    <div key={evt.id} className="relative group">
                      <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-[#0F172A]" />
                      <div className="p-3 rounded-lg bg-[#161F38] border border-[#233054] text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-slate-100">{evt.title}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(evt.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300">{evt.description}</p>
                        {evt.source_record_id && (
                          <div className="mt-1 text-[10px] text-blue-400 font-mono">
                            Record: {evt.source_record_id}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: SIMILAR CASES */}
          {activeTab === 'similar' && (
            <div className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#1E293B]">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Similar Historical Cases ({similarCases?.length || 0})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Weighted pattern similarity across reason, evidence attributes, and disputed exposure.
                  </p>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                  SYNTHETIC HISTORICAL DATA
                </span>
              </div>

              <div className="space-y-3">
                {similarCases?.map((sc) => (
                  <div key={sc.id} className="p-3.5 rounded-lg bg-[#161F38] border border-[#233054] text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-blue-300">{sc.id}</span>
                        <span className="text-slate-400">•</span>
                        <span className="text-slate-200 font-medium">
                          {sc.reason.replace(/MERCHANDISE_OR_SERVICE_/g, '').replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-xs font-bold text-emerald-400">
                          {sc.similarity_score}% Match
                        </span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold ${
                          sc.outcome === 'BUYER_FAVOR'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : sc.outcome === 'MERCHANT_FAVOR'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-blue-950 text-blue-300 border border-blue-800'
                        }`}>
                          {sc.outcome || 'PENDING'}
                        </span>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-300 leading-relaxed">{sc.case_summary}</p>

                    {sc.matching_factors && sc.matching_factors.length > 0 && (
                      <div className="pt-1 flex flex-wrap gap-1">
                        {sc.matching_factors.map((mf, i) => (
                          <span
                            key={i}
                            className="text-[10px] px-2 py-0.5 rounded bg-[#0B132B] text-slate-300 border border-slate-700 font-medium"
                          >
                            ✓ {mf}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Investigator Action Panel & Priority Breakdown */}
        <div className="space-y-5">
          {/* Action Execution Workbench Panel */}
          <div className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B] shadow-lg space-y-4">
            <div className="flex items-center space-x-2 pb-2 border-b border-[#1E293B]">
              <Lock className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-bold text-white">Investigator Action Panel</h2>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Select an authorized dispute resolution action. All actions require pre-flight consequence inspection and human confirmation.
            </p>

            {executionResult && (
              <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-300 space-y-1">
                <div className="font-semibold flex items-center space-x-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Action Executed ({executionResult.environment})</span>
                </div>
                <p className="text-[11px] text-emerald-200">{executionResult.message}</p>
                <div className="text-[10px] text-emerald-400 font-mono">
                  Audit Ref: {executionResult.audit_event_id}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Select Action
                </label>
                <select
                  value={selectedActionType}
                  onChange={(e) => setSelectedActionType(e.target.value)}
                  className="w-full px-3 py-2 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-medium"
                >
                  <option value="PROVIDE_EVIDENCE">Provide Rebuttal Evidence (Submit Tracking)</option>
                  <option value="ACCEPT_CLAIM">Accept Claim & Settle (Authorize Refund)</option>
                  <option value="REQUEST_BUYER_INFO">Request Additional Buyer Clarification</option>
                  <option value="ESCALATE_TO_PAYPAL">Escalate to PayPal Specialist</option>
                </select>
              </div>

              {selectedActionType === 'PROVIDE_EVIDENCE' && (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Carrier</label>
                      <input
                        type="text"
                        value={carrierInput}
                        onChange={(e) => setCarrierInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#161F38] border border-[#233054] rounded text-xs text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Tracking Number</label>
                      <input
                        type="text"
                        value={trackingInput}
                        onChange={(e) => setTrackingInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#161F38] border border-[#233054] rounded text-xs text-slate-200 font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Investigator Notes / Rationale
                </label>
                <textarea
                  rows={2}
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  placeholder="Record justification and supporting evidence rationale for audit trail..."
                  className="w-full px-3 py-2 bg-[#161F38] border border-[#233054] rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <button
                onClick={handlePreviewAction}
                disabled={isPreviewLoading}
                className="w-full flex items-center justify-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-blue-600/30 transition disabled:opacity-50"
              >
                <span>{isPreviewLoading ? 'Inspecting Consequences...' : 'Review & Confirm Action'}</span>
              </button>
            </div>
          </div>

          {/* Priority Score Breakdown Card */}
          <div className="p-5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#1E293B]">
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Priority Score Factors
              </span>
              <PriorityBadge score={dispute.priority_score} />
            </div>

            <div className="space-y-2.5">
              {dispute.priority_factors.map((f, i) => (
                <div key={i} className="text-xs space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300">{f.name}</span>
                    <span className="font-mono text-blue-400">+{f.contribution.toFixed(1)} pts</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-tight">{f.explanation}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Action Confirmation Modal */}
      {previewData && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#0F172A] border border-[#233054] rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#1E293B] pb-3">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Confirm Consequential Dispute Action</h3>
              </div>
              <button
                onClick={() => setPreviewData(null)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-[#161F38]"
              >
                Cancel
              </button>
            </div>

            <div className="p-3.5 rounded-lg bg-[#161F38] border border-[#233054] text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Action:</span>
                <span className="font-bold text-white">{previewData.action_type}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Environment Target:</span>
                <span className="font-mono text-purple-300 font-semibold uppercase">{previewData.target_environment}</span>
              </div>
              <div className="text-slate-300 pt-1">
                <span className="font-semibold text-slate-200">Impact Summary: </span>
                {previewData.impact_summary}
              </div>
            </div>

            {previewData.warning_message && (
              <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800 text-xs text-amber-300 flex items-start space-x-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
                <span>{previewData.warning_message}</span>
              </div>
            )}

            <div className="p-3 rounded-lg bg-blue-950/20 border border-blue-800/40 text-[11px] text-slate-300">
              <span className="font-semibold text-blue-300">Human Approval Certification: </span>
              By confirming, you certify that you have reviewed the cited facts, shipment records, and evidentiary requirements.
            </div>

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-[#1E293B]">
              <button
                onClick={() => setPreviewData(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:text-white bg-[#161F38] hover:bg-[#233054]"
              >
                Cancel
              </button>
              <button
                onClick={() => executeActionMutation.mutate()}
                disabled={executeActionMutation.isPending}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/30 transition disabled:opacity-50"
              >
                {executeActionMutation.isPending ? 'Executing Action...' : 'Confirm & Execute Action'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
