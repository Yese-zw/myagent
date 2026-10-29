import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import Markdown from '@/components/Markdown';
import ConfirmDialog from '@/components/ConfirmDialog';
import { AlertIcon, ArrowRightIcon, CheckIcon, ClockIcon, CoinsIcon, ExternalIcon, InfoIcon, LoaderIcon, StarIcon, XCircleIcon } from '@/components/icons';
import { sub2api, sub2apiErrorCode } from '@/api/sub2api';
import { useSub2apiAccount } from '@/features/account/useSub2apiAccount';
import { useSub2apiBalance } from '@/features/account/useSub2apiBalance';
import { useProductName } from '@/features/account/useProductName';
import {
  PRESET_AMOUNTS, amountFits, amountRange, creditForPayAmount, formatPayment, formatPercent, formatUsd, orderOutcome,
  normalizeCheckoutInfo, payAmountForCredit, quoteRecharge, round, sortedMethodTypes, type CheckoutInfo, type OrderOutcome,
} from '@/features/recharge/rechargeQuote';
import alipayIcon from '@/assets/brand/alipay.svg';
import wxpayIcon from '@/assets/brand/wxpay.svg';
import { openExternal } from '@/utils/openExternal';
import '@/features/recharge/rechargeGlass.css';

type Order = {
  orderId: number; outTradeNo: string; paymentType: string; qrCode: string; payUrl: string;
  payAmount: number; currency: string; credited: number; expiresAt: number;
};

const POLL_MS = 3000;
const VERIFY_INTERVAL_MS = 15_000;
const VERIFY_MAX_ATTEMPTS = 6;
const card = 'rx-glass rx-panel';
const secondary = 'rx-ghost inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--rx-line)] px-4 py-2 text-sm font-medium text-[var(--rx-ink-2)] transition-colors hover:bg-[var(--rx-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50';

/** Brand colors and marks for the built-in gateways (same as sub2api). */
const METHOD_BRAND: Record<string, { color: string; icon: string; glyph: string }> = {
  alipay: { color: '#02A9F1', icon: alipayIcon, glyph: '支' },
  wxpay: { color: '#09BB07', icon: wxpayIcon, glyph: '微' },
};

