import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { LoaderIcon } from '@/components/icons';
import OverlayBackdrop from '@/components/OverlayBackdrop';

export type ForceUpdatePhase = 'downloading' | 'ready' | 'installing' | 'failed';

export function forceUpdatePhase(state: {
    installing: boolean;
    installable: boolean;
    failed: boolean;
}): ForceUpdatePhase {
    if (state.installing) return 'installing';
    if (state.installable) return 'ready';
    if (state.failed) return 'failed';
    return 'downloading';
}

interface ForceUpdateDialogProps {
    version: string;
    notes: string;
    phase: ForceUpdatePhase;
    /** When false, keyboard events pass through to a confirmation layered above this dialog. */
    captureKeyboard?: boolean;
    onUpdate: () => void;
}

/**
 * Blocking update dialog. It has no dismiss path: the backdrop, Escape, and
 * Cmd+W do not close it. The only action is to install the published release.
 */
export default function ForceUpdateDialog({
    version,
    notes,
    phase,
    captureKeyboard = true,
    onUpdate,
}: ForceUpdateDialogProps) {
    const { t } = useTranslation('app');
    const actionable = phase === 'ready' || phase === 'failed';
    const notesText = notes.trim();

    useEffect(() => {
        if (!captureKeyboard) return;
        const block = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const insideDialog = Boolean(target?.closest('[data-force-update-dialog]'));
            if (insideDialog && (event.key === 'Enter' || event.key === ' ' || event.key === 'Tab')) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
        };
        window.addEventListener('keydown', block, true);
        return () => window.removeEventListener('keydown', block, true);
    }, [captureKeyboard]);

    const actionLabel = phase === 'ready'
        ? t('appChrome.forceUpdateNow')
        : phase === 'installing'
            ? t('appChrome.forceUpdateInstalling')
            : phase === 'failed'
                ? t('appChrome.forceUpdateRetry')
                : t('appChrome.forceUpdateDownloading');

    return (
        <OverlayBackdrop portal className="z-[400] px-4">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="force-update-title"
                data-force-update-dialog
                className="glass-panel flex max-h-[min(32rem,calc(100vh-4rem))] w-full max-w-lg flex-col"
            >
                <div className="border-b border-[var(--line)] px-5 py-4">
                    <div id="force-update-title" className="break-words text-lg font-semibold text-[var(--ink)]">
                        {t('appChrome.forceUpdateTitle')}
                    </div>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">
                        {t('appChrome.forceUpdateVersion', { version })}
                    </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    <div className="text-sm font-medium text-[var(--ink)]">{t('appChrome.forceUpdateNotes')}</div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--ink-muted)]">
                        {notesText || t('appChrome.forceUpdateEmptyNotes')}
                    </p>
                </div>
                <div className="flex justify-end border-t border-[var(--line)] px-5 py-3">
                    <button
                        type="button"
                        onClick={onUpdate}
                        disabled={!actionable}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--button-primary-bg)] px-4 py-1.5 text-sm font-semibold text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)] disabled:opacity-50"
                    >
                        {!actionable && <LoaderIcon className="h-3 w-3 animate-spin" />}
                        {actionLabel}
                    </button>
                </div>
            </div>
        </OverlayBackdrop>
    );
}
