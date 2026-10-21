import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import Markdown from '@/components/Markdown';
import ConfirmDialog from '@/components/ConfirmDialog';
import { AlertIcon, CheckIcon, ClockIcon, CoinsIcon, ExternalIcon, InfoIcon, LoaderIcon, ShieldCheckIcon, XCircleIcon, ZapIcon } from '@/components/icons';
import { sub2api, sub2apiErrorCode } from '@/api/sub2api';
import { useSub2apiAccount } from '@/features/account/useSub2apiAccount';
import { useSub2apiBalance } from '@/features/account/useSub2apiBalance';
import {
  PRESET_AMOUNTS, amountFits, amountRange, formatPayment, formatPercent, formatUsd, matchTier, normalizeCheckoutInfo,
  orderOutcome, quoteRecharge, round, sortedMethodTypes, type CheckoutInfo, type OrderOutcome,
} from '@/features/recharge/rechargeQuote';
import { openExternal } from '@/utils/openExternal';

type Order = {
  orderId: number; outTradeNo: string; paymentType: string; qrCode: string; payUrl: string;
  payAmount: number; currency: string; credited: number; expiresAt: number;
};

const POLL_MS = 3000;
const VERIFY_INTERVAL_MS = 15_000;
const VERIFY_MAX_ATTEMPTS = 6;
const cardShell = 'rounded-2xl border border-[var(--line)] bg-[var(--paper-elevated)] shadow-[var(--shadow-xs)]';
const card = `${cardShell} p-5`;
const secondary = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50';
const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)] shadow-[var(--shadow-sm)] transition-[opacity,transform] hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100';

/** Brand tones for the built-in gateways; other methods use the app accent. */
const METHOD_BRAND: Record<string, { color: string; glyph: string }> = {
  alipay: { color: '#1677FF', glyph: '支' },
  wxpay: { color: '#07C160', glyph: '微' },
};

function errorText(t: (key: string, options?: Record<string, unknown>) => string, reason: unknown) {
  return t(`sub2api.errors.${sub2apiErrorCode(reason)}`, { defaultValue: t('sub2api.errors.UNKNOWN') });
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }

