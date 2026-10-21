import { describe, expect, it } from 'vitest';

import { EMPTY_NOTIFICATION_SNAPSHOT } from './notificationCenter';
import {
  announcementExcerpt,
  mergeSub2apiAnnouncements,
  parseSub2apiAnnouncements,
} from './sub2apiAnnouncements';

describe('sub2api announcements', () => {
  it('keeps visible notices, drops malformed rows, and sorts newest first', () => {
    const items = parseSub2apiAnnouncements([
      { id: 2, title: '较早', content: '正文', created_at: '2026-10-01T00:00:00.000Z', read_at: null },
      { id: 0, title: '无效', content: '丢弃', created_at: '2026-10-03T00:00:00.000Z' },
      { id: 3, title: '最新', content: '**重点** 内容', created_at: '2026-10-02T00:00:00.000Z', read_at: '2026-10-02T01:00:00.000Z' },
      { id: '4', title: '字符串编号', content: '丢弃', created_at: '2026-10-04T00:00:00.000Z' },
    ]);

    expect(items.map((item) => item.announcementId)).toEqual([3, 2]);
    expect(items[0]).toMatchObject({ isRead: true, excerpt: '重点 内容', id: 'sub2api-announcement:3' });
    expect(items[1].isRead).toBe(false);
  });

  it('collapses markdown into a short plain excerpt', () => {
    const excerpt = announcementExcerpt('# 标题\n\n查看 [详情](https://example.com) 和 `代码`。');
    expect(excerpt).toBe('标题 查看 详情 和 代码。');
    expect(announcementExcerpt('a'.repeat(180)).endsWith('…')).toBe(true);
  });

  it('merges notices into the message center without hiding an in-flight cloud feed', () => {
    const notice = parseSub2apiAnnouncements([
      { id: 8, title: '维护公告', content: '今晚升级', created_at: '2026-10-21T12:00:00.000Z', read_at: null },
    ])[0];
    const merged = mergeSub2apiAnnouncements({
      ...EMPTY_NOTIFICATION_SNAPSHOT,
      loadState: 'loading',
      items: [{
        id: 'task-comment:1',
        kind: 'task_agent_comment',
        createdAt: '2026-10-21T11:00:00.000Z',
        isRead: true,
        taskId: 'task-1',
        taskName: '任务',
        commentId: '1',
        agent: { type: 'registered_agent', id: 'agent-1', displayName: 'Agent' },
        excerpt: '已完成',
        target: { kind: 'app_route', route: { version: 1, name: 'task.comment', params: { taskId: 'task-1', commentId: '1' } } },
      }],
    }, [notice]);

    expect(merged.loadState).toBe('ready');
    expect(merged.hasUnread).toBe(true);
    expect(merged.items.map((item) => item.id)).toEqual(['sub2api-announcement:8', 'task-comment:1']);
  });
});
