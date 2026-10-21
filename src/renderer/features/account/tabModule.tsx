import { lazy, memo, Suspense } from 'react';
import type { AccountTab } from './tabContract';
import type { TabModuleDefinition } from '@/tab-workspace/contracts';
import { PAGE_FALLBACK } from '@/tab-workspace/PageFallback';

const AccountPage = lazy(() => import('@/pages/Account'));

const AccountTabRenderer = memo(function AccountTabRenderer({
  isActive,
  isDeferred,
}: { tab: AccountTab; isActive: boolean; isDeferred: boolean; binding: null }) {
  if (isDeferred) return PAGE_FALLBACK;
  return <Suspense fallback={PAGE_FALLBACK}><AccountPage isActive={isActive} /></Suspense>;
});

export const accountTabModule = {
  kind: 'account',
  render: AccountTabRenderer,
  chrome: (_tab, { t }) => ({ title: t('tabs.account'), subtitle: t('tabs.account') }),
  identity: () => 'account',
  open: {
    findExisting: (tabs) => tabs[0],
    create: (intent, { id }) => ({ id, view: 'account', title: intent.title }),
  },
  initialMount: () => 'deferred-content',
} satisfies TabModuleDefinition<AccountTab, { title: string }, null>;