function errorText(t: (key: string, options?: Record<string, unknown>) => string, reason: unknown) {
  return t(`sub2api.errors.${sub2apiErrorCode(reason)}`, { defaultValue: t('sub2api.errors.UNKNOWN') });
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
const usdText = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Recharge({ isActive }: { isActive: boolean }) {
  const { t, i18n } = useTranslation('app');
  const locale = i18n.language;
  const { account } = useSub2apiAccount();
  const balance = useSub2apiBalance();
  const brandName = useProductName('灵思AGENT');
  const [info, setInfo] = useState<CheckoutInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** USD the user wants credited (before any bonus). */
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
  // Gateway limits are in payment currency; the page works in USD credit.
  const range = useMemo(() => info ? amountRange(info.methods) : { min: 0, max: 0 }, [info]);
  const usdRange = useMemo(() => info ? { min: creditForPayAmount(info, range.min), max: creditForPayAmount(info, range.max) } : { min: 0, max: 0 }, [info, range]);
  const presets = useMemo(() => info ? PRESET_AMOUNTS.filter(usd => {
    const pay = payAmountForCredit(info, usd);
    return (range.min <= 0 || pay >= range.min) && (range.max <= 0 || pay <= range.max);
  }) : [], [info, range]);
  const target = custom.trim() ? round(Number(custom)) : preset ?? 0;
  const validTarget = Number.isFinite(target) && target > 0 ? target : 0;
  const payAmount = info ? payAmountForCredit(info, validTarget) : 0;
  const quote = useMemo(() => info ? quoteRecharge(info, payAmount) : null, [info, payAmount]);
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
    if (!info || !quote || validTarget <= 0) return '';
    if (!methodTypes.some(type => amountFits(info.methods[type], quote.payBase))) return t('sub2api.recharge.amountNoMethod');
    const limit = info.methods[method];
    if (limit?.single_min && quote.payBase < limit.single_min) return t('sub2api.recharge.amountTooLow', { min: `${formatUsd(creditForPayAmount(info, limit.single_min))} (${fmt(limit.single_min)})` });
    if (limit?.single_max && quote.payBase > limit.single_max) return t('sub2api.recharge.amountTooHigh', { max: `${formatUsd(creditForPayAmount(info, limit.single_max))} (${fmt(limit.single_max)})` });
    return '';
  }, [fmt, info, method, methodTypes, quote, t, validTarget]);
  const canSubmit = !!info && !!quote && validTarget > 0 && payAmount > 0 && !amountError && !!info.methods[method]?.available && !submitting;

  const submit = async () => {
    if (!canSubmit || !quote) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const result = record(await sub2api.accountApi('create-order', { amount: payAmount, payment_type: method }));
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
    return <Shell><div className="rx-glass rx-empty mt-6">
      <span className="rx-empty__orb" aria-hidden="true" />
      <CoinsIcon className="relative h-6 w-6 text-[var(--rx-muted)]" />
      <h2 className="relative mt-3 text-lg font-semibold">{t('sub2api.accountRequired')}</h2>
      <p className="relative mt-1 text-sm text-[var(--rx-muted)]">{t('sub2api.recharge.signInHint')}</p>
      <button type="button" className="rx-cta relative mt-5 !w-auto px-8" onClick={() => window.dispatchEvent(new Event('sub2api-account:open-login'))}>
        <span className="rx-cta__content">{t('sub2api.signIn')}</span>
      </button>
    </div></Shell>;
  }

  const credited = validTarget > 0 && quote ? quote.credited : 0;
  const meterFill = Math.min(0.94, Math.max(0.16, Math.log1p(validTarget) / Math.log1p(usdRange.max > 0 ? usdRange.max : 5000))).toFixed(3);
  const rangeHint = usdRange.min > 0 && usdRange.max > 0 ? `${formatUsd(usdRange.min)} – ${formatUsd(usdRange.max)}`
    : usdRange.min > 0 ? `≥ ${formatUsd(usdRange.min)}` : usdRange.max > 0 ? `≤ ${formatUsd(usdRange.max)}` : '';
  const brandColor = METHOD_BRAND[method]?.color ?? 'var(--rx-accent)';

  return <Shell>
    {order ? <PaymentPanel order={order} outcome={outcome} onSettled={onSettled} onDone={finish} fmt={(value) => formatPayment(value, order.currency || currency, locale)} />
      : loadError ? <div className={`${card} mt-2 flex flex-col items-center gap-3 py-12 text-center`}>
        <AlertIcon className="h-6 w-6 text-[var(--error)]" /><p role="alert" className="text-sm text-[var(--error)]">{loadError}</p>
        <button type="button" className={secondary} disabled={loading} onClick={() => void load()}>{t('sub2api.retry')}</button>
      </div>
      : !info ? <div className="rx-skeleton" role="status" aria-label={t('sub2api.recharge.loading')}>
        <div className="rx-skeleton__hero"><span className="rx-skeleton__card" /></div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"><span className="rx-skeleton__panel h-80" /><span className="rx-skeleton__panel h-80" /></div>
      </div>
      : info.balance_disabled || methodTypes.length === 0 ? <div className="rx-glass rx-empty"><span className="rx-empty__orb" aria-hidden="true" /><p className="relative text-sm text-[var(--rx-muted)]">{t('sub2api.recharge.unavailable')}</p></div>
      : <div className="space-y-6">
        <BalanceCard brand={brandName} balance={balance.balance ?? 0} credit={credited} username={account.user.username || account.user.email} userId={account.user.id} />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-6">
            <section className={`${card} rx-rise`} style={{ '--rx-i': 2 } as CSSProperties} aria-labelledby="recharge-amount-title">
              <header className="rx-section-head">
                <span className="rx-section-head__index">01</span>
                <h2 id="recharge-amount-title" className="rx-section-head__title">{t('sub2api.recharge.chooseAmount')}</h2>
                {rangeHint && <span className="rx-section-head__hint">{rangeHint}</span>}
              </header>
              {info.recharge_bonus_notice && <div className="rx-notice">
                <span className="rx-notice__icon" aria-hidden="true"><StarIcon /></span>
                <div className="rx-notice__body"><Markdown>{info.recharge_bonus_notice}</Markdown></div>
              </div>}
              <div className="rx-amount">
                <div>
                  <p className="rx-amount__label">{t('sub2api.recharge.quickAmounts')}</p>
                  <div className="rx-amount__grid">
                    {presets.map((usd, index) => {
                      const selected = !custom.trim() && preset === usd;
                      const tileQuote = quoteRecharge(info, payAmountForCredit(info, usd));
                      const promo = tileQuote.percent > 0;
                      return <button key={usd} type="button" aria-pressed={selected} data-testid={`quick-amount-${usd}`}
                        className={`rx-tile ${selected ? 'is-selected' : ''} ${promo ? 'is-promo' : ''}`} style={{ '--rx-i': index } as CSSProperties}
                        onPointerMove={trackPointer} onClick={() => { setPreset(usd); setCustom(''); setSubmitError(null); }}>
                        <span className="rx-tile__ring" aria-hidden="true" />
                        <span className="rx-tile__spot" aria-hidden="true" />
                        {promo && <span className="rx-tile__badge">{info.recharge_bonus_mode === 'discount' ? `${formatPercent(tileQuote.percent)}% OFF` : `+${formatPercent(tileQuote.percent)}%`}</span>}
                        <span className="rx-tile__value"><span className="rx-tile__symbol">$</span>{usd}</span>
                        <span className="rx-tile__meta">{t('sub2api.recharge.needPay', { amount: fmt(tileQuote.total) })}</span>
                        <span className="rx-tile__check" aria-hidden="true"><CheckIcon strokeWidth={2.5} /></span>
                      </button>;
                    })}
                  </div>
                </div>
                <label className={`rx-custom ${custom.trim() ? 'is-filled' : ''}`}>
                  <span className="rx-amount__label">{t('sub2api.recharge.customAmount')}</span>
                  <span className="rx-custom__field">
                    <span className="rx-custom__symbol">$</span>
                    <input type="text" inputMode="decimal" value={custom} className="rx-custom__input"
                      placeholder={rangeHint || t('sub2api.recharge.customPlaceholder')}
                      onChange={event => { const next = event.target.value; if (/^\d*(\.\d{0,2})?$/.test(next)) { setCustom(next); setSubmitError(null); } }} />
                    <span className="rx-custom__line" aria-hidden="true" />
                  </span>
                </label>
              </div>
              {amountError && <p className="rx-error"><AlertIcon className="h-4 w-4" />{amountError}</p>}
            </section>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-6">
            {(info.help_text || info.help_image_url) && <section className="rx-glass rx-help rx-rise" style={{ '--rx-i': 3 } as CSSProperties}>
              <div className="flex flex-col items-center gap-3">
                {info.help_image_url && <img src={info.help_image_url} alt="" className="h-40 w-full max-w-full rounded-lg object-contain" />}
                {info.help_text && <div className="w-full overflow-x-auto break-words text-sm text-[var(--rx-ink-2)]"><Markdown>{info.help_text}</Markdown></div>}
              </div>
            </section>}
            <section className={`${card} rx-rise rx-methods-rail`} style={{ '--rx-i': 4 } as CSSProperties} aria-labelledby="recharge-method-title">
              <header className="rx-section-head">
                <span className="rx-section-head__index">02</span>
                <h2 id="recharge-method-title" className="rx-section-head__title">{t('sub2api.recharge.chooseMethod')}</h2>
              </header>
              <div data-testid="payment-method-grid" className="grid grid-cols-2 gap-3">
                {methodTypes.map((type, index) => {
                  const limit = info.methods[type]!;
                  const usable = limit.available && amountFits(limit, quote?.payBase ?? 0);
                  const selected = method === type;
                  const brand = METHOD_BRAND[type];
                  const label = limit.display_name || t(`sub2api.recharge.methods.${type}`, { defaultValue: type });
                  return <button key={type} type="button" title={label} disabled={!usable} aria-pressed={selected} onClick={() => setMethod(type)}
                    className={`rx-method min-w-0 ${!usable ? 'is-disabled' : selected ? 'is-selected' : ''}`}
                    style={{ '--rx-brand': brand?.color ?? '#14b8a6', '--rx-i': index } as CSSProperties}>
                    <span className="rx-method__glow" aria-hidden="true" />
                    <span className="rx-method__icon">{brand ? <img src={brand.icon} alt="" className="h-6 w-6 object-contain" /> : <span className="text-sm font-bold">{type.slice(0, 1).toUpperCase()}</span>}</span>
                    <span className="flex min-w-0 flex-1 flex-col items-start leading-tight">
                      <span className="rx-method__label block w-full truncate">{label}</span>
                      {limit.fee_rate > 0 && <span className="rx-method__fee">{t('sub2api.recharge.methodFee', { rate: formatPercent(limit.fee_rate) })}</span>}
                    </span>
                    <span className="rx-method__radio" aria-hidden="true" />
                  </button>;
                })}
              </div>
            </section>

            <div className="rx-glass rx-receipt rx-rise" style={{ '--rx-i': 5 } as CSSProperties}>
              <header className="rx-receipt__head">
                <span className="rx-section-head__index">03</span>
                <div className="min-w-0 flex-1">
                  <p className="rx-receipt__eyebrow">{t('sub2api.recharge.rechargeAccount')}</p>
                  <p className="rx-receipt__account">{account.user.username || account.user.email}</p>
                </div>
              </header>
              <div className={`rx-meter ${validTarget <= 0 ? 'is-empty' : ''}`} style={{ '--rx-fill': meterFill } as CSSProperties}>
                <div className="rx-meter__liquid" aria-hidden="true">
                  <span className="rx-meter__wave rx-meter__wave--back" />
                  <span className="rx-meter__wave rx-meter__wave--front" />
                  {[0, 1, 2].map(b => <span key={b} className="rx-meter__bubble" style={{ '--b': b } as CSSProperties} />)}
                </div>
                <div className="rx-meter__readout">
                  {validTarget > 0 && quote ? <>
                    <span className="rx-meter__label">{t('sub2api.recharge.credited')}</span>
                    <span className="rx-meter__value">+${usdText(quote.credited)}</span>
                  </> : <span className="rx-meter__hint">{t('sub2api.recharge.emptyHint')}</span>}
                </div>
              </div>
              {validTarget > 0 && quote && <div className="rx-receipt__rows">
                <div className="rx-row"><span>{t('sub2api.recharge.amount')}</span><span className="rx-row__strong">{formatUsd(round(payAmount * info.balance_recharge_multiplier))}</span></div>
                {quote.mode === 'bonus' && quote.bonus > 0 && <div className="rx-row"><span>{t('sub2api.recharge.bonus', { percent: formatPercent(quote.percent) })}</span><span className="rx-row__hot">+{formatUsd(quote.bonus)}</span></div>}
                <div className="rx-row"><span>{t('sub2api.recharge.credited')}</span><span className="rx-row__strong">{formatUsd(quote.credited)}</span></div>
                <div className="rx-row"><span>{t('sub2api.recharge.payAmount')}</span><span className={quote.discount > 0 ? 'rx-row__strike' : 'rx-row__strong'}>{fmt(payAmount)}</span></div>
                {quote.discount > 0 && <div className="rx-row"><span>{t('sub2api.recharge.discount', { percent: formatPercent(quote.percent) })}</span><span className="rx-row__hot">-{fmt(quote.discount)}</span></div>}
                {quote.fee > 0 && <div className="rx-row"><span>{t('sub2api.recharge.fee', { rate: formatPercent(info.recharge_fee_rate) })}</span><span className="rx-row__strong">{fmt(quote.fee)}</span></div>}
                <div className="rx-row rx-row--total"><span>{t('sub2api.recharge.actualPay')}</span><span className="rx-row__total">{fmt(quote.total)}</span></div>
                {info.balance_recharge_multiplier !== 1 && <p className="rx-receipt__note">{t('sub2api.recharge.ratePreview', { amount: fmt(round(1 / info.balance_recharge_multiplier, 4)) })}</p>}
              </div>}
              <div className="rx-receipt__perf" aria-hidden="true" />
              {submitError && <p role="alert" className="rx-error !mt-0 mb-3">{submitError}</p>}
              <button type="button" className="rx-cta" style={{ '--rx-brand': brandColor } as CSSProperties} disabled={!canSubmit} onClick={() => void submit()}>
                <span className="rx-cta__shine" aria-hidden="true" />
                {submitting ? <span className="rx-cta__content"><span className="rx-cta__spinner" aria-hidden="true" />{t('sub2api.processing')}</span>
                  : <span className="rx-cta__content">
                    {validTarget > 0 && quote ? t('sub2api.recharge.payNow', { amount: fmt(quote.total) }) : t('sub2api.recharge.pickAmount')}
                    <ArrowRightIcon className="rx-cta__arrow" aria-hidden="true" />
                  </span>}
              </button>
            </div>
          </aside>
        </div>
      </div>}
  </Shell>;
}

