import { useTranslation } from 'react-i18next';
import { CloseIcon, CoinsIcon, PlusIcon } from '@/components/icons';
import { useSub2apiBalance } from './useSub2apiBalance';

export default function InsufficientBalanceCard({
  onRecharge,
  onDismiss,
}: {
  onRecharge?: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation('chat');
  const { t: tApp } = useTranslation('app');
  const { signedIn, balance } = useSub2apiBalance();

  return (
    <div className="relative z-10 flex-shrink-0 bg-[var(--paper)] px-4 py-3">
      <section
        role="status"
        aria-label={t('shell.agentError.insufficientBalance.title')}
        className="relative mx-auto max-w-3xl overflow-hidden rounded-xl border border-[var(--warning-border)] bg-[var(--paper-elevated)] p-4 shadow-[var(--shadow-xs)]"
      >
        <div aria-hidden="true" className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full bg-[var(--warning)] opacity-[0.12]" />
        <div className="relative flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--warning-bg)] text-[var(--warning)]">
            <CoinsIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--ink)]">
              {t('shell.agentError.insufficientBalance.title')}
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
              {t('shell.agentError.insufficientBalance.hint')}
            </p>
            {signedIn && balance != null && (
              <p className="mt-1 text-xs tabular-nums text-[var(--warning)]">
                {tApp('sub2api.balanceCard.title')} ${balance.toFixed(2)}
              </p>
            )}
            {onRecharge && (
              <button
                type="button"
                onClick={onRecharge}
                className="mt-3 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-[var(--on-accent)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                {t('shell.agentError.insufficientBalance.recharge')}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="relative flex-shrink-0 rounded p-0.5 text-[var(--ink-subtle)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink-muted)]"
            title={t('shell.common.close')}
            aria-label={t('shell.common.close')}
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>
    </div>
  );
}
