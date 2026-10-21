import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import codexIcon from '@/assets/runtime-icons/codex.png';
import GoToCodexDialog from './GoToCodexDialog';

/** Launcher chip: asks before opening Codex, after checking that the desktop app is installed. */
export default function LaunchCodexButton() {
  const { t } = useTranslation('app');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('sub2api.launchCodex.hint')}
        className="flex h-full items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
      >
        <img src={codexIcon} alt="" aria-hidden="true" className="h-4 w-4 shrink-0 rounded-[23%]" draggable={false} />
        {t('sub2api.launchCodex.label')}
      </button>
      {open && <GoToCodexDialog onClose={() => setOpen(false)} />}
    </>
  );
}
