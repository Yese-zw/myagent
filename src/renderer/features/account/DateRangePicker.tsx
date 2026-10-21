import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarIcon, ChevronDownIcon, ChevronRightIcon } from '@/components/icons';

type Range = { start: string; end: string };

function formatDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
function today() {
  return formatDate(new Date());
}
function shiftDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

export default function DateRangePicker({
  startDate,
  endDate,
  onChange,
}: {
  startDate: string;
  endDate: string;
  onChange: (range: Range) => void;
}) {
  const { t, i18n } = useTranslation('app');
  const presets = useMemo(() => ([
    { value: 'today', label: t('sub2api.dashboard.dates.today'), range: () => ({ start: today(), end: today() }) },
    { value: 'yesterday', label: t('sub2api.dashboard.dates.yesterday'), range: () => ({ start: shiftDays(-1), end: shiftDays(-1) }) },
    { value: 'last24Hours', label: t('sub2api.dashboard.dates.last24Hours'), range: () => ({ start: shiftDays(-1), end: today() }) },
    { value: '7days', label: t('sub2api.dashboard.dates.last7Days'), range: () => ({ start: shiftDays(-6), end: today() }) },
    { value: '14days', label: t('sub2api.dashboard.dates.last14Days'), range: () => ({ start: shiftDays(-13), end: today() }) },
    { value: '30days', label: t('sub2api.dashboard.dates.last30Days'), range: () => ({ start: shiftDays(-29), end: today() }) },
    { value: 'thisMonth', label: t('sub2api.dashboard.dates.thisMonth'), range: () => ({ start: formatDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), end: today() }) },
    { value: 'lastMonth', label: t('sub2api.dashboard.dates.lastMonth'), range: () => {
      const now = new Date();
      return { start: formatDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: formatDate(new Date(now.getFullYear(), now.getMonth(), 0)) };
    } },
  ]), [t]);
  const matchPreset = (start: string, end: string) => presets.find(item => {
    const range = item.range();
    return range.start === start && range.end === end;
  })?.value ?? null;
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);
  const [preset, setPreset] = useState<string | null>(() => matchPreset(startDate, endDate));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  useEffect(() => {
    setDraftStart(startDate);
    setDraftEnd(endDate);
    setPreset(matchPreset(startDate, endDate));
  }, [endDate, presets, startDate]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (trigger) {
      const width = Math.max(320, trigger.width);
      const left = Math.min(Math.max(8, trigger.left), window.innerWidth - width - 8);
      setMenuStyle({ position: 'fixed', top: trigger.bottom + 4, left, minWidth: width, zIndex: 80 });
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const display = (() => {
    const current = presets.find(item => item.value === preset);
    if (current) return current.label;
    if (startDate && endDate) {
      const locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US';
      const format = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
      return startDate === endDate ? format(startDate) : `${format(startDate)} - ${format(endDate)}`;
    }
    return t('sub2api.dashboard.dates.selectDateRange');
  })();

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={`flex items-center gap-2 rounded-lg border bg-[var(--paper-elevated)] px-3 py-2 text-sm text-[var(--ink)] transition-colors hover:border-[var(--ink-muted)] ${open ? 'border-[var(--focus-border)] ring-2 ring-[var(--focus-border)]/30' : 'border-[var(--line)]'}`}
      >
        <CalendarIcon className="h-4 w-4 text-[var(--ink-muted)]" />
        <span className="font-medium">{display}</span>
        <ChevronDownIcon className={`h-4 w-4 text-[var(--ink-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div ref={menuRef} style={menuStyle} className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] shadow-lg">
          <div className="grid grid-cols-2 gap-1 p-2">
            {presets.map(item => (
              <button
                key={item.value}
                type="button"
                onClick={() => { const range = item.range(); setDraftStart(range.start); setDraftEnd(range.end); setPreset(item.value); }}
                className={`rounded-md px-3 py-1.5 text-left text-xs font-medium transition-colors ${preset === item.value ? 'bg-[var(--hover-bg)] text-[var(--ink)]' : 'text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="border-t border-[var(--line-subtle)]" />
          <div className="flex items-end gap-2 p-3">
            <label className="min-w-0 flex-1 text-xs font-medium text-[var(--ink-muted)]">{t('sub2api.dashboard.dates.startDate')}
              <input type="date" value={draftStart} max={draftEnd || shiftDays(1)} onChange={event => { setDraftStart(event.target.value); setPreset(matchPreset(event.target.value, draftEnd)); }} className="mt-1 w-full rounded-md border border-[var(--line)] bg-[var(--paper-inset)] px-2 py-1.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--focus-border)]" />
            </label>
            <ChevronRightIcon className="mb-2 h-4 w-4 text-[var(--ink-muted)]" />
            <label className="min-w-0 flex-1 text-xs font-medium text-[var(--ink-muted)]">{t('sub2api.dashboard.dates.endDate')}
              <input type="date" value={draftEnd} min={draftStart} max={shiftDays(1)} onChange={event => { setDraftEnd(event.target.value); setPreset(matchPreset(draftStart, event.target.value)); }} className="mt-1 w-full rounded-md border border-[var(--line)] bg-[var(--paper-inset)] px-2 py-1.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--focus-border)]" />
            </label>
          </div>
          <div className="flex justify-end p-2 pt-0">
            <button
              type="button"
              onClick={() => { onChange({ start: draftStart, end: draftEnd }); setOpen(false); }}
              className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-[var(--on-accent)]"
            >
              {t('sub2api.dashboard.dates.apply')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
