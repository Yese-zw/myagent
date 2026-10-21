// Builtin-edition Tab model and shared constructors.

import type { ChatTab, InitialMessage, SidecarConfigDisposition } from '@/features/chat/tabContract';
import type { LauncherTab } from '@/features/launcher/tabContract';
import type { SettingsTab } from '@/features/settings/tabContract';
import type { CapabilitiesTab } from '@/features/capabilities/tabContract';
import type { TaskCenterTab } from '@/features/task-center/tabContract';
import type { RecordTab } from '@/features/record/tabContract';
import type { AccountTab } from '@/features/account/tabContract';
import type { RechargeTab } from '@/features/recharge/tabContract';
import type { InviteTab } from '@/features/invite/tabContract';

export type { TabBase } from '@/tab-workspace/contracts';
export type {
  ChatTab,
  FilePreviewIntent,
  InitialMessage,
  InitialMessageCron,
  LaunchSessionBirthHint,
  SidecarConfigDisposition,
} from '@/features/chat/tabContract';
export type { LauncherTab } from '@/features/launcher/tabContract';
export type { SettingsNavigationIntent, SettingsTab } from '@/features/settings/tabContract';
export type {
  CapabilitiesNavigationIntent,
  CapabilitiesTab,
  CapabilitySection,
} from '@/features/capabilities/tabContract';
export type { TaskCenterSearchIntent, TaskCenterTab } from '@/features/task-center/tabContract';
export type { RecordTab } from '@/features/record/tabContract';
export type { AccountTab } from '@/features/account/tabContract';
export type { RechargeTab } from '@/features/recharge/tabContract';
export type { InviteTab } from '@/features/invite/tabContract';

/** Closed union for the builtin LSAGENT edition. Downstream editions extend
 * their own closed union and composition explicitly. */
export type Tab = LauncherTab | ChatTab | SettingsTab | CapabilitiesTab | TaskCenterTab | RecordTab | AccountTab | RechargeTab | InviteTab;

export type TabKind = Tab['view'];
export type TabOf<K extends TabKind> = Extract<Tab, { view: K }>;

export interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
}

export const MAX_TABS = 12;

export function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateSessionTitle(firstMessage: string): string {
  const maxLength = 20;
  const trimmed = firstMessage.trim();
  if (!trimmed) return 'New Chat';
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

export function getFolderName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function createNewTab(): LauncherTab {
  return {
    id: generateTabId(),
    view: 'launcher',
    title: 'New Tab',
  };
}

/** Canonical, type-safe transition from an existing shell Tab to Chat. */
export function buildChatFlipPatch(
  tab: Tab,
  fields: {
    agentDir: string;
    sessionId: string;
    title: string;
    initialMessage?: InitialMessage;
    sidecarConfigDisposition: SidecarConfigDisposition;
  },
): ChatTab {
  if (!fields.sessionId) {
    throw new Error(
      'buildChatFlipPatch: sessionId must be a non-empty id (D1) — flipping to chat without one strands the tab',
    );
  }
  const initialMessage = fields.initialMessage ?? (tab.view === 'chat' ? tab.initialMessage : undefined);
  return {
    id: tab.id,
    agentDir: fields.agentDir,
    sessionId: fields.sessionId,
    view: 'chat',
    title: fields.title,
    ...(initialMessage ? { initialMessage } : {}),
    discussionId: initialMessage?.discussionId ?? (tab.view === 'chat' ? tab.discussionId : undefined),
    sidecarConfigDisposition: fields.sidecarConfigDisposition,
    ...(tab.view === 'chat'
      ? {
          isGenerating: tab.isGenerating,
          hasUnread: tab.hasUnread,
          pendingFilePreview: tab.pendingFilePreview,
        }
      : {}),
  };
}
