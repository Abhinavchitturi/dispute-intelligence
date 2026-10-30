export interface PriorityFactor {
  name: string;
  weight: number;
  contribution: number;
  explanation: string;
}

export interface DisputeSummary {
  id: string;
  external_dispute_id: string | null;
  source: 'synthetic' | 'paypal_sandbox';
  transaction_id: string | null;
  order_id: string | null;
  buyer_reference: string | null;
  merchant_reference: string | null;
  reason: string;
  status: string;
  amount: number;
  currency: string;
  response_due_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  priority_score: number;
  priority_factors: PriorityFactor[];
  evidence_status: string;
  buyer_claim: string | null;
  outcome: Outcome | null;
  assigned_to: string | null;
  proposed_outcome: 'BUYER_FAVOR' | 'SELLER_FAVOR' | null;
  proposed_reason: string | null;
  proposed_by: string | null;
  proposed_at: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  seller_settled_at: string | null;
  buyer_settled_at: string | null;
}

/** How a case ended. SETTLED = both sides said so. DISMISSED = the buyer withdrew. */
export type Outcome = 'BUYER_FAVOR' | 'SELLER_FAVOR' | 'SETTLED' | 'DISMISSED';

/** Something the buyer said that needs following up, and whether the proof is on the case. */
export interface ClaimPoint {
  key: string;
  label: string;
  quote: string;
  note: string;
  on_file: boolean;
  evidence_type: string | null;
  party: 'SELLER' | 'BUYER' | null;
}

export interface TransactionInfo {
  id: string;
  external_transaction_id: string | null;
  source: string;
  amount: number;
  currency: string;
  status: string;
  transaction_date: string | null;
  related_order_id: string | null;
  payment_method: string | null;
  buyer_email_masked: string | null;
}

export interface ShipmentInfo {
  id: string;
  order_id: string;
  source: string;
  tracking_reference: string | null;
  status: string;
  carrier: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  delivery_address_match: 'unknown' | 'yes' | 'no';
  shipping_address_masked: string | null;
  destination_city: string | null;
}

export interface OrderInfo {
  id: string;
  external_order_id: string | null;
  source: string;
  item_summary: string;
  order_date: string | null;
  amount: number;
  currency: string;
  merchant_reference: string | null;
  shipment: ShipmentInfo | null;
}

export interface EvidenceItem {
  id: string;
  dispute_id: string;
  evidence_type: string;
  description: string;
  source_record_id: string | null;
  source: string;
  submitted_at: string | null;
  availability_status: 'AVAILABLE' | 'MISSING' | 'PENDING_VERIFICATION' | 'NOT_REQUESTED';
  metadata_json: string | null;
  created_at: string | null;
}

export interface DisputeDetail extends DisputeSummary {
  transaction: TransactionInfo | null;
  order: OrderInfo | null;
  evidence_items: EvidenceItem[];
  latest_brief_id: string | null;
  claim_points: ClaimPoint[];
}

export interface Finding {
  finding_id: string;
  claim: string;
  classification: 'fact' | 'inference' | 'unknown';
  source_record_ids: string[];
  explanation: string;
  confidence_label: string | null;
  verification_status: 'verified' | 'unverified' | 'contradicted';
}

export interface EvidenceGap {
  evidence_type: string;
  reason_required: string;
  current_status: string;
  supporting_record_ids: string[];
  suggested_follow_up: string;
}

export interface Recommendation {
  recommendation: string;
  rationale: string;
  supporting_record_ids: string[];
  limitations: string;
  human_review_required: boolean;
}

export interface InvestigationBrief {
  id: string;
  dispute_id: string;
  generated_at: string;
  provider: string;
  model: string | null;
  summary: string;
  structured_findings: Finding[];
  evidence_gaps: EvidenceGap[];
  recommendations: Recommendation[];
  generation_status: 'SUCCESS' | 'FAILED' | 'FALLBACK';
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  event_type: 'PAYMENT' | 'ORDER' | 'SHIPMENT' | 'DISPUTE' | 'EVIDENCE' | 'INVESTIGATOR_ACTION';
  title: string;
  description: string;
  source: string;
  source_record_id: string | null;
  status: string | null;
  claim_points?: ClaimPoint[];
}

export interface HistoricalCase {
  id: string;
  source: string;
  reason: string;
  case_summary: string;
  evidence_attributes: Record<string, any>;
  outcome: string | null;
  created_at: string | null;
  amount: number | null;
  currency: string;
  similarity_score?: number | null;
  matching_factors?: string[];
}

