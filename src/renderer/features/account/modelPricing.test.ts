import { describe, expect, it } from 'vitest';
import { buildModelPrices, formatUsd } from './modelPricing';

const plaza = {
  groups: [
    {
      id: 1,
      rate_multiplier: 2,
      models: [{ name: 'shared', pricing: { input_price: 1e-6, output_price: 2e-6 }, official_pricing: { input_price: 1e-6, output_price: 2e-6 } }],
    },
    {
      id: 35,
      rate_multiplier: 1,
      user_rate_multiplier: 0.8,
      models: [
        { name: 'shared', pricing: { input_price: 2.5e-6, output_price: 1.5e-5 }, official_pricing: { input_price: 5e-6, output_price: 3e-5 } },
        { name: 'image', pricing: { billing_mode: 'image', per_request_price: 0.05 }, official_pricing: null },
      ],
    },
  ],
};

describe('model plaza prices', () => {
  it('prefers the app key group and applies the user rate', () => {
    const price = buildModelPrices(plaza, 35).get('shared')!;
    expect(price.input).toBeCloseTo(2);
    expect(price.output).toBeCloseTo(12);
    expect(price.officialOutput).toBeCloseTo(30);
    expect(price.ratio).toBeCloseTo(0.4);
  });

  it('falls back to another visible group and hides a non-discount', () => {
    const price = buildModelPrices(plaza, 999).get('shared')!;
    expect(price.output).toBeCloseTo(4);
    expect(price.ratio).toBeNull();
  });

  it('keeps per-request prices and tolerates a missing plaza', () => {
    expect(buildModelPrices(plaza, 35).get('image')?.perRequest).toBeCloseTo(0.04);
    expect(buildModelPrices(undefined).size).toBe(0);
  });

  it('formats small amounts without trailing zeros', () => {
    expect(formatUsd(2.5)).toBe('$2.5');
    expect(formatUsd(0.025)).toBe('$0.025');
  });
  it('lists long-context tiers with labels, and only the base tier when tiers are off', () => {
    const tiered = {
      groups: [{
        id: 1, rate_multiplier: 1, long_context_pricing_enabled: true,
        models: [{ name: 'm', pricing: { input_price: 1e-6, intervals: [
          { min_tokens: 200000, max_tokens: null, input_price: 2e-6 },
          { min_tokens: 0, max_tokens: 200000, input_price: 1e-6, cache_write_price: 1.25e-6, cache_write_1h_price: 2e-6 },
        ] }, official_pricing: null }],
      }],
    };
    const price = buildModelPrices(tiered).get('m')!;
    expect(price.tiers.map(tier => tier.label)).toEqual(['≤200K', '>200K']);
    expect(price.tiers[0].cacheWrite1h).toBeCloseTo(2);
    expect(price.officialTiers).toEqual([]);

    tiered.groups[0].long_context_pricing_enabled = false;
    expect(buildModelPrices(tiered).get('m')!.tiers).toHaveLength(1);
  });
});
