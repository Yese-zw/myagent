import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import remarkGfm from 'remark-gfm';
import { CloseIcon, DocumentIcon, GlobeIcon, SettingsIcon, ShieldIcon } from '@/components/icons';
import OverlayBackdrop from '@/components/OverlayBackdrop';
import type { Sub2apiAgreement } from '@/api/sub2api';

const AgreementMarkdown = lazy(() => import('react-markdown'));

const markdown = {
  h1: ({ children }: { children?: ReactNode }) => <h1 className="mb-4 mt-2 border-b border-[var(--line)] pb-3 text-2xl font-bold text-[var(--ink)]">{children}</h1>,
  h2: ({ children }: { children?: ReactNode }) => <h2 className="mb-3 mt-7 text-xl font-bold text-[var(--ink)]">{children}</h2>,
  h3: ({ children }: { children?: ReactNode }) => <h3 className="mb-2 mt-6 text-lg font-semibold text-[var(--ink)]">{children}</h3>,
  h4: ({ children }: { children?: ReactNode }) => <h4 className="mb-2 mt-5 text-base font-semibold text-[var(--ink)]">{children}</h4>,
  p: ({ children }: { children?: ReactNode }) => <p className="mb-4 leading-7 text-[var(--ink-muted)]">{children}</p>,
  ul: ({ children }: { children?: ReactNode }) => <ul className="mb-4 list-disc space-y-1 pl-6 text-[var(--ink-muted)]">{children}</ul>,
  ol: ({ children }: { children?: ReactNode }) => <ol className="mb-4 list-decimal space-y-1 pl-6 text-[var(--ink-muted)]">{children}</ol>,
  li: ({ children }: { children?: ReactNode }) => <li className="leading-7">{children}</li>,
  blockquote: ({ children }: { children?: ReactNode }) => <blockquote className="my-5 border-l-4 border-[var(--line)] pl-4 text-[var(--ink-muted)]">{children}</blockquote>,
  code: ({ children }: { children?: ReactNode }) => <code className="rounded bg-[var(--paper-inset)] px-1.5 py-0.5 font-mono text-[13px] text-[var(--ink)]">{children}</code>,
  pre: ({ children }: { children?: ReactNode }) => <pre className="my-5 overflow-x-auto rounded-lg bg-[var(--paper-inset)] p-4 text-sm text-[var(--ink)]">{children}</pre>,
  table: ({ children }: { children?: ReactNode }) => <div className="my-5 overflow-x-auto"><table className="w-full min-w-[480px] border-collapse text-sm">{children}</table></div>,
  th: ({ children }: { children?: ReactNode }) => <th className="border border-[var(--line)] bg-[var(--paper-inset)] px-3 py-2 text-left font-semibold text-[var(--ink)]">{children}</th>,
  td: ({ children }: { children?: ReactNode }) => <td className="border border-[var(--line)] px-3 py-2 align-top text-[var(--ink-muted)]">{children}</td>,
  hr: () => <hr className="my-7 border-[var(--line)]" />,
  a: ({ children }: { children?: ReactNode }) => <span className="font-medium text-[var(--accent)] underline underline-offset-4">{children}</span>,
  img: () => null,
};

function documentIcon(title: string) {
  if (/政策|隐私|policy|privacy/i.test(title)) return ShieldIcon;
  if (/国家|地区|country|region/i.test(title)) return GlobeIcon;
  if (/特定|specific/i.test(title)) return SettingsIcon;
  return DocumentIcon;
}

export default function AgreementDocumentView({
  documents,
  current,
  onSelect,
  onClose,
}: {
  documents: Sub2apiAgreement[];
  current: Sub2apiAgreement;
  onSelect: (document: Sub2apiAgreement) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('app');
  const Icon = documentIcon(current.title);
  return (
    <OverlayBackdrop portal className="z-[270] px-4 py-6" onClose={onClose}>
      <article role="dialog" aria-modal="true" aria-labelledby="sub2api-agreement-title" className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-elevated)] shadow-2xl">
        <header className="shrink-0 border-b border-[var(--line)] px-6 py-5">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--paper-inset)] text-[var(--accent)]">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">{t('sub2api.legalType')}</p>
              <h2 id="sub2api-agreement-title" className="mt-1 break-words text-xl font-semibold text-[var(--ink)]">{current.title}</h2>
            </div>
            <button type="button" onClick={onClose} aria-label={t('sub2api.close')} className="rounded-lg p-2 text-[var(--ink-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]">
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          {documents.length > 1 && (
            <nav aria-label={t('sub2api.legalType')} className="mt-4 flex flex-wrap gap-2">
              {documents.map(item => {
                const TabIcon = documentIcon(item.title);
                const active = item.id === current.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onSelect(item)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${active ? 'bg-[var(--hover-bg)] text-[var(--ink)]' : 'text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]'}`}
                  >
                    <TabIcon className="h-3.5 w-3.5" />
                    {item.title}
                  </button>
                );
              })}
            </nav>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {current.content_md.trim()
            ? <div className="max-w-none"><Suspense fallback={<p className="text-sm text-[var(--ink-muted)]">{t('sub2api.loading')}</p>}><AgreementMarkdown skipHtml remarkPlugins={[remarkGfm]} components={markdown as Record<string, ComponentType>}>{current.content_md}</AgreementMarkdown></Suspense></div>
            : <p className="rounded-xl border border-dashed border-[var(--line)] px-6 py-14 text-center text-sm text-[var(--ink-muted)]">{t('sub2api.empty')}</p>}
        </div>
      </article>
    </OverlayBackdrop>
  );
}
