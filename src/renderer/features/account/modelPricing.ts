/** Model-plaza prices for the available-models list, matching the sub2api plaza page:
 *  current = channel unit price × effective rate (user rate, else group rate);
 *  official = the catalog reference price; discount = current ÷ official. */

const PER_MILLION = 1_000_000;

interface PlazaTokenPrices {
  input_price?: number | null;
  output_price?: number | null;
  cache_write_price?: number | null;
  cache_write_1h_price?: number | null;
  cache_read_price?: number | null;
}

interface PlazaInterval extends PlazaTokenPrices {
  min_tokens?: number;
  max_tokens?: number | null;
  tier_label?: string;
}

interface PlazaPricing extends PlazaTokenPrices {
  billing_mode?: string;
  per_request_price?: number | null;
  intervals?: PlazaInterval[] | null;
}

interface PlazaModel {
  name?: string;
  platform?: string;
  pricing?: PlazaPricing | null;
  official_pricing?: (PlazaTokenPrices & { intervals?: PlazaInterval[] | null }) | null;
}

interface PlazaGroup {
  id?: number;
  rate_multiplier?: number;
  user_rate_multiplier?: number | null;
  long_context_pricing_enabled?: boolean;
  models?: PlazaModel[];
}

/** One context-length tier, USD per 1M tokens. `label` is null for single-tier models. */
export interface PriceTier {
  label: string | null;
  input: number | null;
  output: number | null;
  cacheWrite: number | null;
  cacheWrite1h: number | null;
  cacheRead: number | null;
}

export interface ModelPrice {
  /** Platform id from the plaza (openai, anthropic, ...); null when absent. */
  platform: string | null;
  /** USD per 1M tokens after the group rate; null when the plaza has no token price. */
  input: number | null;
  output: number | null;
  officialInput: number | null;
  officialOutput: number | null;
  /** USD per request for per-request / image billing. */
  perRequest: number | null;
  /** current ÷ official, only when it is a real discount (below 1). */
  ratio: number | null;
  /** Detailed tiers for the expanded row: what you pay, and the official reference. */
  tiers: PriceTier[];
  officialTiers: PriceTier[];
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function perMillion(value: unknown, rate = 1): number | null {
  const n = finite(value);
  return n == null ? null : n * rate * PER_MILLION;
}

function tokenCount(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}M`;
  if (n >= 1000) return `${Number((n / 1000).toFixed(2))}K`;
  return String(n);
}

function tierLabel(interval: PlazaInterval): string {
  const label = interval.tier_label?.trim();
  if (label) return label;
  const max = finite(interval.max_tokens);
  return max == null ? `>${tokenCount(finite(interval.min_tokens) ?? 0)}` : `≤${tokenCount(max)}`;
}

function tier(prices: PlazaTokenPrices, rate: number, label: string | null): PriceTier {
  return {
    label,
    input: perMillion(prices.input_price, rate),
    output: perMillion(prices.output_price, rate),
    cacheWrite: perMillion(prices.cache_write_price, rate),
    cacheWrite1h: perMillion(prices.cache_write_1h_price, rate),
    cacheRead: perMillion(prices.cache_read_price, rate),
  };
}

/** Multi-tier models list each context tier; others collapse to one unlabeled row. */
function tiersFor(prices: (PlazaTokenPrices & { intervals?: PlazaInterval[] | null }) | null | undefined, rate: number, allowTiers: boolean): PriceTier[] {
  if (!prices) return [];
  const intervals = [...(prices.intervals ?? [])].sort((a, b) => (finite(a.min_tokens) ?? 0) - (finite(b.min_tokens) ?? 0));
  if (allowTiers && intervals.length > 1) return intervals.map(interval => tier(interval, rate, tierLabel(interval)));
  const base = tier(prices, rate, null);
  return [base.input, base.output, base.cacheWrite, base.cacheRead].some(value => value != null) ? [base] : [];
}

function priceFor(group: PlazaGroup, model: PlazaModel): ModelPrice {
  const rate = finite(group.user_rate_multiplier) ?? finite(group.rate_multiplier) ?? 1;
  const pricing = model.pricing ?? {};
  const official = model.official_pricing ?? {};
  const input = perMillion(pricing.input_price, rate);
  const output = perMillion(pricing.output_price, rate);
  const officialInput = perMillion(official.input_price);
  const officialOutput = perMillion(official.output_price);
  const perRequestBase = finite(pricing.per_request_price);
  // Compare on the side both prices have, output first (it dominates cost).
  const pair: [number | null, number | null] = output != null && officialOutput
    ? [output, officialOutput]
    : [input, officialInput];
  const ratio = pair[0] != null && pair[1] ? pair[0] / pair[1] : null;
  return {
    platform: model.platform?.trim() || null,
    input,
    output,
    officialInput,
    officialOutput,
    perRequest: perRequestBase == null ? null : perRequestBase * rate,
    ratio: ratio != null && ratio < 0.995 ? ratio : null,
    // A group without long-context billing charges only the base tier.
    tiers: tiersFor(model.pricing, rate, group.long_context_pricing_enabled !== false),
    officialTiers: tiersFor(model.official_pricing, 1, true),
  };
}

/** Price per model name. The app key's group wins; other visible groups fill the rest. */
export function buildModelPrices(plaza: unknown, appGroupId?: number | null): Map<string, ModelPrice> {
  const groups: PlazaGroup[] = Array.isArray((plaza as { groups?: unknown })?.groups)
    ? (plaza as { groups: PlazaGroup[] }).groups
    : [];
  const ordered = [...groups].sort((a, b) => Number(b.id === appGroupId) - Number(a.id === appGroupId));
  const prices = new Map<string, ModelPrice>();
  for (const group of ordered) {
    for (const model of group.models ?? []) {
      const name = model.name?.trim();
      if (name && !prices.has(name)) prices.set(name, priceFor(group, model));
    }
  }
  return prices;
}

/** `$2.5` style amount with up to 4 significant decimals for tiny prices. */
export function formatUsd(value: number): string {
  const digits = value >= 1 ? 2 : value >= 0.01 ? 4 : 6;
  return `$${Number(value.toFixed(digits))}`;
}

const PLATFORM_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  grok: 'Grok',
  composite: 'Composite',
};

/** Display name of a plaza platform id; unknown ids show as sent. */
export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform.toLowerCase()] ?? platform;
}
