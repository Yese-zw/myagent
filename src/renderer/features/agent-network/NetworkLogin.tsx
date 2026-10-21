import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderIcon, LogInIcon } from '@/components/icons';
import myagentsWebLogo from '@/assets/brand/myagents-web-logo.png';

const PAPER_GRID_STYLE: CSSProperties = {
  backgroundImage:
    'linear-gradient(var(--line-subtle) 1px, var(--paper-a0) 1px), linear-gradient(90deg, var(--line-subtle) 1px, var(--paper-a0) 1px))',
  backgroundSize: '24px 24px, 24px 24px',
  maskImage:
    'linear-gradient(to bottom, rgb(0 0 0 / 0) 0, #000 120px, #000 calc(100% - 120px), rgb(0 0 0 / 0) 100%)',
};

export interface NetworkLoginProps {
  authBusy: boolean;
  authFlow: { token: string; expiresAt: number } | null;
  onLogin: () => void;
  reauthRequired?: boolean;
  accountName?: string | null;
  onForgetAccount?: () => void;
}

/** Account gate for AgentNet. The network requires a signed-in MyAgents
 * account before a device can join. */
export function NetworkLogin({
  authBusy,
  authFlow,
  onLogin,
  reauthRequired = false,
  accountName,
  onForgetAccount,
}: NetworkLoginProps) {
  const { t } = useTranslation('app');
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-[var(--paper)] px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={PAPER_GRID_STYLE}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-6 shadow-md">
        <div className="mb-6 flex items-center gap-3">
          <img
            src={myagentsWebLogo}
            alt=""
            className="h-11 w-11 rounded-xl shadow-sm"
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--accent-warm)]">
              {t('agentNetwork.login.eyebrow')}
            </p>
            <h1 className="truncate text-xl font-semibold text-[var(--ink)]">
              {t('agentNetwork.login.title')}
            </h1>
            <p className="text-sm text-[var(--ink-muted)]">
              {reauthRequired
                ? t('agentNetwork.login.reauthDescription', { name: accountName })
                : t('agentNetwork.login.description')}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={authBusy}
          onClick={onLogin}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--button-primary-bg)] px-4 text-sm font-medium text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)] disabled:cursor-wait disabled:opacity-70"
        >
          {authBusy ? (
            <LoaderIcon className="h-4 w-4 animate-spin" />
          ) : (
            <LogInIcon className="h-4 w-4" />
          )}
          {authFlow
            ? t('agentNetwork.login.waiting')
            : t('agentNetwork.login.continueWithGoogle')}
        </button>
        <p className="mt-3 text-center text-xs text-[var(--ink-muted)]">
          {t('agentNetwork.login.returnHint')}
        </p>
        {reauthRequired && onForgetAccount ? (
          <button
            type="button"
            disabled={authBusy}
            onClick={onForgetAccount}
            className="mt-3 flex h-9 w-full items-center justify-center rounded-lg text-sm text-[var(--ink-muted)] hover:bg-[var(--button-secondary-bg-hover)] hover:text-[var(--ink)] disabled:opacity-60"
          >
            {t('agentNetwork.login.forgetAccount')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
