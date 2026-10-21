export interface AffiliateInvitee {
  user_id: number;
  email: string;
  username: string;
  created_at: string;
  total_rebate: number;
}

export interface AffiliateDetail {
  user_id: number;
  aff_code: string;
  inviter_id: number | null;
  aff_count: number;
  aff_quota: number;
  aff_frozen_quota: number;
  aff_history_quota: number;
  effective_rebate_rate_percent: number;
  invitees: AffiliateInvitee[];
}

export interface AffiliateTransferResult {
  transferred_quota: number;
  balance: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function money(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

export function formatRebateRate(value: unknown): string {
  const rounded = Math.round(num(value) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function inviteLink(serverUrl: string, code: string): string {
  const origin = serverUrl.replace(/\/+$/, '');
  return `${origin}/register?aff=${encodeURIComponent(code)}`;
}

export function normalizeAffiliateDetail(value: unknown): AffiliateDetail {
  const source = record(value);
  const invitees = Array.isArray(source.invitees) ? source.invitees : [];
  return {
    user_id: num(source.user_id),
    aff_code: text(source.aff_code).trim(),
    inviter_id: source.inviter_id == null ? null : num(source.inviter_id) || null,
    aff_count: num(source.aff_count),
    aff_quota: num(source.aff_quota),
    aff_frozen_quota: num(source.aff_frozen_quota),
    aff_history_quota: num(source.aff_history_quota),
    effective_rebate_rate_percent: num(source.effective_rebate_rate_percent),
    invitees: invitees.flatMap(item => {
      const row = record(item);
      const id = num(row.user_id);
      if (id <= 0) return [];
      return [{
        user_id: id,
        email: text(row.email),
        username: text(row.username),
        created_at: text(row.created_at),
        total_rebate: num(row.total_rebate),
      }];
    }),
  };
}

export function normalizeAffiliateTransfer(value: unknown): AffiliateTransferResult {
  const source = record(value);
  return { transferred_quota: num(source.transferred_quota), balance: num(source.balance) };
}
