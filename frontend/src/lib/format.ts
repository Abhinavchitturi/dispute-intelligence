import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** The API sends UTC timestamps without a timezone marker. Without this, browsers read them as local time and every clock is off by the UTC offset. */
export function parseServerDate(value: string | number | Date): Date {
  if (typeof value !== 'string') return new Date(value);
  return new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
}

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const REASONS: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  UNAUTHORISED: 'Unauthorized',
  CANCELLED_OR_RETURNED: 'Cancelled or returned',
  DUPLICATE_TRANSACTION: 'Duplicate charge',
};

export const titleCase = (s: string) =>
  s.replace(/_/g, ' ').toLowerCase().replace(/^\w|\s\w/g, (c) => c.toUpperCase());

export interface EvidenceMeta {
  provided_by?: 'SELLER' | 'BUYER';
  file_name?: string;
  content_type?: string;
  size_bytes?: number;
  duration_seconds?: number;
  storage?: string;
}

/** Evidence carries extra facts (who supplied it, file details) as JSON text. Tolerates anything malformed. */
export function evidenceMeta(raw: string | null | undefined): EvidenceMeta {
  try { return raw ? (JSON.parse(raw) as EvidenceMeta) : {}; } catch { return {}; }
}

export const fileSize = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(0)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

/** Past cases use MERCHANT_FAVOR/BUYER_FAVOR/SETTLED/DISMISSED. PayPal's words for the seller side are "seller". */
export const pastOutcomeLabel = (o: string | null | undefined) =>
  !o ? 'Pending' : o === 'MERCHANT_FAVOR' || o === 'SELLER_FAVOR' ? "Seller's favor" : o === 'BUYER_FAVOR' ? "Buyer's favor" : o.charAt(0) + o.slice(1).toLowerCase();

// Names for what can be asked of the seller or buyer. Mirrors the server's catalog so every screen says the same thing.
const EVIDENCE_LABELS: Record<string, string> = {
  PROOF_OF_DELIVERY_SIGNATURE: 'Proof of delivery signature',
  ADDRESS_VERIFICATION: 'Address verification',
  CARRIER_TRACKING: 'Carrier tracking',
  MERCHANT_CORRESPONDENCE: 'Messages with the buyer',
  PROOF_OF_FULFILLMENT: 'Proof of fulfillment',
  BUYER_CAMERA_FOOTAGE: 'Camera footage',
  DELIVERY_ADDRESS_CONFIRMATION: 'Delivery address confirmation',
  BUYER_PHOTOS_OF_ITEM: 'Photos of the item',
  BUYER_STATEMENT: 'Written statement',
  RETURN_RECEIPT: 'Return receipt',
  REFUND_RECORD: 'Refund record',
  BUYER_RETURN_PROOF: 'Proof of return',
  RETURN_CARRIER_TRACKING: 'Return tracking',
};
export const evidenceLabel = (type: string) => EVIDENCE_LABELS[type] ?? type.replace(/^BUYER_/, '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export const sentenceCase = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Makes raw codes in server-written text readable: MERCHANDISE_OR_SERVICE_NOT_RECEIVED -> Item not received, DELIVERED -> delivered.
 *  Record IDs like DEMO-ORD-1042 and short codes like UPS or USD are left alone. */
export const prettifyCodes = (text: string) =>
  text.replace(/(?<![-\w])[A-Z]{4,}(?:_[A-Z]+)*(?![-\w])/g, (m) => (m.includes('_') ? (REASONS[m] ?? sentenceCase(m)) : m.toLowerCase()));

export const reasonLabel = (reason: string) => REASONS[reason] ?? titleCase(reason);

export type Tone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger' | 'info' | 'violet';

// PayPal's view of a case. OPEN = nobody has been asked yet. WAITING_* = a party owes us evidence. UNDER_REVIEW = evidence is in, PayPal decides.
export const OPEN_STATUSES = ['OPEN', 'WAITING_FOR_SELLER_RESPONSE', 'WAITING_FOR_BUYER_RESPONSE', 'WAITING_FOR_BOTH_RESPONSES', 'UNDER_REVIEW'];
export const WAITING_STATUSES = ['WAITING_FOR_SELLER_RESPONSE', 'WAITING_FOR_BUYER_RESPONSE', 'WAITING_FOR_BOTH_RESPONSES'];
export const isClosed = (status: string) => status === 'RESOLVED' || status === 'CLOSED';

export function statusMeta(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'OPEN': return { label: 'New', tone: 'brand' };
    case 'WAITING_FOR_SELLER_RESPONSE': return { label: 'Waiting on seller', tone: 'info' };
    case 'WAITING_FOR_BUYER_RESPONSE': return { label: 'Waiting on buyer', tone: 'info' };
    case 'WAITING_FOR_BOTH_RESPONSES': return { label: 'Waiting on both', tone: 'info' };
    case 'UNDER_REVIEW': return { label: 'Ready to decide', tone: 'violet' };
    case 'RESOLVED': return { label: 'Resolved', tone: 'success' };
    case 'CLOSED': return { label: 'Closed', tone: 'success' };
    default: return { label: titleCase(status), tone: 'neutral' };
  }
}

export function outcomeMeta(outcome: string | null | undefined): { label: string; tone: Tone } | null {
  if (outcome === 'BUYER_FAVOR') return { label: "Buyer's favor", tone: 'warn' };
  if (outcome === 'SELLER_FAVOR') return { label: "Seller's favor", tone: 'success' };
  return null;
}

export function priorityMeta(score: number): { label: string; tone: Tone } {
  if (score >= 70) return { label: 'CRITICAL', tone: 'danger' };
  if (score >= 40) return { label: 'MEDIUM', tone: 'warn' };
  return { label: 'LOW', tone: 'success' };
}

export const money = (amount: number, currency = 'USD') =>
  `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function timeLeft(due: string | null, now = Date.now()): { text: string; tone: Tone; hours: number | null } {
  if (!due) return { text: 'No deadline', tone: 'neutral', hours: null };
  const ms = parseServerDate(due).getTime() - now;
  const hours = ms / 3_600_000;
  if (ms <= 0) return { text: 'Overdue', tone: 'danger', hours };
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  const m = Math.floor((ms / 60_000) % 60);
  const text = d >= 2 ? `${d} days left` : hours >= 1 ? `${d ? d + 'd ' : ''}${h}h ${m}m left` : `${m}m left`;
  return { text, tone: hours <= 24 ? 'danger' : hours <= 48 ? 'warn' : 'neutral', hours };
}

export function timeAgo(ts: string | number | Date, now = Date.now()) {
  const s = Math.max(0, Math.round((now - parseServerDate(ts).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const isUrgent = (score: number) => score >= 70;
export const needsEvidence = (s: string) => s === 'MISSING' || s === 'CONFLICTING';