export default function Recharge({ isActive }: { isActive: boolean }) {
  const { t, i18n } = useTranslation('app');
  const locale = i18n.language;
  const { account } = useSub2apiAccount();
  const balance = useSub2apiBalance();
  const [info, setInfo] = useState<CheckoutInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [preset, setPreset] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [method, setMethod] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [outcome, setOutcome] = useState<OrderOutcome>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    if (!account.user) return;
    const current = ++sequence.current;
    setLoading(true); setLoadError(null);
    try {
      const next = normalizeCheckoutInfo(await sub2api.accountApi('checkout-info'));
      if (current === sequence.current) setInfo(next);
    } catch (reason) {
      if (current === sequence.current) setLoadError(errorText(t, reason));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [account.user, t]);
  useEffect(() => { if (isActive && !info) void load(); }, [info, isActive, load]);

  const methodTypes = useMemo(() => info ? sortedMethodTypes(info.methods) : [], [info]);
  const range = useMemo(() => info ? amountRange(info.methods) : { min: 0, max: 0 }, [info]);
  const presets = useMemo(() => PRESET_AMOUNTS.filter(value => (range.min <= 0 || value >= range.min) && (range.max <= 0 || value <= range.max)), [range]);
  const amount = custom.trim() ? round(Number(custom)) : preset ?? 0;
  const validAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const quote = useMemo(() => info ? quoteRecharge(info, validAmount) : null, [info, validAmount]);
  const currency = info?.methods[method]?.currency;
  const fmt = useCallback((value: number) => formatPayment(value, currency, locale), [currency, locale]);

  // Keep a usable method selected as the amount changes, like the web checkout.
  useEffect(() => {
    if (!info || !quote) return;
    if (amountFits(info.methods[method], quote.payBase) && info.methods[method]?.available) return;
    const next = methodTypes.find(type => info.methods[type]?.available && amountFits(info.methods[type], quote.payBase));
    if (next && next !== method) setMethod(next);
    else if (!method && methodTypes[0]) setMethod(methodTypes[0]);
  }, [info, method, methodTypes, quote]);

  const amountError = useMemo(() => {
    if (!info || !quote || validAmount <= 0) return '';
    if (!methodTypes.some(type => amountFits(info.methods[type], quote.payBase))) return t('sub2api.recharge.amountNoMethod');
    const limit = info.methods[method];
    if (limit?.single_min && quote.payBase < limit.single_min) return t('sub2api.recharge.amountTooLow', { min: fmt(limit.single_min) });
    if (limit?.single_max && quote.payBase > limit.single_max) return t('sub2api.recharge.amountTooHigh', { max: fmt(limit.single_max) });
    return '';
  }, [fmt, info, method, methodTypes, quote, t, validAmount]);
  const canSubmit = !!info && !!quote && validAmount > 0 && !amountError && !!info.methods[method]?.available && !submitting;

  const submit = async () => {
    if (!canSubmit || !quote) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const result = record(await sub2api.accountApi('create-order', { amount: validAmount, payment_type: method }));
      const next: Order = {
        orderId: Number(result.order_id) || 0,
        outTradeNo: String(result.out_trade_no ?? ''),
        paymentType: method,
        qrCode: String(result.qr_code ?? ''),
        payUrl: /^https?:\/\//i.test(String(result.pay_url ?? '')) ? String(result.pay_url) : '',
        payAmount: Number(result.pay_amount) || quote.total,
        currency: String(result.currency ?? currency ?? ''),
        credited: quote.credited,
        expiresAt: Date.parse(String(result.expires_at ?? '')) || Date.now() + 30 * 60_000,
      };
      if (!next.orderId || (!next.qrCode && !next.payUrl)) { setSubmitError(t('sub2api.recharge.unsupported')); return; }
      setOutcome(null);
      setOrder(next);
      if (!next.qrCode && next.payUrl) void openExternal(next.payUrl);
    } catch (reason) {
      setSubmitError(errorText(t, reason));
    } finally {
      setSubmitting(false);
    }
  };

  const refreshBalance = balance.refresh;
  const finish = () => { setOrder(null); setOutcome(null); void refreshBalance(); };
  const onSettled = useCallback((next: OrderOutcome) => {
    setOutcome(next);
    if (next === 'success') void refreshBalance();
  }, [refreshBalance]);

  if (!account.user) {
    return <Shell><div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--paper-inset)] text-[var(--ink-muted)]"><CoinsIcon className="h-6 w-6" /></span>
      <h2 className="mt-4 text-lg font-semibold">{t('sub2api.accountRequired')}</h2>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">{t('sub2api.recharge.signInHint')}</p>
      <button type="button" className={`${primary} mt-5 h-10`} onClick={() => window.dispatchEvent(new Event('sub2api-account:open-login'))}>{t('sub2api.signIn')}</button>
    </div></Shell>;
  }

  return <Shell>
    <header>
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">{t('sub2api.recharge.title')}</h1>
    </header>

    {order ? <PaymentPanel order={order} outcome={outcome} onSettled={onSettled} onDone={finish} fmt={(value) => formatPayment(value, order.currency || currency, locale)} />
      : loadError ? <div className={`${card} mt-6 flex flex-col items-center gap-3 py-12 text-center`}>
        <AlertIcon className="h-6 w-6 text-[var(--error)]" /><p role="alert" className="text-sm text-[var(--error)]">{loadError}</p>
        <button type="button" className={secondary} disabled={loading} onClick={() => void load()}>{t('sub2api.retry')}</button>
      </div>
      : !info ? <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label={t('sub2api.recharge.loading')}><LoaderIcon className="h-8 w-8 animate-spin text-[var(--ink-muted)]" /></div>
      : info.balance_disabled || methodTypes.length === 0 ? <div className={`${card} mt-6 py-14 text-center text-sm text-[var(--ink-muted)]`}>{t('sub2api.recharge.unavailable')}</div>
      : <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <section className={card} aria-labelledby="recharge-amount-title">
            <SectionTitle id="recharge-amount-title" step="1" title={t('sub2api.recharge.chooseAmount')} />
            {info.recharge_bonus_notice && <div className="mb-4 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3 text-sm leading-relaxed text-[var(--ink)]"><Markdown>{info.recharge_bonus_notice}</Markdown></div>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {presets.map(value => {
                const selected = !custom.trim() && preset === value;
                const tier = matchTier(info.recharge_bonus_tiers, value);
                const presetQuote = quoteRecharge(info, value);
                return <button key={value} type="button" aria-pressed={selected} onClick={() => { setPreset(value); setCustom(''); setSubmitError(null); }}
                  className={`group relative overflow-hidden rounded-xl border px-4 py-3.5 text-left transition-all ${selected ? 'border-[var(--accent)] bg-[var(--accent-warm-subtle)] ring-1 ring-[var(--accent)]' : 'border-[var(--line)] bg-[var(--paper)] hover:border-[var(--line-strong)] hover:bg-[var(--hover-bg)]'}`}>
                  {tier && tier.bonus_percent > 0 && <span className="absolute right-0 top-0 rounded-bl-lg bg-[var(--accent-warm)] px-2 py-0.5 text-xs font-semibold text-[var(--on-accent)]">
                    {info.recharge_bonus_mode === 'discount' ? t('sub2api.recharge.discountBadge', { percent: formatPercent(tier.bonus_percent) }) : t('sub2api.recharge.bonusBadge', { percent: formatPercent(tier.bonus_percent) })}
                  </span>}
                  <span className="block text-lg font-semibold tabular-nums text-[var(--ink)]">{fmt(value)}</span>
                  <span className="mt-0.5 block text-xs tabular-nums text-[var(--ink-muted)]">{t('sub2api.recharge.creditsTo', { amount: formatUsd(presetQuote.credited) })}</span>
                  {selected && <CheckIcon className="absolute bottom-2.5 right-2.5 h-4 w-4 text-[var(--accent)]" />}
                </button>;
              })}
            </div>
            <label className="mt-4 block">
              <span className="text-xs font-medium text-[var(--ink-muted)]">{t('sub2api.recharge.customAmount')}</span>
              <div className={`mt-1.5 flex items-center rounded-xl border bg-[var(--paper)] px-3 transition-colors focus-within:border-[var(--focus-border)] ${custom.trim() ? 'border-[var(--accent)]' : 'border-[var(--line)]'}`}>
                <span className="text-sm text-[var(--ink-muted)]">{fmt(0).replace(/[\d.,\s]/g, '') || '¥'}</span>
                <input inputMode="decimal" value={custom} onChange={event => { setCustom(event.target.value.replace(/[^\d.]/g, '')); setSubmitError(null); }}
                  placeholder={range.min > 0 || range.max > 0 ? t('sub2api.recharge.rangeHint', { min: fmt(range.min || 0.01), max: range.max ? fmt(range.max) : '∞' }) : t('sub2api.recharge.customPlaceholder')}
                  className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base tabular-nums text-[var(--ink)] outline-none placeholder:text-sm placeholder:text-[var(--ink-faint)]" />
              </div>
            </label>
            {amountError && <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--warning)]"><AlertIcon className="h-3.5 w-3.5" />{amountError}</p>}
          </section>

          <section className={card} aria-labelledby="recharge-method-title">
            <SectionTitle id="recharge-method-title" step="2" title={t('sub2api.recharge.chooseMethod')} />
            <div className="grid gap-3 sm:grid-cols-2">
              {methodTypes.map(type => {
                const limit = info.methods[type]!;
                const usable = limit.available && amountFits(limit, quote?.payBase ?? 0);
                const selected = method === type;
                const brand = METHOD_BRAND[type];
                return <button key={type} type="button" disabled={!usable} aria-pressed={selected} onClick={() => setMethod(type)}
                  className={`relative flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-45 ${selected ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : 'border-[var(--line)] hover:border-[var(--line-strong)] hover:bg-[var(--hover-bg)]'}`}
                  style={selected && brand ? { borderColor: brand.color, boxShadow: `0 0 0 1px ${brand.color}` } : undefined}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: brand?.color ?? 'var(--accent)' }}>{brand?.glyph ?? type.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[var(--ink)]">{limit.display_name || t(`sub2api.recharge.methods.${type}`, { defaultValue: type })}</span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--ink-muted)]">{!limit.available ? t('sub2api.recharge.methodUnavailable') : limit.fee_rate > 0 ? t('sub2api.recharge.methodFee', { rate: formatPercent(limit.fee_rate) }) : t('sub2api.recharge.rangeHint', { min: fmt(limit.single_min || 0.01), max: limit.single_max ? fmt(limit.single_max) : '∞' })}</span>
                  </span>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-transparent text-white' : 'border-[var(--line-strong)]'}`} style={selected ? { background: brand?.color ?? 'var(--accent)' } : undefined}>{selected && <CheckIcon className="h-3 w-3" />}</span>
                </button>;
              })}
            </div>
          </section>

          {(info.help_text || info.help_image_url) && <section className={`${card} flex flex-col gap-4 sm:flex-row sm:items-start`}>
            {info.help_image_url && <img src={info.help_image_url} alt="" className="h-36 w-auto max-w-full shrink-0 self-center rounded-xl object-contain" />}
            {info.help_text && <div className="min-w-0 flex-1 text-sm text-[var(--ink-secondary)]"><Markdown>{info.help_text}</Markdown></div>}
          </section>}
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <section className={card} aria-labelledby="recharge-summary-title">
            <h2 id="recharge-summary-title" className="text-sm font-semibold text-[var(--ink)]">{t('sub2api.recharge.summary')}</h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              <Row label={t('sub2api.recharge.amount')} value={validAmount > 0 ? fmt(validAmount) : '—'} strike={!!quote?.discount} />
              {!!quote?.discount && <Row label={t('sub2api.recharge.discount', { percent: formatPercent(quote.percent) })} value={`-${fmt(quote.discount)}`} tone="accent" />}
              {!!quote?.fee && <Row label={t('sub2api.recharge.fee', { rate: formatPercent(info.recharge_fee_rate) })} value={fmt(quote.fee)} />}
              {quote?.mode === 'bonus' && quote.bonus > 0 && <Row label={t('sub2api.recharge.bonus', { percent: formatPercent(quote.percent) })} value={`+${formatUsd(quote.bonus)}`} tone="accent" />}
              <Row label={t('sub2api.recharge.credited')} value={validAmount > 0 && quote ? formatUsd(quote.credited) : '—'} tone="success" />
            </dl>
            <div className="mt-4 flex items-baseline justify-between border-t border-[var(--line-subtle)] pt-4">
              <span className="text-sm font-medium text-[var(--ink-secondary)]">{t('sub2api.recharge.actualPay')}</span>
              <span className="text-2xl font-bold tabular-nums text-[var(--ink)]">{validAmount > 0 && quote ? fmt(quote.total) : '—'}</span>
            </div>
            {submitError && <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-lg bg-[var(--error-bg)] px-3 py-2 text-xs text-[var(--error)]"><AlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />{submitError}</p>}
            <button type="button" disabled={!canSubmit} onClick={() => void submit()} className={`${primary} mt-4 h-11 w-full text-base`}>
              {submitting ? <><LoaderIcon className="h-4 w-4 animate-spin" />{t('sub2api.processing')}</> : <><ZapIcon className="h-4 w-4" />{validAmount > 0 && quote ? t('sub2api.recharge.payNow', { amount: fmt(quote.total) }) : t('sub2api.recharge.pickAmount')}</>}
            </button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-[var(--ink-faint)]"><ShieldCheckIcon className="h-3.5 w-3.5" />{t('sub2api.recharge.secureHint')}</p>
          </section>
        </aside>
      </div>}
  </Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="h-full min-h-0 overflow-y-auto overscroll-contain bg-[var(--paper)] text-[var(--ink)]">
    <div className="mx-auto max-w-5xl px-8 pb-10 pt-7">{children}</div>
  </main>;
}

