import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { sub2api, sub2apiErrorCode } from '@/api/sub2api';
import { isTauriEnvironment } from '@/utils/browserMock';
import { listenWithCleanup } from '@/utils/tauriListen';
import {
  EMPTY_NOTIFICATION_SNAPSHOT,
  getNotificationSnapshot,
  loadMoreNotifications,
  markAllNotificationsRead,
  requestNotificationRefresh,
  type NotificationSnapshot,
  type Sub2apiAnnouncementNotificationItem,
} from './notificationCenter';
import { mergeSub2apiAnnouncements, parseSub2apiAnnouncements } from './sub2apiAnnouncements';

export interface NotificationCenterController {
  snapshot: NotificationSnapshot;
  refresh: () => void;
  loadMore: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markSub2apiRead: (announcementId: number) => Promise<void>;
}

function signedOut(error: unknown): boolean {
  const code = sub2apiErrorCode(error);
  return code === 'UNAUTHORIZED' || code === 'USER_DISABLED' || code === 'DESKTOP_REQUIRED';
}

export function useNotificationCenter(): NotificationCenterController {
  const [cloud, setCloud] = useState<NotificationSnapshot>(EMPTY_NOTIFICATION_SNAPSHOT);
  const [announcements, setAnnouncements] = useState<Sub2apiAnnouncementNotificationItem[]>([]);
  const announcementsRef = useRef(announcements);
  const cloudRef = useRef(cloud);
  const readIdsRef = useRef(new Set<number>());
  const generationRef = useRef(0);
  const userIdRef = useRef<number | null>(null);

  useEffect(() => {
    announcementsRef.current = announcements;
  }, [announcements]);
  useEffect(() => {
    cloudRef.current = cloud;
  }, [cloud]);

  const loadAnnouncements = useCallback(async () => {
    const current = ++generationRef.current;
    try {
      const account = await sub2api.account(false);
      if (current !== generationRef.current) return;
      const userId = account.user?.id ?? null;
      if (userId !== userIdRef.current) {
        readIdsRef.current.clear();
        userIdRef.current = userId;
      }
      if (!userId) {
        setAnnouncements([]);
        return;
      }
      const data = await sub2api.accountApi('announcements');
      if (current !== generationRef.current) return;
      setAnnouncements(parseSub2apiAnnouncements(data).map((item) => (
        readIdsRef.current.has(item.announcementId) ? { ...item, isRead: true } : item
      )));
    } catch (error) {
      if (current !== generationRef.current) return;
      if (signedOut(error)) {
        readIdsRef.current.clear();
        userIdRef.current = null;
        setAnnouncements([]);
      }
    }
  }, []);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let cancelled = false;
    const ac = new AbortController();
    void getNotificationSnapshot()
      .then((next) => {
        if (!cancelled) setCloud(next);
      })
      .catch(() => {
        if (!cancelled) {
          setCloud((current) => ({
            ...current,
            loadState: 'error',
            errorCode: 'unavailable',
          }));
        }
      });
    void listenWithCleanup<NotificationSnapshot>(
      'notification-center:updated',
      (event) => {
        if (cancelled) return;
        setCloud(event.payload);
        void loadAnnouncements();
      },
      ac.signal,
    );
    void listenWithCleanup('sub2api-account:changed', () => {
      if (!cancelled) void loadAnnouncements();
    }, ac.signal);
    queueMicrotask(() => {
      if (!cancelled) void loadAnnouncements();
    });

    const wake = () => { void requestNotificationRefresh(); };
    const wakeWhenVisible = () => {
      if (document.visibilityState === 'visible') wake();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wakeWhenVisible);
    return () => {
      cancelled = true;
      generationRef.current += 1;
      ac.abort();
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wakeWhenVisible);
    };
  }, [loadAnnouncements]);

  const refresh = useCallback(() => {
    if (!isTauriEnvironment()) return;
    void requestNotificationRefresh();
    void loadAnnouncements();
  }, [loadAnnouncements]);

  const loadMore = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    setCloud(await loadMoreNotifications());
  }, []);

  const markSub2apiRead = useCallback(async (announcementId: number) => {
    readIdsRef.current.add(announcementId);
    setAnnouncements((current) => current.map((item) => (
      item.announcementId === announcementId ? { ...item, isRead: true } : item
    )));
    try {
      await sub2api.accountApi('announcement-read', { id: announcementId });
    } catch (error) {
      readIdsRef.current.delete(announcementId);
      if (signedOut(error)) {
        userIdRef.current = null;
        setAnnouncements([]);
        return;
      }
      await loadAnnouncements();
    }
  }, [loadAnnouncements]);

  const markAllRead = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    const pending = announcementsRef.current.filter((item) => !item.isRead);
    for (const item of pending) readIdsRef.current.add(item.announcementId);
    if (pending.length > 0) {
      setAnnouncements((current) => current.map((item) => (
        readIdsRef.current.has(item.announcementId) ? { ...item, isRead: true } : item
      )));
    }
    const jobs: Promise<unknown>[] = [];
    if (cloudRef.current.feedCutoff) {
      jobs.push(markAllNotificationsRead().then((next) => setCloud(next)));
    }
    for (const item of pending) {
      jobs.push(sub2api.accountApi('announcement-read', { id: item.announcementId }).catch((error: unknown) => {
        readIdsRef.current.delete(item.announcementId);
        if (signedOut(error)) {
          userIdRef.current = null;
          setAnnouncements([]);
        }
      }));
    }
    await Promise.all(jobs);
    if (pending.some((item) => !readIdsRef.current.has(item.announcementId))) {
      await loadAnnouncements();
    }
  }, [loadAnnouncements]);

  const snapshot = useMemo(
    () => mergeSub2apiAnnouncements(cloud, announcements),
    [announcements, cloud],
  );

  return { snapshot, refresh, loadMore, markAllRead, markSub2apiRead };
}