/** Spotlight follows the pointer via CSS variables on the tile itself. */
function trackPointer(event: ReactPointerEvent<HTMLElement>) {
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
  el.style.setProperty('--my', `${event.clientY - rect.top}px`);
}

/** Holographic balance card from sub2api's RechargeHero, with tilt and projected balance. */
function BalanceCard({ brand, balance, credit, username, userId }: { brand: string; balance: number; credit: number; username: string; userId: number }) {
  const { t } = useTranslation('app');
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, px: 50, py: 30, active: false });
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width; const y = (event.clientY - rect.top) / rect.height;
    setTilt({ ry: (x - 0.5) * 10, rx: (0.5 - y) * 6, px: x * 100, py: y * 100, active: true });
  };
  const style = { '--rx-rx': `${tilt.rx}deg`, '--rx-ry': `${tilt.ry}deg`, '--rx-px': `${tilt.px}%`, '--rx-py': `${tilt.py}%`, '--rx-sheen': tilt.active ? '1' : '0.55' } as CSSProperties;
  return <section className="rx-hero">
    <div className="rx-card-stage" onPointerMove={onMove} onPointerLeave={() => setTilt({ rx: 0, ry: 0, px: 50, py: 30, active: false })}>
      <div className={`rx-card ${credit > 0 ? 'is-charged' : ''}`} style={style}>
        <div className="rx-card__holo" aria-hidden="true" />
        <div className="rx-card__sheen" aria-hidden="true" />
        <div className="rx-card__body">
          <div className="rx-card__brand-row">
            <span className="rx-card__chip" aria-hidden="true"><i /><i /><i /></span>
            <span className="rx-card__brand">{brand}</span>
          </div>
          <div className="rx-card__balance">
            <span className="rx-card__label">{t('sub2api.recharge.currentBalance')}</span>
            <span className="rx-card__amount"><span className="rx-card__currency">$</span>{usdText(balance)}</span>
          </div>
          {credit > 0 && <div className="rx-card__projected" data-testid="recharge-projected-balance">
            <span className="rx-card__delta">+${usdText(credit)}</span>
            <span className="rx-card__after">{t('sub2api.recharge.afterTopUp')} <b>${usdText(balance + credit)}</b></span>
          </div>}
          <div className="rx-card__foot">
            <span className="rx-card__holder">{username || '—'}</span>
            <span className="rx-card__serial">•••• {String(userId || 0).padStart(4, '0').slice(-4)}</span>
          </div>
        </div>
      </div>
    </div>
  </section>;
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="h-full min-h-0 overflow-y-auto overscroll-contain bg-[var(--paper)] text-[var(--ink)] [scrollbar-gutter:stable]">
    <div className="rx-stage mx-auto max-w-[1180px] px-8 pb-10 pt-7">
      <div className="rx-aurora" aria-hidden="true">
        <span className="rx-aurora__blob rx-aurora__blob--1" /><span className="rx-aurora__blob rx-aurora__blob--2" /><span className="rx-aurora__blob rx-aurora__blob--3" />
        <span className="rx-aurora__grid" /><span className="rx-aurora__grain" />
      </div>
      <div className="relative">{children}</div>
    </div>
  </main>;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return <div className="rx-row">
    <span>{label}</span>
    <span className={tone === 'success' ? 'rx-row__total' : 'rx-row__strong'}>{value}</span>
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
    return <section className="rx-glass mx-auto mt-2 flex max-w-md flex-col items-center px-8 py-10 text-center">
      <span className={`flex h-16 w-16 items-center justify-center rounded-full ${success ? 'bg-[var(--success-bg)] text-[var(--success)]' : 'bg-[var(--paper-inset)] text-[var(--ink-muted)]'}`}>
        {success ? <CheckIcon className="h-8 w-8" strokeWidth={2.5} /> : outcome === 'expired' ? <ClockIcon className="h-8 w-8" /> : <XCircleIcon className="h-8 w-8" />}
      </span>
      <h2 className="mt-5 text-xl font-semibold text-[var(--ink)]">{t(`sub2api.recharge.outcome.${outcome}`)}</h2>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">{success ? t('sub2api.recharge.outcome.successHint', { amount: formatUsd(order.credited) }) : t('sub2api.recharge.outcome.retryHint')}</p>
      <button type="button" onClick={onDone} className="rx-cta mt-7"><span className="rx-cta__content">{success ? t('sub2api.recharge.again') : t('sub2api.recharge.backToRecharge')}</span></button>
    </section>;
  }

  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  return <section className="rx-glass mx-auto mt-2 max-w-md overflow-hidden">
    <div className="px-8 pb-6 pt-7 text-center" style={brand ? { background: `linear-gradient(180deg, ${brand.color}14, transparent)` } : undefined}>
      <p className="text-sm font-medium text-[var(--ink-muted)]">{order.qrCode ? t(`sub2api.recharge.scan.${order.paymentType}`, { defaultValue: t('sub2api.recharge.scan.default') }) : t('sub2api.recharge.payInBrowser')}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-[var(--ink)]">{fmt(order.payAmount)}</p>
      {order.qrCode ? <div className="relative mx-auto mt-5 w-fit rounded-2xl border-2 bg-white p-3" style={{ borderColor: brand?.color ?? 'var(--line)' }}>
        {qr ? <img src={qr} alt={t('sub2api.recharge.qrAlt')} className="h-52 w-52" /> : <div className="flex h-52 w-52 items-center justify-center"><LoaderIcon className="h-6 w-6 animate-spin text-[var(--ink-muted)]" /></div>}
        {brand && qr && <span className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl text-base font-bold text-white ring-4 ring-white" style={{ background: brand.color }}>{brand.glyph}</span>}
      </div> : <div className="mx-auto mt-6 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--paper-inset)]"><LoaderIcon className="h-8 w-8 animate-spin text-[var(--accent)]" /></div>}
      <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-[var(--ink-muted)]"><LoaderIcon className="h-3 w-3 animate-spin" />{t('sub2api.recharge.waiting')}</p>
    </div>
    <div className="space-y-2 border-t border-[var(--rx-line-soft)] px-8 py-4 text-sm">
      <Row label={t('sub2api.recharge.credited')} value={formatUsd(order.credited)} tone="success" />
      <Row label={t('sub2api.recharge.orderNo')} value={order.outTradeNo ? order.outTradeNo.replace(/^sub2_/i, '') : `#${order.orderId}`} />
      <Row label={t('sub2api.recharge.expiresIn')} value={`${minutes}:${seconds}`} />
    </div>
    {error && <p role="alert" className="mx-8 mb-3 rounded-lg bg-[var(--error-bg)] px-3 py-2 text-xs text-[var(--error)]">{error}</p>}
    <div className="flex gap-2 border-t border-[var(--line-subtle)] px-8 py-4">
      {order.payUrl && <button type="button" className={`${secondary} flex-1`} onClick={() => void openExternal(order.payUrl)}><ExternalIcon className="h-4 w-4" />{t('sub2api.recharge.openPayPage')}</button>}
      <button type="button" className={`${secondary} flex-1`} disabled={cancelling} onClick={() => setConfirmCancel(true)}>{cancelling ? t('sub2api.processing') : t('sub2api.cancelOrder')}</button>
    </div>
    <p className="flex items-center justify-center gap-1.5 bg-[var(--paper-inset)] px-6 py-2.5 text-xs text-[var(--ink-muted)]"><InfoIcon className="h-3.5 w-3.5" />{t('sub2api.recharge.autoRefresh')}</p>
    {confirmCancel && <ConfirmDialog title={t('sub2api.cancelOrder')} message={t('sub2api.cancelOrderConfirm')} confirmVariant="danger" confirmText={t('sub2api.cancelOrder')} cancelText={t('sub2api.back')} onConfirm={() => void cancel()} onCancel={() => setConfirmCancel(false)} />}
  </section>;
}
