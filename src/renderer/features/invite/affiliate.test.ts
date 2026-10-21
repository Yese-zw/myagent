import { describe, expect, it } from 'vitest';
import { formatRebateRate, inviteLink, money, normalizeAffiliateDetail, normalizeAffiliateTransfer } from './affiliate';

describe('affiliate helpers', () => {
  it('normalizes affiliate detail and invite links', () => {
    const detail = normalizeAffiliateDetail({
      user_id: 9,
      aff_code: '  ABC12  ',
      inviter_id: null,
      aff_count: '3',
      aff_quota: 12.5,
      aff_frozen_quota: 1,
      aff_history_quota: 20,
      effective_rebate_rate_percent: 12.5,
      invitees: [{ user_id: 4, email: 'a@example.test', username: 'Ada', created_at: '2026-10-20T00:00:00Z', total_rebate: 2 }],
    });
    expect(detail).toMatchObject({ aff_code: 'ABC12', aff_count: 3, aff_quota: 12.5, invitees: [{ user_id: 4, email: 'a@example.test' }] });
    expect(inviteLink('https://lingsiai.vip/', detail.aff_code)).toBe('https://lingsiai.vip/register?aff=ABC12');
    expect(money(detail.aff_quota)).toBe('$12.50');
    expect(formatRebateRate(20)).toBe('20');
    expect(formatRebateRate(12.5)).toBe('12.5');
  });

  it('drops invitees without a user id', () => {
    expect(normalizeAffiliateDetail({ invitees: [{ email: 'ghost@example.test' }] }).invitees).toEqual([]);
    expect(normalizeAffiliateTransfer({ transferred_quota: '4.2', balance: 10 })).toEqual({ transferred_quota: 4.2, balance: 10 });
  });
});
