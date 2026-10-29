import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertIcon, CheckIcon, CoinsIcon, CopyIcon, LoaderIcon, RefreshIcon, UserPlusIcon,
} from '@/components/icons';
import { sub2api, sub2apiErrorCode } from '@/api/sub2api';
import { useSub2apiAccount } from '@/features/account/useSub2apiAccount';
import { useSub2apiBalance } from '@/features/account/useSub2apiBalance';
import {
  formatRebateRate, money, normalizeAffiliateDetail, normalizeAffiliateTransfer,
  type AffiliateDetail,
} from '@/features/invite/affiliate';
import { copyPlainText } from '@/utils/clipboard';
import '@/features/recharge/rechargeGlass.css';
import '@/features/invite/inviteGlass.css';

const secondary = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[var(--rx-line)] bg-[var(--rx-surface)] px-3 text-sm font-medium text-[var(--rx-ink-2)] transition-colors hover:bg-[var(--rx-surface-hover)] hover:text-[var(--rx-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50';
const primary = 'inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)] shadow-[var(--shadow-sm)] transition-[opacity,transform] hover:opacity-90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100';

function errorText(t: (key: string, options?: Record<string, unknown>) => string, reason: unknown) {
  return t(`sub2api.errors.${sub2apiErrorCode(reason)}`, { defaultValue: t('sub2api.errors.UNKNOWN') });
}

export default function Invite({ isActive }: { isActive: boolean }) {
  const { t, i18n } = useTranslation('app');
  const { account } = useSub2apiAccount();
  const { refresh: refreshBalance } = useSub2apiBalance();
  const [detail, setDetail] = useState<AffiliateDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const sequence = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!account.user) return;
    const current = ++sequence.current;
    if (!silent) { setLoading(true); setLoadError(null); }
    try {
      const next = normalizeAffiliateDetail(await sub2api.accountApi('affiliate'));
      if (current === sequence.current) setDetail(next);
    } catch (reason) {
      if (current === sequence.current) setLoadError(errorText(t, reason));
    } finally {
      if (current === sequence.current && !silent) setLoading(false);
    }
  }, [account.user, t]);
  useEffect(() => { if (isActive && !detail) void load(); }, [detail, isActive, load]);

  if (!account.user) {
    return <Shell>
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--paper-inset)] text-[var(--ink-muted)]"><UserPlusIcon className="h-6 w-6" /></span>
        <h2 className="mt-4 text-lg font-semibold">{t('sub2api.accountRequired')}</h2>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">{t('sub2api.invite.signInHint')}</p>
        <button type="button" className={`${primary} mt-5`} onClick={() => window.dispatchEvent(new Event('sub2api-account:open-login'))}>{t('sub2api.signIn')}</button>
      </div>
    </Shell>;
  }

  const rate = formatRebateRate(detail?.effective_rebate_rate_percent);
  const copy = async (value: string) => {
    if (!value) return;
    try {
      await copyPlainText(value);
      setCopied(true);
      setNotice(t('sub2api.invite.codeCopied'));
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice(t('sub2api.invite.copyFailed'));
    }
  };
  const transfer = async () => {
    if (!detail || detail.aff_quota <= 0 || transferring) return;
    setTransferring(true); setNotice('');
    try {
      const result = normalizeAffiliateTransfer(await sub2api.accountApi('affiliate-transfer'));
      setNotice(t('sub2api.invite.transfer.success', { amount: money(result.transferred_quota) }));
      await Promise.all([load(true), refreshBalance()]);
    } catch (reason) {
      setLoadError(errorText(t, reason));
    } finally {
      setTransferring(false);
    }
  };

  const faces = detail?.invitees.slice(0, 5) ?? [];

  return <Shell>
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--rx-ink)]">{t('sub2api.invite.title')}</h1>
      <button type="button" className={secondary} disabled={loading} onClick={() => void load()}>
        <RefreshIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        {t('sub2api.refresh')}
      </button>
    </div>

    {loadError ? <div className="rx-glass rx-aff-panel flex flex-col items-center gap-3 text-center">
      <AlertIcon className="h-6 w-6 text-[var(--error)]" />
      <p role="alert" className="text-sm text-[var(--error)]">{loadError}</p>
      <button type="button" className={secondary} disabled={loading} onClick={() => void load()}>{t('sub2api.retry')}</button>
    </div>
      : !detail ? <div className="rx-aff-loading" role="status" aria-label={t('sub2api.invite.loading')}>
        {[0, 1, 2, 3].map(n => <span key={n} />)}
      </div>
      : <>
        <div className="rx-invite-card">
          <span className="rx-invite-card__sheen" aria-hidden="true" />
          <div className="rx-invite-card__rate-block">
            <p className="rx-invite-card__label">{t('sub2api.invite.stats.rebateRate')}</p>
            <p className="rx-invite-card__rate">{rate}<small>%</small></p>
            <p className="rx-invite-card__hint">{t('sub2api.invite.stats.rebateRateHint')}</p>
          </div>
          <div className="rx-invite-card__foot">
            <span className="rx-invite-card__avatars" aria-hidden="true">
              {faces.map(item => <span key={item.user_id}>{initialOf(item)}</span>)}
              {faces.length === 0 && <span className="is-empty">+</span>}
            </span>
            <span>{t('sub2api.invite.stats.invitedUsers')} · <b>{detail.aff_count.toLocaleString(i18n.language)}</b></span>
          </div>
        </div>

        <section className="grid gap-4 sm:grid-cols-3" aria-label={t('sub2api.invite.statsLabel')}>
          <Metric index="01" label={t('sub2api.invite.stats.invitedUsers')} value={detail.aff_count.toLocaleString(i18n.language)} delay={3} />
          <Metric index="02" label={t('sub2api.invite.stats.availableQuota')} value={money(detail.aff_quota)} delay={4} good />
          <Metric index="03" label={t('sub2api.invite.stats.totalQuota')} value={money(detail.aff_history_quota)} delay={5}
            hint={detail.aff_frozen_quota > 0 ? t('sub2api.invite.stats.frozenQuota', { amount: money(detail.aff_frozen_quota) }) : undefined} />
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
          <section className="rx-glass rx-aff-panel rx-rise" style={{ '--rx-i': 6 } as CSSProperties}>
            <header className="rx-section-head">
              <span className="rx-section-head__index">01</span>
              <h2 className="rx-section-head__title">{t('sub2api.invite.shareTitle')}</h2>
            </header>
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="rx-aff-field-label">{t('sub2api.invite.yourCode')}</p>
                <div className={`rx-aff-ticket ${copied ? 'is-stamped' : ''}`}>
                  <div className="rx-aff-ticket__stub" aria-hidden="true">
                    <UserPlusIcon className="h-5 w-5" />
                    <span>{t('sub2api.invite.ticketStub')}</span>
                  </div>
                  <div className="rx-aff-ticket__body flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                    <code className="rx-aff-code min-w-0 break-all sm:flex-1 sm:truncate">{detail.aff_code || '—'}</code>
                    <span className="rx-aff-ticket__scan" aria-hidden="true" />
                    <button type="button" className="rx-aff-copy w-full sm:w-auto sm:shrink-0" disabled={!detail.aff_code} onClick={() => void copy(detail.aff_code)}>
                      {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                      <span>{t('sub2api.invite.copyCode')}</span>
                    </button>
                  </div>
                  {copied && <span className="rx-aff-stamp" aria-hidden="true">{t('sub2api.invite.stamped')}</span>}
                </div>
              </div>
            </div>
          </section>

          <aside className="rx-glass rx-aff-panel rx-rise" style={{ '--rx-i': 7 } as CSSProperties}>
            <header className="rx-section-head">
              <span className="rx-section-head__index">02</span>
              <h2 className="rx-section-head__title">{t('sub2api.invite.tips.title')}</h2>
            </header>
            <ol className="rx-aff-tips">
              <li>{t('sub2api.invite.tips.line1')}</li>
              <li>{t('sub2api.invite.tips.line2', { rate: `${rate}%` })}</li>
              <li>{t('sub2api.invite.tips.line3')}</li>
              {detail.aff_frozen_quota > 0 && <li>{t('sub2api.invite.tips.line4')}</li>}
            </ol>
          </aside>
        </div>

        <section className="rx-glass rx-aff-transfer rx-rise" style={{ '--rx-i': 8 } as CSSProperties}>
          <div className="min-w-0">
            <header className="rx-section-head !mb-1">
              <span className="rx-section-head__index">03</span>
              <h2 className="rx-section-head__title">{t('sub2api.invite.transfer.title')}</h2>
            </header>
            <p className="rx-aff-muted">{t('sub2api.invite.transfer.description')}</p>
            {detail.aff_quota <= 0 && <p className="rx-aff-muted rx-aff-warn mt-2">{t('sub2api.invite.transfer.empty')}</p>}
          </div>
          <div className="rx-aff-transfer__action">
            <p className="rx-aff-transfer__amount">{money(detail.aff_quota)}</p>
            <button type="button" className="rx-aff-cta" disabled={transferring || detail.aff_quota <= 0} onClick={() => void transfer()}>
              {transferring ? <LoaderIcon className="h-4 w-4 animate-spin" /> : <CoinsIcon className="h-4 w-4" />}
              <span>{transferring ? t('sub2api.invite.transfer.transferring') : t('sub2api.invite.transfer.button')}</span>
            </button>
          </div>
        </section>

        <section className="rx-glass rx-aff-panel rx-rise" style={{ '--rx-i': 9 } as CSSProperties}>
          <header className="rx-section-head">
            <span className="rx-section-head__index">04</span>
            <h2 className="rx-section-head__title">{t('sub2api.invite.invitees.title')}</h2>
            <span className="rx-section-head__hint">{detail.invitees.length.toLocaleString(i18n.language)}</span>
          </header>
          {detail.invitees.length === 0
            ? <div className="rx-aff-empty">
              <span className="rx-aff-empty__orbit" aria-hidden="true"><i /><i /><i /></span>
              {t('sub2api.invite.invitees.empty')}
            </div>
            : <div className="overflow-x-auto">
              <table className="rx-aff-table w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr>
                    <th>{t('sub2api.invite.invitees.columns.email')}</th>
                    <th>{t('sub2api.invite.invitees.columns.username')}</th>
                    <th className="text-right">{t('sub2api.invite.invitees.columns.rebate')}</th>
                    <th>{t('sub2api.invite.invitees.columns.joinedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.invitees.map(item => (
                    <tr key={item.user_id}>
                      <td>
                        <span className="rx-aff-person">
                          <span className="rx-aff-person__avatar" aria-hidden="true">{initialOf(item)}</span>
                          <span className="truncate">{item.email || '—'}</span>
                        </span>
                      </td>
                      <td className="rx-aff-muted">{item.username || '—'}</td>
                      <td className="rx-aff-good text-right font-semibold">{money(item.total_rebate)}</td>
                      <td className="rx-aff-muted tabular-nums">{formatDate(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        </section>
        {!!notice && <p role="status" className="text-sm text-[var(--rx-muted)]">{notice}</p>}
      </>}
  </Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="h-full min-h-0 overflow-y-auto overscroll-contain bg-[var(--paper)] text-[var(--ink)] [scrollbar-gutter:stable]">
    <div className="rx-stage mx-auto max-w-[1180px] px-8 pb-10 pt-7">
      <div className="rx-aurora" aria-hidden="true">
        <span className="rx-aurora__blob rx-aurora__blob--1" /><span className="rx-aurora__blob rx-aurora__blob--2" /><span className="rx-aurora__blob rx-aurora__blob--3" />
        <span className="rx-aurora__grid" /><span className="rx-aurora__grain" />
      </div>
      <div className="relative space-y-6">{children}</div>
    </div>
  </main>;
}

function Metric({ index, label, value, hint, good, delay }: { index: string; label: string; value: string; hint?: string; good?: boolean; delay: number }) {
  return <article className="rx-glass rx-metric rx-rise" style={{ '--rx-i': delay } as CSSProperties}>
    <span className="rx-metric__index">{index}</span>
    <p className="rx-metric__label">{label}</p>
    <p className={`rx-metric__value ${good ? 'rx-aff-good' : ''}`}>{value}</p>
    {hint && <p className="rx-metric__hint rx-aff-warn">{hint}</p>}
  </article>;
}

function initialOf(item: { email?: string; username?: string }): string {
  const source = (item.username || item.email || '?').trim();
  return (source[0] || '?').toUpperCase();
}

function formatDate(value: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}
