import { lazy, memo, Suspense } from 'react';
import type { RechargeTab } from './tabContract';
import type { TabModuleDefinition } from '@/tab-workspace/contracts';
import { PAGE_FALLBACK } from '@/tab-workspace/PageFallback';

const RechargePage = lazy(() => import('@/pages/Recharge'));

const RechargeTabRenderer = memo(function RechargeTabRenderer({
  isActive,
  isDeferred,
}: { tab: RechargeTab; isActive: boolean; isDeferred: boolean; binding: null }) {
  if (isDeferred) return PAGE_FALLBACK;
  return <Suspense fallback={PAGE_FALLBACK}><RechargePage isActive={isActive} /></Suspense>;
});

export const rechargeTabModule = {
  kind: 'recharge',
  render: RechargeTabRenderer,
  chrome: (_tab, { t }) => ({ title: t('tabs.recharge'), subtitle: t('tabs.recharge') }),
  identity: () => 'recharge',
  open: {
    findExisting: (tabs) => tabs[0],
    create: (intent, { id }) => ({ id, view: 'recharge', title: intent.title }),
  },
  initialMount: () => 'deferred-content',
} satisfies TabModuleDefinition<RechargeTab, { title: string }, null>;
