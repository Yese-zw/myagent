import { describe, expect, it } from 'vitest';
import { amountRange, normalizeCheckoutInfo, orderOutcome, quoteRecharge, sortedMethodTypes } from './rechargeQuote';

const limit = (overrides = {}) => ({ single_min: 1, single_max: 1000, fee_rate: 0, available: true, daily_limit: 0, daily_used: 0, daily_remaining: 0, ...overrides });

describe('recharge checkout parity with sub2api', () => {
  it('folds _direct aliases into one visible method and drops browser-only providers', () => {
    const info = normalizeCheckoutInfo({
      methods: { wxpay_direct: limit({ fee_rate: 1 }), alipay_direct: limit(), alipay: limit({ fee_rate: 2 }), stripe: limit(), airwallex: limit() },
    });
    expect(sortedMethodTypes(info.methods)).toEqual(['alipay', 'wxpay']);
    expect(info.methods.alipay?.fee_rate).toBe(2);
    expect(amountRange(info.methods)).toEqual({ min: 1, max: 1000 });
  });

  it('adds the matched bonus tier on top of the multiplied credit', () => {
    const info = normalizeCheckoutInfo({ balance_recharge_multiplier: 0.5, recharge_bonus_tiers: [{ min_amount: 100, bonus_percent: 10 }, { min_amount: 50, bonus_percent: 5 }] });
    expect(quoteRecharge(info, 100)).toMatchObject({ percent: 10, payBase: 100, total: 100, bonus: 5, credited: 55 });
    expect(quoteRecharge(info, 49)).toMatchObject({ percent: 0, bonus: 0, credited: 24.5 });
  });

  it('discounts the charge and rounds the fee up in discount mode', () => {
    const info = normalizeCheckoutInfo({ recharge_bonus_mode: 'discount', recharge_fee_rate: 0.6, recharge_bonus_tiers: [{ min_amount: 100, bonus_percent: 20 }] });
    expect(quoteRecharge(info, 100)).toMatchObject({ payBase: 80, discount: 20, fee: 0.48, total: 80.48, bonus: 20, credited: 100 });
  });

  it('treats paid and recharging orders as successful', () => {
    expect(orderOutcome('RECHARGING')).toBe('success');
    expect(orderOutcome('FAILED')).toBe('expired');
    expect(orderOutcome('PENDING')).toBeNull();
  });
});
