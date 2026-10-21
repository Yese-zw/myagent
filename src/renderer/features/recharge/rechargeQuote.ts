// Pure recharge pricing helpers mirrored from sub2api's checkout page
// (`utils/rechargeBonus.ts`, `components/payment/paymentFlow.ts`). The server
// re-quotes every order; these only keep the desktop preview identical to what
// the gateway will charge and credit.

export interface MethodLimit {
  currency?: string;
  display_name?: string;
  daily_limit: number;
  daily_used: number;
  daily_remaining: number;
  single_min: number;
  single_max: number;
  fee_rate: number;
  available: boolean;
}

export interface RechargeBonusTier { min_amount: number; bonus_percent: number }
export type RechargeBonusMode = 'bonus' | 'discount';

export interface CheckoutInfo {
  methods: Record<string, MethodLimit>;
  balance_disabled: boolean;
  balance_recharge_multiplier: number;
  recharge_fee_rate: number;
  recharge_bonus_tiers: RechargeBonusTier[];
  recharge_bonus_mode: RechargeBonusMode;
  recharge_bonus_notice: string;
  help_text: string;
  help_image_url: string;
}

export interface RechargeQuote {
  mode: RechargeBonusMode;
  /** Matched tier percent; 0 when no promotion applies. */
  percent: number;
  /** Gateway charge base in payment currency, before fees. */
  payBase: number;
  /** Discount off the entered amount (discount mode only). */
  discount: number;
  fee: number;
  /** Final amount the user pays in payment currency. */
  total: number;
  /** Free USD credit: extra bonus, or the unpaid part in discount mode. */
  bonus: number;
  /** Total USD credited to the balance. */
  credited: number;
}

export type OrderOutcome = 'success' | 'cancelled' | 'expired' | null;

const EPSILON = 1e-9;
/** Desktop opens hosted checkout in the system browser or shows a QR code.
 * Stripe / Airwallex need the sub2api-hosted Elements page with a browser
 * session, so they are not offered here. */
const DESKTOP_METHOD_ALIASES: Record<string, string> = { alipay: 'alipay', alipay_direct: 'alipay', wxpay: 'wxpay', wxpay_direct: 'wxpay' };
const UNSUPPORTED_METHODS = new Set(['stripe', 'airwallex']);
export const METHOD_ORDER = ['alipay', 'wxpay'];
export const PRESET_AMOUNTS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

function num(value: unknown, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
export function round(value: number, digits = 2) { if (!Number.isFinite(value)) return 0; const f = 10 ** digits; return Math.round((value + Number.EPSILON) * f) / f; }
function ceil(value: number, digits = 2) { if (!Number.isFinite(value)) return 0; const f = 10 ** digits; return Math.ceil(value * f - EPSILON) / f; }

function normalizeTiers(raw: unknown): RechargeBonusTier[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tiers: RechargeBonusTier[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const min = Number((item as RechargeBonusTier).min_amount); const percent = Number((item as RechargeBonusTier).bonus_percent);
    if (!Number.isFinite(min) || min < 0 || !Number.isFinite(percent) || percent < 0 || percent > 1000) continue;
    const key = round(min).toFixed(2);
    if (seen.has(key)) continue;
    seen.add(key); tiers.push({ min_amount: min, bonus_percent: percent });
  }
  return tiers.sort((a, b) => a.min_amount - b.min_amount);
}

function normalizeMethod(raw: unknown): MethodLimit {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    currency: typeof value.currency === 'string' ? value.currency : undefined,
    display_name: typeof value.display_name === 'string' ? value.display_name : undefined,
    daily_limit: num(value.daily_limit), daily_used: num(value.daily_used), daily_remaining: num(value.daily_remaining),
    single_min: num(value.single_min), single_max: num(value.single_max), fee_rate: num(value.fee_rate),
    available: value.available !== false,
  };
}

