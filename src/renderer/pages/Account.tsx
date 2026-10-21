import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchiveIcon, HistoryIcon, LoaderIcon, RefreshIcon, TagIcon, type AppIconComponent } from '@/components/icons';
import ConfirmDialog from '@/components/ConfirmDialog';
import { sub2api, sub2apiErrorCode } from '@/api/sub2api';
import AvailableModelsWorkspace from '@/features/account/AvailableModelsWorkspace';
import DashboardWorkspace from '@/features/account/DashboardWorkspace';
import ProfileWorkspace from '@/features/account/ProfileWorkspace';
import { useSub2apiAccount } from '@/features/account/useSub2apiAccount';
import type { AccountSection } from '@/features/account/tabContract';

type RecordValue = Record<string, unknown>;
type PageData = { items: RecordValue[]; total: number; page: number; page_size: number };
const sectionKeys: AccountSection[] = ['dashboard', 'profile', 'models', 'keys', 'usage', 'orders', 'redeem'];
const field = 'w-full rounded-lg border border-[var(--line)] bg-[var(--paper-elevated)] px-3 py-2.5 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--focus-border)] focus:outline-none';
const primary = 'rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--hover-bg)] disabled:opacity-50';

function record(value: unknown): RecordValue { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}; }
function pageData(value: unknown): PageData {
  const source = record(value);
  const items = Array.isArray(value) ? value : Array.isArray(source.items) ? source.items : [];
  return { items: items.filter((item): item is RecordValue => !!item && typeof item === 'object'), total: Number(source.total ?? items.length), page: Number(source.page ?? 1), page_size: Number(source.page_size ?? (items.length || 20)) };
}
function display(value: unknown, fallback = '—') { return typeof value === 'string' && value ? value : value == null ? fallback : String(value); }
function date(value: unknown) { if (!value) return '—'; const parsed = new Date(String(value)); return Number.isNaN(parsed.valueOf()) ? display(value) : parsed.toLocaleString(); }
function money(value: unknown) { const n = Number(value); return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—'; }

export default function Account({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation('app');
  const { account, accept, service } = useSub2apiAccount();
  const [section, setSection] = useState<AccountSection>('dashboard');
  const [pages, setPages] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const sequence = useRef(0);
  const cacheKey = `${section}:${page}`;
  const hasCachedPage = Object.hasOwn(pages, cacheKey);
  const load = useCallback(async () => {
    if (!account.user || section === 'dashboard' || section === 'models') return;
    const current = ++sequence.current;
    const key = cacheKey;
    setError(null);
    setRefreshing(true);
    try {
      const next = section === 'profile'
        ? await sub2api.accountApi('profile')
        : section === 'redeem'
          ? await sub2api.accountApi('redeem-history', { page, page_size: 20 })
          : await sub2api.accountApi(section, { page, page_size: 20 });
      if (current === sequence.current) setPages(value => ({ ...value, [key]: next }));
    } catch (reason) {
      if (current === sequence.current) setError(t(`sub2api.errors.${sub2apiErrorCode(reason)}`, { defaultValue: t('sub2api.errors.UNKNOWN') }));
    } finally {
      if (current === sequence.current) setRefreshing(false);
    }
  }, [account.user, cacheKey, section, t]);
  useEffect(() => {
    if (isActive) void load();
  }, [isActive, load, refreshKey]);
  const tabs = useMemo(() => sectionKeys.map(key => ({ key, label: t(`sub2api.accountTabs.${key}`) })), [t]);
  const dataPage = pageData(pages[cacheKey]);
  const setSectionAndReset = (next: AccountSection) => { setPage(1); setSection(next); setError(null); };
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try { accept(await sub2api.logout()); }
    catch (reason) { setError(t(`sub2api.errors.${sub2apiErrorCode(reason)}`, { defaultValue: t('sub2api.errors.UNKNOWN') })); }
    finally { setSigningOut(false); }
  };
  return <main className="settings-root flex h-full min-h-0 bg-[var(--paper)] text-[var(--ink)]">
    {account.user && <aside className="settings-sidebar w-52 shrink-0 p-6">
      <div className="mb-6 flex items-center justify-between"><h1 className="text-xl font-semibold text-[var(--ink)]">{t('sub2api.title')}</h1><button type="button" title={t('sub2api.refresh')} aria-label={t('sub2api.refresh')} aria-busy={refreshing} disabled={refreshing} onClick={() => setRefreshKey(value => value + 1)} className="rounded-lg p-2 text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] disabled:cursor-wait disabled:opacity-50"><RefreshIcon className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button></div>
      <nav aria-label={t('sub2api.accountTabsLabel')} className="settings-nav overflow-x-auto space-y-1">{tabs.map(tab => <button key={tab.key} type="button" onClick={() => setSectionAndReset(tab.key)} aria-current={section === tab.key ? 'page' : undefined} className={`w-full rounded-lg px-3 py-2.5 text-left text-base font-medium transition-colors ${section === tab.key ? 'settings-nav-active bg-[var(--hover-bg)] text-[var(--ink)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}>{tab.label}</button>)}</nav>
    </aside>}
    <div className="h-full min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className={`mx-auto px-8 pb-8 pt-7 ${section === 'dashboard' ? 'max-w-6xl' : 'max-w-4xl'}`}>
      {!account.user ? <section className="flex min-h-[60vh] items-center justify-center text-center"><div><h2 className="text-lg font-semibold">{t('sub2api.accountRequired')}</h2><p className="mt-2 text-sm text-[var(--ink-muted)]">{t('sub2api.accountRequiredHint')}</p><button type="button" className={`${primary} mt-4`} onClick={() => window.dispatchEvent(new Event('sub2api-account:open-login'))}>{t('sub2api.signIn')}</button></div></section> : <>
        <header className="mb-7 flex flex-wrap items-center justify-between gap-5">
          <div className="min-w-0 flex-1 basis-72"><h2 className="text-xl font-semibold text-[var(--ink)]">{tabs.find(tab => tab.key === section)?.label}</h2></div>
          <button type="button" disabled={signingOut} onClick={() => void signOut()} className={secondary}>{signingOut ? t('sub2api.processing') : t('sub2api.signOut')}</button>
        </header>
        <section className="min-h-0">
          {error ? <div className="space-y-3"><p role="alert" className="text-sm text-[var(--error)]">{error}</p><button type="button" disabled={refreshing} onClick={() => void load()} className={secondary}>{refreshing ? <span className="inline-flex items-center gap-2"><LoaderIcon className="h-3.5 w-3.5 animate-spin" />{t('sub2api.retry')}</span> : t('sub2api.retry')}</button></div> : refreshing && !hasCachedPage && section !== 'profile' && section !== 'dashboard' && section !== 'models'
            ? <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label={t('sub2api.refresh')}><LoaderIcon className="h-8 w-8 animate-spin text-[var(--ink-muted)]" /></div> : section === 'dashboard'
            ? <DashboardWorkspace isActive={isActive} reloadToken={refreshKey} onBusy={setRefreshing} />
            : section === 'profile'
            ? <ProfileWorkspace profile={record(pages[cacheKey])} account={account} settings={service.settings} onAccount={accept} />
            : section === 'models'
              ? <AvailableModelsWorkspace isActive={isActive} reloadToken={refreshKey} onBusy={setRefreshing} />
            : section === 'keys'
              ? <KeysPanel data={dataPage} onRefresh={() => setRefreshKey(value => value + 1)} />
              : section === 'usage'
                ? <UsagePanel data={dataPage} />
                : section === 'orders'
                  ? <OrdersPanel data={dataPage} onRefresh={() => setRefreshKey(value => value + 1)} />
                  : <RedeemPanel data={dataPage} onRefresh={() => setRefreshKey(value => value + 1)} />}
          {!error && section !== 'profile' && section !== 'dashboard' && section !== 'models' && dataPage.total > dataPage.page_size && <Pager page={page} pageSize={dataPage.page_size} total={dataPage.total} onPage={setPage} />}
        </section>
      </>}
      </div>
    </div>
  </main>;
}

function EmptyRecords({ icon: Icon, title, hint }: { icon: AppIconComponent; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--line)] bg-[var(--paper-elevated)] px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--paper-inset)] text-[var(--ink-muted)]">
        <Icon className="h-6 w-6" />
      </span>
      <p className="mt-4 text-sm font-medium text-[var(--ink)]">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-6 text-[var(--ink-muted)]">{hint}</p>
    </div>
  );
}

function KeysPanel({ data, onRefresh }: { data: PageData; onRefresh: () => void }) {
  const { t } = useTranslation('app');
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [pendingDelete, setPendingDelete] = useState<unknown>(undefined);
  const mutate = async (operation: string, payload: RecordValue) => { setBusy(true); setMessage(''); try { await sub2api.accountApi(operation, payload); onRefresh(); } catch (reason) { setMessage(t(`sub2api.errors.${sub2apiErrorCode(reason)}`, { defaultValue: t('sub2api.errors.UNKNOWN') })); } finally { setBusy(false); } };
  const create = async () => { if (!name.trim()) return; await mutate('create-key', { name: name.trim() }); setName(''); };
  return <div><p className="text-sm text-[var(--ink-muted)]">{t('sub2api.keysHint')}</p><form className="mt-5 flex max-w-xl gap-2" onSubmit={event => { event.preventDefault(); void create(); }}><input aria-label={t('sub2api.keyName')} value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder={t('sub2api.keyName')} className={`${field} min-w-0 flex-1`} /><button disabled={busy || !name.trim()} className={primary}>{t('sub2api.createKey')}</button></form>
    {message && <p role="status" className="mt-3 text-sm text-[var(--ink-muted)]">{message}</p>}{data.items.length === 0 ? <p className="mt-6 text-sm text-[var(--ink-muted)]">{t('sub2api.empty')}</p> : <div className="mt-5 space-y-3">{data.items.map(item => <article key={String(item.id)} className="rounded-lg border border-[var(--line-subtle)] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-medium">{display(item.name)}</h3><p className="mt-1 break-all font-mono text-xs text-[var(--ink-muted)]">{display(item.key)}</p><p className="mt-2 text-xs text-[var(--ink-muted)]">{t('sub2api.keyStatus')}: {display(item.status)} · {t('sub2api.createdAt')}: {date(item.created_at)}</p></div><div className="flex gap-2"><button type="button" disabled={busy} className={secondary} onClick={() => void mutate('update-key', { id: item.id, status: item.status === 'active' ? 'inactive' : 'active' })}>{item.status === 'active' ? t('sub2api.disable') : t('sub2api.enable')}</button><button type="button" disabled={busy} className={secondary} onClick={() => setPendingDelete(item.id)}>{t('sub2api.delete')}</button></div></div></article>)}</div>}{pendingDelete !== undefined && <ConfirmDialog title={t('sub2api.delete')} message={t('sub2api.deleteKeyConfirm')} confirmVariant="danger" confirmText={t('sub2api.delete')} cancelText={t('sub2api.back')} onConfirm={() => { const id = pendingDelete; setPendingDelete(undefined); void mutate('delete-key', { id }); }} onCancel={() => setPendingDelete(undefined)} />}</div>;
}

function UsagePanel({ data }: { data: PageData }) {
  const { t } = useTranslation('app');
  if (data.items.length === 0) {
    return <EmptyRecords icon={HistoryIcon} title={t('sub2api.emptyState.usageTitle')} hint={t('sub2api.emptyState.usageHint')} />;
  }
  return <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)]"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b border-[var(--line)] text-xs text-[var(--ink-muted)]">{['created_at', 'model', 'request_type', 'input_tokens', 'output_tokens', 'actual_cost'].map(key => <th key={key} className="px-3 py-3 font-medium">{t(`sub2api.fields.${key}`)}</th>)}</tr></thead><tbody>{data.items.map((item, i) => <tr key={String(item.id ?? i)} className="border-b border-[var(--line-subtle)] last:border-b-0"><td className="px-3 py-3">{date(item.created_at)}</td><td className="px-3 py-3">{display(item.model)}</td><td className="px-3 py-3">{display(item.request_type)}</td><td className="px-3 py-3">{display(item.input_tokens)}</td><td className="px-3 py-3">{display(item.output_tokens)}</td><td className="px-3 py-3">{money(item.actual_cost ?? item.total_cost)}</td></tr>)}</tbody></table></div>;
}

function OrdersPanel({ data, onRefresh }: { data: PageData; onRefresh: () => void }) {
  const { t } = useTranslation('app'); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [pendingCancel, setPendingCancel] = useState<unknown>(undefined);
  const cancel = async (id: unknown) => { setBusy(true); setMessage(''); try { await sub2api.accountApi('cancel-order', { id }); onRefresh(); } catch (reason) { setMessage(t(`sub2api.errors.${sub2apiErrorCode(reason)}`, { defaultValue: t('sub2api.errors.UNKNOWN') })); } finally { setBusy(false); } };
  return <div>{message && <p role="alert" className="mb-4 text-sm text-[var(--error)]">{message}</p>}{data.items.length === 0 ? <EmptyRecords icon={ArchiveIcon} title={t('sub2api.emptyState.ordersTitle')} hint={t('sub2api.emptyState.ordersHint')} /> : <div className="space-y-3">{data.items.map((item, i) => <article key={String(item.id ?? i)} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-4"><div><p className="font-medium">{money(item.amount)} · {display(item.order_type)}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{display(item.out_trade_no)} · {date(item.created_at)}</p></div><div className="flex items-center gap-3"><span className="text-sm text-[var(--ink-muted)]">{display(item.status)}</span>{item.status === 'pending' && <button type="button" disabled={busy} className={secondary} onClick={() => setPendingCancel(item.id)}>{t('sub2api.cancelOrder')}</button>}</div></article>)}</div>}{pendingCancel !== undefined && <ConfirmDialog title={t('sub2api.cancelOrder')} message={t('sub2api.cancelOrderConfirm')} confirmVariant="danger" confirmText={t('sub2api.cancelOrder')} cancelText={t('sub2api.back')} onConfirm={() => { const id = pendingCancel; setPendingCancel(undefined); void cancel(id); }} onCancel={() => setPendingCancel(undefined)} />}</div>;
}

function RedeemPanel({ data, onRefresh }: { data: PageData; onRefresh: () => void }) {
  const { t } = useTranslation('app'); const [code, setCode] = useState(''); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false);
  const redeem = async () => { if (!code.trim()) return; setBusy(true); setStatus(''); try { await sub2api.accountApi('redeem', { code: code.trim() }); setStatus(t('sub2api.redeemSuccess')); setCode(''); onRefresh(); } catch (reason) { setStatus(t(`sub2api.errors.${sub2apiErrorCode(reason)}`, { defaultValue: t('sub2api.errors.UNKNOWN') })); } finally { setBusy(false); } };
  return <div>
    <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-5">
      <div className="flex max-w-lg gap-2"><input value={code} onChange={event => setCode(event.target.value)} placeholder={t('sub2api.redeemPlaceholder')} className={`${field} min-w-0 flex-1`} /><button type="button" disabled={busy || !code.trim()} onClick={() => void redeem()} className={primary}>{busy ? t('sub2api.processing') : t('sub2api.redeem')}</button></div>
      {status && <p role="status" className="mt-3 text-sm text-[var(--ink-muted)]">{status}</p>}
    </div>
    <h3 className="mt-8 text-sm font-semibold text-[var(--ink)]">{t('sub2api.redeemHistory')}</h3>
    {data.items.length === 0
      ? <div className="mt-3"><EmptyRecords icon={TagIcon} title={t('sub2api.emptyState.redeemTitle')} hint={t('sub2api.emptyState.redeemHint')} /></div>
      : <ul className="mt-3 space-y-2 text-sm text-[var(--ink-muted)]">{data.items.map((item, index) => <li key={String(item.id ?? index)} className="rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] px-4 py-3">{display(item.code)} · {display(item.type)} · {display(item.status)} · {date(item.used_at ?? item.created_at)}</li>)}</ul>}
  </div>;
}

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const { t } = useTranslation('app'); const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return <div className="mt-5 flex items-center justify-end gap-3 border-t border-[var(--line-subtle)] pt-4 text-sm text-[var(--ink-muted)]"><span>{page} / {pages} · {total}</span><button type="button" className={secondary} disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('sub2api.previous')}</button><button type="button" className={secondary} disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('sub2api.next')}</button></div>;
}
