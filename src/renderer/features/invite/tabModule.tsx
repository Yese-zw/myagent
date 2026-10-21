import { lazy, memo, Suspense } from 'react';
import type { InviteTab } from './tabContract';
import type { TabModuleDefinition } from '@/tab-workspace/contracts';
import { PAGE_FALLBACK } from '@/tab-workspace/PageFallback';

const InvitePage = lazy(() => import('@/pages/Invite'));

const InviteTabRenderer = memo(function InviteTabRenderer({
  isActive,
  isDeferred,
}: { tab: InviteTab; isActive: boolean; isDeferred: boolean; binding: null }) {
  if (isDeferred) return PAGE_FALLBACK;
  return <Suspense fallback={PAGE_FALLBACK}><InvitePage isActive={isActive} /></Suspense>;
});

export const inviteTabModule = {
  kind: 'invite',
  render: InviteTabRenderer,
  chrome: (_tab, { t }) => ({ title: t('tabs.invite'), subtitle: t('tabs.invite') }),
  identity: () => 'invite',
  open: {
    findExisting: (tabs) => tabs[0],
    create: (intent, { id }) => ({ id, view: 'invite', title: intent.title }),
  },
  initialMount: () => 'deferred-content',
} satisfies TabModuleDefinition<InviteTab, { title: string }, null>;