export function normalizeCheckoutInfo(raw: unknown): CheckoutInfo {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const methods: Record<string, MethodLimit> = {};
  const source = value.methods && typeof value.methods === 'object' ? value.methods as Record<string, unknown> : {};
  for (const [type, limit] of Object.entries(source)) {
    if (UNSUPPORTED_METHODS.has(type)) continue;
    const visible = DESKTOP_METHOD_ALIASES[type] ?? type.trim();
    if (!visible) continue;
    // The canonical entry wins over its `_direct` alias, as on the web page.
    if (!methods[visible] || type === visible) methods[visible] = normalizeMethod(limit);
  }
  const multiplier = num(value.balance_recharge_multiplier, 1);
  return {
    methods,
    balance_disabled: value.balance_disabled === true,
    balance_recharge_multiplier: multiplier > 0 ? multiplier : 1,
    recharge_fee_rate: Math.max(0, num(value.recharge_fee_rate)),
    recharge_bonus_tiers: normalizeTiers(value.recharge_bonus_tiers),
    recharge_bonus_mode: String(value.recharge_bonus_mode ?? '').trim().toLowerCase() === 'discount' ? 'discount' : 'bonus',
    recharge_bonus_notice: typeof value.recharge_bonus_notice === 'string' ? value.recharge_bonus_notice.trim() : '',
    help_text: typeof value.help_text === 'string' ? value.help_text.trim() : '',
    help_image_url: typeof value.help_image_url === 'string' && /^(https:|data:image\/)/.test(value.help_image_url) ? value.help_image_url : '',
  };
}

export function sortedMethodTypes(methods: Record<string, MethodLimit>) {
  return Object.keys(methods).sort((a, b) => {
    const ai = METHOD_ORDER.indexOf(a); const bi = METHOD_ORDER.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
  });
}

export function matchTier(tiers: RechargeBonusTier[], amount: number): RechargeBonusTier | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  let matched: RechargeBonusTier | null = null;
  for (const tier of tiers) if (amount + EPSILON >= tier.min_amount && (!matched || tier.min_amount > matched.min_amount)) matched = tier;
  return matched;
}

/** Same rules as sub2api `quoteRechargeBonus` plus the page's fee math. */
export function quoteRecharge(info: Pick<CheckoutInfo, 'recharge_bonus_tiers' | 'recharge_bonus_mode' | 'balance_recharge_multiplier' | 'recharge_fee_rate'>, amount: number): RechargeQuote {
  const value = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const rate = info.balance_recharge_multiplier;
  const base = round(value * rate);
  const quote: RechargeQuote = { mode: info.recharge_bonus_mode, percent: 0, payBase: value, discount: 0, fee: 0, total: value, bonus: 0, credited: base };
  const tier = matchTier(info.recharge_bonus_tiers, value);
  if (tier && tier.bonus_percent > 0) {
    if (quote.mode === 'discount') {
      const payBase = round((value * (100 - tier.bonus_percent)) / 100);
      if (tier.bonus_percent < 100 && payBase > 0 && payBase < value) {
        quote.payBase = payBase;
        quote.discount = round(value - payBase);
        quote.bonus = Math.max(0, round(base - round(payBase * rate)));
        quote.percent = tier.bonus_percent;
      }
    } else {
      const bonus = round((base * tier.bonus_percent) / 100);
      if (bonus > 0) { quote.bonus = bonus; quote.credited = round(base + bonus); quote.percent = tier.bonus_percent; }
    }
  }
  if (info.recharge_fee_rate > 0 && quote.payBase > 0) quote.fee = ceil((quote.payBase * info.recharge_fee_rate) / 100);
  quote.total = round(quote.payBase + quote.fee);
  return quote;
}

export function amountFits(limit: MethodLimit | undefined, amount: number) {
  if (!limit) return false;
  if (amount <= 0) return true;
  if (limit.single_min > 0 && amount < limit.single_min) return false;
  if (limit.single_max > 0 && amount > limit.single_max) return false;
  return true;
}

/** Widest range across visible methods; 0 means unbounded. */
export function amountRange(methods: Record<string, MethodLimit>) {
  const limits = Object.values(methods);
  if (limits.length === 0) return { min: 0, max: 0 };
  return {
    min: limits.some(l => l.single_min <= 0) ? 0 : Math.min(...limits.map(l => l.single_min)),
    max: limits.some(l => l.single_max <= 0) ? 0 : Math.max(...limits.map(l => l.single_max)),
  };
}

export function orderOutcome(status: unknown): OrderOutcome {
  const value = String(status ?? '').trim().toUpperCase();
  if (value === 'COMPLETED' || value === 'PAID' || value === 'RECHARGING') return 'success';
  if (value === 'CANCELLED') return 'cancelled';
  if (value === 'EXPIRED' || value === 'FAILED') return 'expired';
  return null;
}

export function formatPayment(amount: number, currency?: string, locale?: string) {
  const code = /^[A-Z]{3}$/.test(String(currency ?? '').toUpperCase()) ? String(currency).toUpperCase() : 'CNY';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${code} ${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
  }
}

export function formatUsd(amount: unknown) { const n = Number(amount); return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`; }
export function formatPercent(value: number) { return String(Number(value.toFixed(2))); }
