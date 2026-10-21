import type {
  NotificationSnapshot,
  Sub2apiAnnouncementNotificationItem,
} from './notificationCenter';

const MAX_ITEMS = 20;
const MAX_TITLE = 200;
const MAX_CONTENT = 100_000;
const EXCERPT_LENGTH = 140;

export function announcementExcerpt(content: string): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/[#>*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= EXCERPT_LENGTH) return plain;
  return `${plain.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

export function parseSub2apiAnnouncements(value: unknown): Sub2apiAnnouncementNotificationItem[] {
  if (!Array.isArray(value)) return [];
  const items: Sub2apiAnnouncementNotificationItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === 'number' ? record.id : Number.NaN;
    const title = text(record.title, MAX_TITLE);
    const createdAt = typeof record.created_at === 'string' ? record.created_at : '';
    const content = typeof record.content === 'string' ? record.content : '';
    if (!Number.isInteger(id) || id <= 0 || !title || !Number.isFinite(Date.parse(createdAt))) continue;
    if (content.length > MAX_CONTENT) continue;
    items.push({
      id: `sub2api-announcement:${id}`,
      kind: 'sub2api_announcement',
      announcementId: id,
      createdAt,
      isRead: typeof record.read_at === 'string' && record.read_at.trim().length > 0,
      title,
      content,
      excerpt: announcementExcerpt(content),
    });
  }
  items.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.announcementId - left.announcementId);
  return items.slice(0, MAX_ITEMS);
}

export function mergeSub2apiAnnouncements(
  snapshot: NotificationSnapshot,
  announcements: Sub2apiAnnouncementNotificationItem[],
): NotificationSnapshot {
  if (announcements.length === 0) return snapshot;
  const items = [...snapshot.items, ...announcements].sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
  ));
  const hasUnread = snapshot.hasUnread || items.some((item) => !item.isRead);
  return {
    ...snapshot,
    items,
    hasUnread,
    loadState: snapshot.loadState === 'loading' ? 'ready' : snapshot.loadState,
  };
}
