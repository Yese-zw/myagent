import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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

const card = 'rounded-2xl border border-[var(--line)] bg-[var(--paper-elevated)] shadow-[var(--shadow-xs)]';
const secondary = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] px-3 text-sm font-medium text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50';
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

  return <Shell>
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">{t('sub2api.invite.title')}</h1>
      <button type="button" className={secondary} disabled={loading} onClick={() => void load()}>
        <RefreshIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        {t('sub2api.refresh')}
      </button>
    </div>

    {loadError ? <div className={`${card} mt-6 flex flex-col items-center gap-3 px-6 py-12 text-center`}>
      <AlertIcon className="h-6 w-6 text-[var(--error)]" />
      <p role="alert" className="text-sm text-[var(--error)]">{loadError}</p>
      <button type="button" className={secondary} disabled={loading} onClick={() => void load()}>{t('sub2api.retry')}</button>
    </div>
      : !detail ? <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label={t('sub2api.invite.loading')}>
        <LoaderIcon className="h-8 w-8 animate-spin text-[var(--ink-muted)]" />
      </div>
      : <div className="mt-6 space-y-6">
        <section className="grid grid-cols-4 gap-3" aria-label={t('sub2api.invite.statsLabel')}>
          <Stat label={t('sub2api.invite.stats.rebateRate')} value={`${rate}%`} hint={t('sub2api.invite.stats.rebateRateHint')} accent />
          <Stat label={t('sub2api.invite.stats.invitedUsers')} value={detail.aff_count.toLocaleString(i18n.language)} />
          <Stat label={t('sub2api.invite.stats.availableQuota')} value={money(detail.aff_quota)} hint={detail.aff_frozen_quota > 0 ? t('sub2api.invite.stats.frozenQuota', { amount: money(detail.aff_frozen_quota) }) : undefined} tone="success" />
          <Stat label={t('sub2api.invite.stats.totalQuota')} value={money(detail.aff_history_quota)} />
        </section>

        <section className={`${card} p-6`}>
          <h2 className="text-base font-semibold text-[var(--ink)]">{t('sub2api.invite.shareTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{t('sub2api.invite.shareHint')}</p>
          <div className="mt-5">
            <CopyField label={t('sub2api.invite.yourCode')} value={detail.aff_code} copied={copied} action={t('sub2api.invite.copyCode')} done={t('sub2api.invite.copied')} onCopy={() => void copy(detail.aff_code)} />
          </div>
          <div className="mt-5 rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/[0.06] px-4 py-3">
            <p className="text-sm font-medium text-[var(--ink)]">{t('sub2api.invite.tips.title')}</p>
            <ol className="mt-2 space-y-1 text-sm leading-6 text-[var(--ink-secondary)]">
              <li>1. {t('sub2api.invite.tips.line1')}</li>
              <li>2. {t('sub2api.invite.tips.line2', { rate: `${rate}%` })}</li>
              <li>3. {t('sub2api.invite.tips.line3')}</li>
              {detail.aff_frozen_quota > 0 && <li>4. {t('sub2api.invite.tips.line4')}</li>}
            </ol>
          </div>
        </section>

        <section className={`${card} flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between`}>
          <div>
            <h2 className="text-base font-semibold text-[var(--ink)]">{t('sub2api.invite.transfer.title')}</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{t('sub2api.invite.transfer.description')}</p>
            {detail.aff_quota <= 0 && <p className="mt-2 text-sm text-[var(--warning)]">{t('sub2api.invite.transfer.empty')}</p>}
          </div>
          <button type="button" className={`${primary} shrink-0`} disabled={transferring || detail.aff_quota <= 0} onClick={() => void transfer()}>
            {transferring ? <LoaderIcon className="h-4 w-4 animate-spin" /> : <CoinsIcon className="h-4 w-4" />}
            {transferring ? t('sub2api.invite.transfer.transferring') : t('sub2api.invite.transfer.button')}
          </button>
        </section>

        <section className={`${card} p-6`}>
          <h2 className="text-base font-semibold text-[var(--ink)]">{t('sub2api.invite.invitees.title')}</h2>
          {detail.invitees.length === 0
            ? <div className="mt-4 rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center text-sm text-[var(--ink-muted)]">{t('sub2api.invite.invitees.empty')}</div>
            : <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--ink-muted)]">
                    <th className="px-3 py-2 font-medium">{t('sub2api.invite.invitees.columns.email')}</th>
                    <th className="px-3 py-2 font-medium">{t('sub2api.invite.invitees.columns.username')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('sub2api.invite.invitees.columns.rebate')}</th>
                    <th className="px-3 py-2 font-medium">{t('sub2api.invite.invitees.columns.joinedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.invitees.map(item => (
                    <tr key={item.user_id} className="border-b border-[var(--line-subtle)] last:border-b-0">
                      <td className="px-3 py-3 text-[var(--ink)]">{item.email || '—'}</td>
                      <td className="px-3 py-3 text-[var(--ink-secondary)]">{item.username || '—'}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums text-[var(--success)]">{money(item.total_rebate)}</td>
                      <td className="px-3 py-3 text-[var(--ink-secondary)]">{formatDate(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        </section>
        {!!notice && <p role="status" className="text-sm text-[var(--ink-muted)]">{notice}</p>}
      </div>}
  </Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="h-full min-h-0 overflow-y-auto overscroll-contain bg-[var(--paper)] text-[var(--ink)]">
    <div className="mx-auto max-w-5xl px-8 pb-10 pt-7">{children}</div>
  </main>;
}

function Stat({ label, value, hint, accent, tone }: {
  label: string; value: string; hint?: string; accent?: boolean; tone?: 'success';
}) {
  return <article className={`${card} min-w-0 p-4`}>
    <p className="truncate text-sm text-[var(--ink-muted)]">{label}</p>
    <p className={`mt-2 text-2xl font-semibold tabular-nums ${accent ? 'text-[var(--accent)]' : tone === 'success' ? 'text-[var(--success)]' : 'text-[var(--ink)]'}`}>{value}</p>
    {hint && <p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">{hint}</p>}
  </article>;
}

function CopyField({ label, value, action, done, copied, onCopy }: {
  label: string; value: string; action: string; done: string; copied: boolean; onCopy: () => void;
}) {
  return <div>
    <p className="text-sm font-medium text-[var(--ink)]">{label}</p>
    <div className="mt-2 flex flex-col items-stretch gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-inset)] px-3 py-2 sm:flex-row sm:items-center">
      <code className="min-w-0 break-all text-sm font-medium text-[var(--ink)] sm:flex-1 sm:truncate">{value || '—'}</code>
      <button type="button" className={`${secondary} w-full sm:w-auto`} disabled={!value} onClick={onCopy}>
        {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
        {copied ? done : action}
      </button>
    </div>
  </div>;
}

function formatDate(value: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}
