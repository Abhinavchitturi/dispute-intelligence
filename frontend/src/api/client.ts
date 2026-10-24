import {
  DisputeSummary,
  DisputeDetail,
  TimelineEvent,
  InvestigationBrief,
  HistoricalCase,
  AuditEventItem,
  DashboardSummary,
  IntegrationStatus,
  ActionPreviewResult,
  ActionExecuteResult
} from '../types';

const API_BASE = '/api';

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const res = await fetch(`${API_BASE}/dashboard/summary`);
  if (!res.ok) throw new Error(`Failed to fetch dashboard summary: ${res.statusText}`);
  return res.json();
}

export async function fetchDisputes(params?: {
  search?: string;
  status?: string;
  reason?: string;
  source?: string;
  evidence_status?: string;
  priority_level?: string;
  sort_by?: string;
  sort_order?: string;
}): Promise<DisputeSummary[]> {
  const query = new URLSearchParams();
  if (params?.search) query.set('search', params.search);
  if (params?.status && params.status !== 'ALL') query.set('status', params.status);
  if (params?.reason && params.reason !== 'ALL') query.set('reason', params.reason);
  if (params?.source && params.source !== 'ALL') query.set('source', params.source);
  if (params?.evidence_status && params.evidence_status !== 'ALL') query.set('evidence_status', params.evidence_status);
  if (params?.priority_level && params.priority_level !== 'ALL') query.set('priority_level', params.priority_level);
  if (params?.sort_by) query.set('sort_by', params.sort_by);
  if (params?.sort_order) query.set('sort_order', params.sort_order);

  const res = await fetch(`${API_BASE}/disputes?${query.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch disputes: ${res.statusText}`);
  return res.json();
}

export async function fetchDisputeDetail(disputeId: string): Promise<DisputeDetail> {
  const res = await fetch(`${API_BASE}/disputes/${disputeId}`);
  if (!res.ok) throw new Error(`Failed to fetch dispute ${disputeId}`);
  return res.json();
}

export async function fetchDisputeTimeline(disputeId: string): Promise<TimelineEvent[]> {
  const res = await fetch(`${API_BASE}/disputes/${disputeId}/timeline`);
  if (!res.ok) throw new Error(`Failed to fetch timeline for dispute ${disputeId}`);
  return res.json();
}

export async function fetchInvestigationBrief(disputeId: string, forceRegenerate = false): Promise<InvestigationBrief> {
  const method = forceRegenerate ? 'POST' : 'GET';
  const url = `${API_BASE}/disputes/${disputeId}/brief${forceRegenerate ? '?force_regenerate=true' : ''}`;
  const res = await fetch(url, { method });
  if (!res.ok) throw new Error(`Failed to fetch investigation brief for dispute ${disputeId}`);
  return res.json();
}

export async function fetchSimilarCasesForDispute(disputeId: string): Promise<HistoricalCase[]> {
  const res = await fetch(`${API_BASE}/disputes/${disputeId}/similar-cases`);
  if (!res.ok) throw new Error(`Failed to fetch similar cases`);
  return res.json();
}

export async function searchHistoricalCases(params?: {
  reason?: string;
  outcome?: string;
  search?: string;
}): Promise<HistoricalCase[]> {
  const query = new URLSearchParams();
  if (params?.reason && params.reason !== 'ALL') query.set('reason', params.reason);
  if (params?.outcome && params.outcome !== 'ALL') query.set('outcome', params.outcome);
  if (params?.search) query.set('search', params.search);

  const res = await fetch(`${API_BASE}/similar-cases?${query.toString()}`);
  if (!res.ok) throw new Error(`Failed to search historical cases`);
  return res.json();
}

export async function fetchPatternInsights(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/patterns`);
  if (!res.ok) throw new Error(`Failed to fetch pattern insights`);
  return res.json();
}

export async function fetchAuditTrail(params?: {
  dispute_id?: string;
  action?: string;
  status?: string;
}): Promise<AuditEventItem[]> {
  const query = new URLSearchParams();
  if (params?.dispute_id) query.set('dispute_id', params.dispute_id);
  if (params?.action && params.action !== 'ALL') query.set('action', params.action);
  if (params?.status && params.status !== 'ALL') query.set('status', params.status);

  const res = await fetch(`${API_BASE}/audit-events?${query.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch audit events`);
  return res.json();
}

export async function fetchIntegrationStatus(): Promise<IntegrationStatus> {
  const res = await fetch(`${API_BASE}/integrations/status`);
  if (!res.ok) throw new Error(`Failed to fetch integrations status`);
  return res.json();
}

export async function testPayPalConnectivity(): Promise<any> {
  const res = await fetch(`${API_BASE}/integrations/paypal/test`, { method: 'POST' });
  return res.json();
}

export async function testAIConnectivity(): Promise<any> {
  const res = await fetch(`${API_BASE}/integrations/ai/test`, { method: 'POST' });
  return res.json();
}

export async function resetDemoData(): Promise<any> {
  const res = await fetch(`${API_BASE}/integrations/reset-demo-data`, { method: 'POST' });
  return res.json();
}

export async function previewAction(disputeId: string, payload: {
  action_type: string;
  notes?: string;
  evidence_type?: string;
  tracking_number?: string;
  carrier?: string;
}): Promise<ActionPreviewResult> {
  const res = await fetch(`${API_BASE}/disputes/${disputeId}/actions/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Failed to preview action');
  return res.json();
}

export async function executeAction(disputeId: string, payload: {
  action_type: string;
  confirmed: boolean;
  notes?: string;
  evidence_type?: string;
  tracking_number?: string;
  carrier?: string;
}): Promise<ActionExecuteResult> {
  const res = await fetch(`${API_BASE}/disputes/${disputeId}/actions/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to execute action');
  }
  return res.json();
}