function SectionTitle({ id, step, title }: { id: string; step: string; title: string }) {
  return <h2 id={id} className="mb-4 flex items-center gap-2.5 text-sm font-semibold text-[var(--ink)]">
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ink)] text-xs font-bold text-[var(--paper)]">{step}</span>{title}
  </h2>;
}

function Row({ label, value, tone, strike }: { label: string; value: string; tone?: 'accent' | 'success'; strike?: boolean }) {
  const color = tone === 'accent' ? 'text-[var(--accent-warm)]' : tone === 'success' ? 'text-[var(--success)] font-semibold' : 'text-[var(--ink)]';
  return <div className="flex items-center justify-between gap-3">
    <dt className="text-[var(--ink-muted)]">{label}</dt>
    <dd className={`tabular-nums ${strike ? 'text-[var(--ink-faint)] line-through' : color}`}>{value}</dd>
  </div>;
}

function PaymentPanel({ order, outcome, onSettled, onDone, fmt }: { order: Order; outcome: OrderOutcome; onSettled: (outcome: OrderOutcome) => void; onDone: () => void; fmt: (value: number) => string }) {
  const { t } = useTranslation('app');
  const [qr, setQr] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const brand = METHOD_BRAND[order.paymentType];
  const remaining = Math.max(0, Math.floor((order.expiresAt - now) / 1000));

  useEffect(() => {
    if (!order.qrCode) { setQr(''); return; }
    let cancelled = false;
    QRCode.toDataURL(order.qrCode, { width: 440, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } })
      .then(url => { if (!cancelled) setQr(url); }).catch(() => { if (!cancelled) setQr(''); });
    return () => { cancelled = true; };
  }, [order.qrCode]);

  // Same cadence as sub2api's PaymentStatusPanel: poll the order every 3s and,
  // for built-in gateways, ask the server to re-verify with the provider every
  // 15s (bounded) in case the asynchronous notify was missed.
  useEffect(() => {
    if (outcome) return;
    let inFlight = false; let settled = false; let verifyAttempts = 0; let lastVerify = Date.now();
    const settle = (next: OrderOutcome) => { if (next && !settled) { settled = true; onSettled(next); } };
    const poll = async () => {
      if (inFlight || settled) return;
      inFlight = true;
      try {
        let current = record(await sub2api.accountApi('get-order', { id: order.orderId }));
        const pending = String(current.status ?? '').toUpperCase() === 'PENDING';
        if (pending && order.outTradeNo && METHOD_BRAND[order.paymentType] && verifyAttempts < VERIFY_MAX_ATTEMPTS && Date.now() - lastVerify >= VERIFY_INTERVAL_MS) {
          verifyAttempts += 1; lastVerify = Date.now();
          try { current = record(await sub2api.accountApi('verify-order', { out_trade_no: order.outTradeNo })); } catch { /* keep polling */ }
        }
        settle(orderOutcome(current.status));
      } catch { /* transient network errors keep the loop alive */ } finally { inFlight = false; }
    };
    const pollTimer = window.setInterval(() => void poll(), POLL_MS);
    const clock = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= order.expiresAt) settle('expired');
    }, 1000);
    return () => { window.clearInterval(pollTimer); window.clearInterval(clock); };
  }, [onSettled, order, outcome]);

  const cancel = async () => {
    setConfirmCancel(false); setCancelling(true); setError(null);
    try { await sub2api.accountApi('cancel-order', { id: order.orderId }); onSettled('cancelled'); }
    catch (reason) { setError(errorText(t, reason)); }
    finally { setCancelling(false); }
  };

  if (outcome) {
    const success = outcome === 'success';
    return <section className={`${card} mx-auto mt-6 flex max-w-md flex-col items-center px-8 py-10 text-center`}>
      <span className={`flex h-16 w-16 items-center justify-center rounded-full ${success ? 'bg-[var(--success-bg)] text-[var(--success)]' : 'bg-[var(--paper-inset)] text-[var(--ink-muted)]'}`}>
        {success ? <CheckIcon className="h-8 w-8" strokeWidth={2.5} /> : outcome === 'expired' ? <ClockIcon className="h-8 w-8" /> : <XCircleIcon className="h-8 w-8" />}
      </span>
      <h2 className="mt-5 text-xl font-semibold text-[var(--ink)]">{t(`sub2api.recharge.outcome.${outcome}`)}</h2>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">{success ? t('sub2api.recharge.outcome.successHint', { amount: formatUsd(order.credited) }) : t('sub2api.recharge.outcome.retryHint')}</p>
      <button type="button" onClick={onDone} className={`${primary} mt-7 h-10 w-full`}>{success ? t('sub2api.recharge.again') : t('sub2api.recharge.backToRecharge')}</button>
    </section>;
  }

  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  return <section className={`${cardShell} mx-auto mt-6 max-w-md overflow-hidden`}>
    <div className="px-8 pb-6 pt-7 text-center" style={brand ? { background: `linear-gradient(180deg, ${brand.color}14, transparent)` } : undefined}>
      <p className="text-sm font-medium text-[var(--ink-muted)]">{order.qrCode ? t(`sub2api.recharge.scan.${order.paymentType}`, { defaultValue: t('sub2api.recharge.scan.default') }) : t('sub2api.recharge.payInBrowser')}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-[var(--ink)]">{fmt(order.payAmount)}</p>
      {order.qrCode ? <div className="relative mx-auto mt-5 w-fit rounded-2xl border-2 bg-white p-3" style={{ borderColor: brand?.color ?? 'var(--line)' }}>
        {qr ? <img src={qr} alt={t('sub2api.recharge.qrAlt')} className="h-52 w-52" /> : <div className="flex h-52 w-52 items-center justify-center"><LoaderIcon className="h-6 w-6 animate-spin text-[var(--ink-muted)]" /></div>}
        {brand && qr && <span className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl text-base font-bold text-white ring-4 ring-white" style={{ background: brand.color }}>{brand.glyph}</span>}
      </div> : <div className="mx-auto mt-6 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--paper-inset)]"><LoaderIcon className="h-8 w-8 animate-spin text-[var(--accent)]" /></div>}
      <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-[var(--ink-muted)]"><LoaderIcon className="h-3 w-3 animate-spin" />{t('sub2api.recharge.waiting')}</p>
    </div>
    <dl className="space-y-2 border-t border-[var(--line-subtle)] px-8 py-4 text-sm">
      <Row label={t('sub2api.recharge.credited')} value={formatUsd(order.credited)} tone="success" />
      <Row label={t('sub2api.recharge.orderNo')} value={order.outTradeNo ? order.outTradeNo.replace(/^sub2_/i, '') : `#${order.orderId}`} />
      <Row label={t('sub2api.recharge.expiresIn')} value={`${minutes}:${seconds}`} />
    </dl>
    {error && <p role="alert" className="mx-8 mb-3 rounded-lg bg-[var(--error-bg)] px-3 py-2 text-xs text-[var(--error)]">{error}</p>}
    <div className="flex gap-2 border-t border-[var(--line-subtle)] px-8 py-4">
      {order.payUrl && <button type="button" className={`${secondary} flex-1`} onClick={() => void openExternal(order.payUrl)}><ExternalIcon className="h-4 w-4" />{t('sub2api.recharge.openPayPage')}</button>}
      <button type="button" className={`${secondary} flex-1`} disabled={cancelling} onClick={() => setConfirmCancel(true)}>{cancelling ? t('sub2api.processing') : t('sub2api.cancelOrder')}</button>
    </div>
    <p className="flex items-center justify-center gap-1.5 bg-[var(--paper-inset)] px-6 py-2.5 text-xs text-[var(--ink-muted)]"><InfoIcon className="h-3.5 w-3.5" />{t('sub2api.recharge.autoRefresh')}</p>
    {confirmCancel && <ConfirmDialog title={t('sub2api.cancelOrder')} message={t('sub2api.cancelOrderConfirm')} confirmVariant="danger" confirmText={t('sub2api.cancelOrder')} cancelText={t('sub2api.back')} onConfirm={() => void cancel()} onCancel={() => setConfirmCancel(false)} />}
  </section>;
}
