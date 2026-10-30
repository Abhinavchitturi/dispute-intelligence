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
  ActionExecuteResult,
  ActionDraft,
  EvidenceRequestOptions,
  DisputeMessage,
  MessageThreadSummary,
  EvidenceSummary,
  SessionUser,
  Notifications,
  ManagerAlert,
  TeamMember,
  CaseFlag,
  TrainingRow,
  CaseEmail,
  AppealInfo,
  ManagedUser,
  CaseRequest,
  DistributionPlan,
  DistributionResult,
  CaseCollaborators,
  Person
} from '../types';

const API_BASE = '/api';

export async function fetchDashboardSummary(assignee?: string): Promise<DashboardSummary> {
  const res = await fetch(`${API_BASE}/dashboard/summary${assignee ? `?assignee=${encodeURIComponent(assignee)}` : ''}`);
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
  assigned_to?: string;
  high_profile?: boolean;
  unassigned?: boolean;
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
  if (params?.assigned_to) query.set('assigned_to', params.assigned_to);
  if (params?.high_profile) query.set('high_profile', 'true');
  if (params?.unassigned) query.set('unassigned', 'true');
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

export async function fetchEvidenceOptions(disputeId: string): Promise<EvidenceRequestOptions> {
  const res = await fetch(`${API_BASE}/disputes/${disputeId}/evidence-requests/options`);
  if (!res.ok) throw new Error('Failed to fetch evidence options');
  return res.json();
}

export async function previewAction(disputeId: string, payload: {
  action_type: string;
  notes?: string;
  requested_evidence?: string[];
  deadline_days?: number;
}): Promise<ActionPreviewResult> {
  const res = await fetch(`${API_BASE}/disputes/${disputeId}/actions/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Failed to preview action');
  return res.json();
}

export async function draftActionMessage(disputeId: string, payload: {
  action_type: string;
  requested_evidence?: string[];
  deadline_days?: number;
}): Promise<ActionDraft> {
  const res = await fetch(`${API_BASE}/disputes/${disputeId}/actions/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Failed to draft message');
  return res.json();
}

export async function executeAction(disputeId: string, payload: {
  action_type: string;
  confirmed: boolean;
  message?: string;
  subject?: string;
  notes?: string;
  requested_evidence?: string[];
  deadline_days?: number;
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

export async function fetchHealth(): Promise<{ status: string; mode: string }> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Backend unreachable');
  return res.json();
}

export async function fetchMessageThreads(): Promise<MessageThreadSummary[]> {
  const res = await fetch(`${API_BASE}/message-threads`);
  if (!res.ok) throw new Error('Failed to fetch message threads');
  return res.json();
}

export async function fetchDisputeMessages(disputeId: string): Promise<DisputeMessage[]> {
  const res = await fetch(`${API_BASE}/disputes/${disputeId}/messages`);
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
}

export async function markMessagesRead(disputeId: string): Promise<{ marked_read: number }> {
  const res = await fetch(`${API_BASE}/disputes/${disputeId}/messages/read`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to mark messages read');
  return res.json();
}

export async function simulateReply(messageId: string): Promise<DisputeMessage> {
  const res = await fetch(`${API_BASE}/messages/${messageId}/simulate-reply`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to simulate reply');
  }
  return res.json();
}

async function post<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || fallback);
  }
  return res.json();
}

export async function fetchEvidenceSummary(disputeId: string): Promise<EvidenceSummary> {
  const res = await fetch(`${API_BASE}/disputes/${disputeId}/evidence-summary`);
  if (!res.ok) throw new Error('Failed to fetch evidence summary');
  return res.json();
}

/** The investigator's call. It goes to an admin; nobody is told until the admin confirms. */
export function submitDecision(disputeId: string, payload: { outcome: 'BUYER_FAVOR' | 'SELLER_FAVOR'; reason: string }) {
  return post<{ message: string; status: string }>(`/disputes/${disputeId}/decision`, { ...payload, confirmed: true }, 'Failed to submit the decision');
}

export function managerReview(disputeId: string, payload: { action: 'APPROVE' | 'OVERRIDE' | 'REOPEN'; outcome?: string; note?: string }) {
  return post<{ message: string; status: string }>(`/disputes/${disputeId}/admin-review`, payload, 'Failed to review the decision');
}

export function assignDispute(disputeId: string, assignee: string | null) {
  return post<{ assigned_to: string | null }>(`/disputes/${disputeId}/assign`, { assignee }, 'Failed to update the owner of this case');
}

export function declareFromParty(disputeId: string, party: 'SELLER' | 'BUYER', kind: 'SETTLED' | 'WITHDRAWN') {
  return post<DisputeMessage>(`/disputes/${disputeId}/parties/${party}/declare`, { kind }, 'Failed to record that');
}

/** The generated document for a piece of evidence, as HTML (or SVG for a photo placeholder). */
export async function fetchEvidencePreview(evidenceId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/evidence/${encodeURIComponent(evidenceId)}/preview`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'No preview available');
  }
  return res.text();
}

export async function login(username: string, password: string): Promise<{ token: string; user: SessionUser }> {
  return post(`/auth/login`, { username, password }, 'Could not sign in');
}

export async function fetchMe(): Promise<SessionUser> {
  const res = await fetch(`${API_BASE}/auth/me`);
  if (!res.ok) throw new Error('Not signed in');
  return res.json();
}

async function get<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : err.detail?.message || fallback);
  }
  return res.json();
}

export const fetchNotifications = () => get<Notifications>('/notifications', 'Failed to load notifications');
export const markNotificationsRead = () => post<{ marked_read: number }>('/notifications/read', {}, 'Failed to mark read');
export const sortAlert = (id: string, note?: string) => post<ManagerAlert>(`/alerts/${id}/sorted`, { note }, 'Failed to mark this sorted');
export const fetchTeam = () => get<TeamMember[]>('/team', 'Failed to load the team');
export const unblockUser = (id: string, note?: string) => post<{ success: boolean }>(`/team/${id}/unblock`, { note }, 'Failed to unblock');
export const fetchFlags = (status?: string, disputeId?: string) => get<CaseFlag[]>(`/flags?${new URLSearchParams({ ...(status ? { status } : {}), ...(disputeId ? { dispute_id: disputeId } : {}) })}`, 'Failed to load flags');
export const raiseFlag = (disputeId: string, points: string) => post<{ flag_id: string }>(`/disputes/${disputeId}/flag`, { points }, 'Failed to raise the flag');
export const resolveFlag = (id: string, action: 'UPHOLD_AI' | 'OVERTURN', note: string) => post<CaseFlag>(`/flags/${id}/resolve`, { action, note }, 'Failed to resolve the flag');
export const reviseDecision = (disputeId: string, outcome: string, note: string) => post<{ outcome: string }>(`/disputes/${disputeId}/revise`, { outcome, note }, 'Failed to overturn the decision');
export const fetchTraining = () => get<TrainingRow[]>('/ai-training', 'Failed to load the AI feedback');
export const fetchCaseEmails = (disputeId: string) => get<CaseEmail[]>(`/disputes/${disputeId}/emails`, 'Failed to load emails');
export const fetchAppeals = (disputeId: string) => get<AppealInfo>(`/disputes/${disputeId}/appeals`, 'Failed to load appeals');
export const simulateAiVerdict = (disputeId: string, verdict: 'APPROVE' | 'OVERTURN', outcome: string | undefined, rationale: string) =>
  post<{ status: string; outcome: string }>(`/disputes/${disputeId}/ai-verdict/simulate`, { verdict, outcome, rationale }, 'Failed to record the AI verdict');
export const simulateAppealEmail = (disputeId: string, party: 'BUYER' | 'SELLER', body: string) =>
  post<{ opened: boolean; appeal_id?: string; reason?: string }>(`/disputes/${disputeId}/appeal/simulate`, { party, body }, 'Failed to send the email');

async function send<T>(method: 'PATCH', url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : fallback);
  }
  return res.json();
}

export const fetchUsers = () => get<ManagedUser[]>('/users', 'Failed to load users');
export const createUser = (u: { username: string; display_name: string; role: string; password: string; email?: string }) => post<ManagedUser>('/users', u, 'Failed to add the user');
export const updateUser = (id: string, changes: { display_name?: string; email?: string; role?: string; is_active?: boolean }) => send<ManagedUser>('PATCH', `/users/${id}`, changes, 'Failed to update the user');
export const resetPassword = (id: string, password: string) => post<{ success: boolean }>(`/users/${id}/password`, { password }, 'Failed to reset the password');
export const blockUser = (id: string, reason: string) => post<ManagedUser>(`/users/${id}/block`, { reason }, 'Failed to block the user');

export const fetchDistributionPlan = () => get<DistributionPlan>('/cases/distribution', 'Failed to load the cases waiting');
export const distributeCases = (p: { counts?: Record<string, number>; investigator_ids?: string[]; per_person?: number; include_high_profile?: boolean }) => post<DistributionResult>('/cases/distribute', p, 'Failed to hand out the cases');
export const fetchCaseRequests = (status?: string) => get<CaseRequest[]>(`/case-requests${status ? `?status=${status}` : ''}`, 'Failed to load case requests');
export const requestCases = (note?: string) => post<CaseRequest>('/case-requests', { note }, 'Failed to ask for cases');
export const declineCaseRequest = (id: string, note: string) => post<CaseRequest>(`/case-requests/${id}/decline`, { note }, 'Failed to decline');

export const recordReply = (disputeId: string, messageId: string, provided: { evidence_type: string; file_name?: string }[], note?: string) =>
  post<DisputeMessage>(`/disputes/${disputeId}/replies/${messageId}/record`, { provided, note }, 'Failed to record the reply');
export const simulateEmailReply = (disputeId: string, party: 'SELLER' | 'BUYER', body: string, attachments: string[]) =>
  post<{ message_id?: string }>(`/disputes/${disputeId}/inbound/simulate`, { party, body, attachments }, 'Failed to send the email');

export const fetchPeople = () => get<Person[]>('/people', 'Failed to load the team');
export const fetchCollaborators = (disputeId: string) => get<CaseCollaborators>(`/disputes/${disputeId}/collaborators`, 'Failed to load who is on this case');
export const shareCase = (disputeId: string, userId: string) => post<{ name: string }>(`/disputes/${disputeId}/collaborators`, { user_id: userId }, 'Failed to add them to the case');
export async function unshareCase(disputeId: string, userId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/disputes/${disputeId}/collaborators/${userId}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to take them off the case');
  }
}
