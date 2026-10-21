import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { LoaderIcon } from '@/components/icons';
import OverlayBackdrop from '@/components/OverlayBackdrop';
import { useToastOptional } from '@/components/Toast';
import { useCloseLayer } from '@/hooks/useCloseLayer';
import { sub2api, sub2apiErrorCode } from '@/api/sub2api';
import { openExternal } from '@/utils/openExternal';
import { useSub2apiAccount } from './useSub2apiAccount';

/** Official page that serves the latest ChatGPT desktop app, which includes Codex. */
export const CODEX_DESKTOP_DOWNLOAD_URL = 'https://chatgpt.com/download/';

type CheckState =
  | { kind: 'checking' }
  | { kind: 'installed'; name: string | null }
  | { kind: 'missing' }
  | { kind: 'error' };

/** Confirm before opening Codex, and offer the latest client when it is not installed. */
export default function GoToCodexDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('app');
  const toast = useToastOptional();
  const { account } = useSub2apiAccount();
  const titleId = useId();
  const [check, setCheck] = useState<CheckState>({ kind: 'checking' });
  const [launching, setLaunching] = useState(false);
  useCloseLayer(() => { if (launching) return false; onClose(); return true; }, 300);

  useEffect(() => {
    let cancelled = false;
    void sub2api.codexAppStatus()
      .then(status => {
        if (cancelled) return;
        setCheck(status.installed ? { kind: 'installed', name: status.name } : { kind: 'missing' });
      })
      .catch(() => { if (!cancelled) setCheck({ kind: 'error' }); });
    return () => { cancelled = true; };
  }, []);

  const openDownload = () => { void openExternal(CODEX_DESKTOP_DOWNLOAD_URL); };

  const go = async () => {
    if (launching || check.kind !== 'installed') return;
    if (!account.user) {
      window.dispatchEvent(new Event('sub2api-account:open-login'));
      onClose();
      return;
    }
    setLaunching(true);
    try {
      const alreadyRunning = await sub2api.launchCodex();
      toast?.success(t(alreadyRunning ? 'sub2api.launchCodex.alreadyRunning' : 'sub2api.launchCodex.launched'));
      onClose();
    } catch (reason) {
      const code = sub2apiErrorCode(reason);
      if (code === 'UNAUTHORIZED') {
        window.dispatchEvent(new Event('sub2api-account:open-login'));
        onClose();
        return;
      }
      if (code === 'CODEX_APP_NOT_FOUND') {
        setCheck({ kind: 'missing' });
        return;
      }
      toast?.error(t(`sub2api.errors.${code}`, { defaultValue: t('sub2api.errors.UNKNOWN') }));
    } finally {
      setLaunching(false);
    }
  };

  const showDownload = check.kind === 'missing' || check.kind === 'error';
  const message = check.kind === 'checking'
    ? t('sub2api.launchCodex.dialog.checking')
    : check.kind === 'installed'
      ? t(check.name ? 'sub2api.launchCodex.dialog.installedNamed' : 'sub2api.launchCodex.dialog.installed', { name: check.name ?? '' })
      : check.kind === 'missing'
        ? t('sub2api.launchCodex.dialog.missing')
        : t('sub2api.launchCodex.dialog.checkFailed');

  return createPortal(
    <OverlayBackdrop onClose={launching ? undefined : onClose} className="z-[300] px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-panel w-full max-w-md"
      >
        <div className="border-b border-[var(--line)] px-5 py-4">
          <div id={titleId} className="text-lg font-semibold text-[var(--ink)]">{t('sub2api.launchCodex.dialog.title')}</div>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="flex items-start gap-2 text-sm leading-relaxed text-[var(--ink-muted)]">
            {check.kind === 'checking' && <LoaderIcon className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
            <span>{message}</span>
          </p>
          {showDownload && (
            <div className="rounded-lg border border-[var(--line)] bg-[var(--paper-inset)] px-3 py-2.5">
              <div className="text-xs font-medium text-[var(--ink-muted)]">{t('sub2api.launchCodex.dialog.downloadLabel')}</div>
              <a
                href={CODEX_DESKTOP_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => { event.preventDefault(); openDownload(); }}
                className="mt-1 block break-all text-sm font-medium text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent-hover)]"
              >
                {CODEX_DESKTOP_DOWNLOAD_URL}
              </a>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--line)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={launching}
            className="rounded-full bg-[var(--button-secondary-bg)] px-4 py-1.5 text-sm font-semibold text-[var(--button-secondary-text)] transition-colors hover:bg-[var(--button-secondary-bg-hover)] disabled:opacity-50"
          >
            {t(check.kind === 'installed' ? 'sub2api.launchCodex.dialog.cancel' : 'sub2api.launchCodex.dialog.close')}
          </button>
          {check.kind === 'installed' && (
            <button
              type="button"
              onClick={() => void go()}
              disabled={launching}
              className="flex items-center gap-1.5 rounded-full bg-[var(--button-primary-bg)] px-4 py-1.5 text-sm font-semibold text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)] disabled:opacity-50"
            >
              {launching && <LoaderIcon className="h-3 w-3 animate-spin" />}
              {t('sub2api.launchCodex.dialog.go')}
            </button>
          )}
          {showDownload && (
            <button
              type="button"
              onClick={openDownload}
              className="rounded-full bg-[var(--button-primary-bg)] px-4 py-1.5 text-sm font-semibold text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)]"
            >
              {t('sub2api.launchCodex.dialog.download')}
            </button>
          )}
        </div>
      </div>
    </OverlayBackdrop>,
    document.body,
  );
}