export interface AuditEventItem {
  id: string;
  dispute_id: string | null;
  actor: string;
  action: string;
  status: string;
  source: string;
  request_reference: string | null;
  result_summary: string;
  error_code: string | null;
  created_at: string;
}

export interface DashboardSummary {
  environment_mode: string;
  total_open_disputes: number;
  approaching_deadline_count: number;
  missing_evidence_count: number;
  awaiting_review_count: number;
  new_cases_count: number;
  waiting_on_parties_count: number;
  my_cases_count: number;
  pending_admin_review_count: number;
  disputes_by_reason: { reason: string; count: number }[];
  priority_distribution: { high: number; medium: number; low: number };
  recent_activity: any[];
  action_outcomes_summary: { success: number; failed: number; pending: number };
}

export interface IntegrationStatus {
  environment_mode: string;
  paypal: {
    environment: string;
    base_url: string;
    configured: boolean;
    client_id_configured: boolean;
    client_secret_configured: boolean;
  };
  ai_provider: {
    provider: string;
    model: string;
    configured: boolean;
    fallback_available: boolean;
  };
  database: {
    type: string;
    url_sanitized: string;
  };
  features_available: Record<string, boolean>;
}

export interface ActionPreviewResult {
  dispute_id: string;
  action_type: string;
  is_supported: boolean;
  requires_confirmation: boolean;
  impact_summary: string;
  warning_message: string | null;
  target_environment: string;
  api_endpoint: string | null;
}

export interface ActionExecuteResult {
  success: boolean;
  action_type: string;
  dispute_id: string;
  message: string;
  audit_event_id: string;
  environment: string;
  message_id?: string | null;
  details?: any;
}

export interface ActionDraft {
  dispute_id: string;
  action_type: string;
  recipient: string;
  subject: string;
  body: string;
  cited_record_ids: string[];
  warnings: string[];
  notes?: string[];
  source: 'rules' | 'llm';
  model: string | null;
  evidence_balance?: EvidenceBalance | null;
}

/** Facts from the case sorted by which side they support. A summary of the records, not a verdict. */
export interface EvidenceBalance {
  toward_buyer: string[];
  toward_seller: string[];
  other: string[];
}

export interface DisputeMessage {
  id: string;
  dispute_id: string;
  direction: 'OUTBOUND' | 'INBOUND';
  counterparty: 'SELLER' | 'BUYER';
  action_type: string | null;
  subject: string;
  body: string;
  source: 'synthetic' | 'paypal_sandbox';
  awaiting_reply: boolean;
  reply_due_at: string | null;
  in_reply_to: string | null;
  is_read: boolean;
  requested_evidence: string[];
  provided_evidence: string[];
  unavailable_evidence: string[];
  deadline: string | null;
  created_at: string;
}

export interface MessageThreadSummary {
  dispute_id: string;
  buyer_reference: string | null;
  merchant_reference: string | null;
  reason: string;
  amount: number;
  currency: string;
  dispute_status: string;
  state: 'WAITING' | 'YOUR_TURN' | 'IN_REVIEW' | 'CLOSED';
  waiting_on: 'Seller' | 'Buyer' | 'Seller and buyer' | null;
  last_message_preview: string;
  last_message_at: string;
  last_direction: 'OUTBOUND' | 'INBOUND';
  unread_count: number;
  message_count: number;
  awaiting_since: string | null;
  expected_reply_at: string | null;
  simulated: boolean;
  pending_message_ids: string[];
  outcome: Outcome | null;
  assigned_to?: string | null;
}

export interface EvidenceRequestOption {
  evidence_type: string;
  label: string;
  why: string;
  on_file: boolean;
  on_file_description: string | null;
  suggested: boolean;
}

export interface EvidenceRequestOptions {
  seller: EvidenceRequestOption[];
  buyer: EvidenceRequestOption[];
}

/** One line of the per-side evidence checklist. Missing items say why. */
export interface EvidenceLine {
  evidence_type: string;
  label: string;
  party: 'SELLER' | 'BUYER' | null;
  status: 'PROVIDED' | 'MISSING';
  detail: string;
  why: string;
  description: string | null;
  evidence_id: string | null;
  provided_at: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  storage: string | null;
  preview: 'DOCUMENT' | 'IMAGE' | null;  // null for video: the demo never generates one
  is_video: boolean;
}

export interface EvidenceSummary {
  seller: EvidenceLine[];
  buyer: EvidenceLine[];
  records: EvidenceLine[];
}

export type Role = 'investigator' | 'admin';
