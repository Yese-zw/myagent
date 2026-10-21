import { useTranslation } from 'react-i18next';
import { CoinsIcon, PlusIcon, RefreshIcon, UserPlusIcon } from '@/components/icons';
import { useSub2apiBalance } from './useSub2apiBalance';

/** Sidebar balance summary shown above the helper entry for signed-in users. */
export default function Sub2apiBalanceCard({ expanded, onRecharge, onInvite }: {
  expanded: boolean; onRecharge: () => void; onInvite?: () => void;
}) {
  const { t } = useTranslation('app');
  const { signedIn, balance, loading, failed, refresh } = useSub2apiBalance();
  if (!signedIn || !expanded) return null;
  const low = balance != null && balance < 1;
  return (
    <section
      aria-label={t('sub2api.balanceCard.title')}
      className="relative mb-2 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-3 shadow-[var(--shadow-xs)]"
      data-global-sidebar-balance-card
    >
      <div aria-hidden="true" className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full bg-[var(--accent)] opacity-[0.08]" />
      <div className="relative flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-muted)]">
          <CoinsIcon className="h-3.5 w-3.5" />
          {t('sub2api.balanceCard.title')}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label={t('sub2api.refresh')}
          title={t('sub2api.refresh')}
          className="rounded-md p-1 text-[var(--ink-faint)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)] disabled:cursor-wait"
        >
          <RefreshIcon className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className={`relative mt-1 truncate text-xl font-semibold tabular-nums ${low ? 'text-[var(--warning)]' : 'text-[var(--ink)]'}`}>
        {balance != null ? `$${balance.toFixed(2)}` : failed ? '—' : <span className="inline-block h-6 w-20 animate-pulse rounded-md bg-[var(--paper-inset)] align-middle" />}
      </p>
      {low && <p className="relative mt-0.5 text-xs text-[var(--warning)]">{t('sub2api.balanceCard.low')}</p>}
      <div className={`relative mt-2.5 grid gap-2 ${onInvite ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button
          type="button"
          onClick={onRecharge}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] text-sm font-medium text-[var(--on-accent)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {t('sub2api.balanceCard.recharge')}
        </button>
        {onInvite && (
          <button
            type="button"
            onClick={onInvite}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--paper)] text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <UserPlusIcon className="h-3.5 w-3.5" />
            {t('sub2api.balanceCard.invite')}
          </button>
        )}
      </div>
    </section>
  );
}
