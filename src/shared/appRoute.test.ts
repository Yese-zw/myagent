import routeFixtures from './appRoute.fixtures.json';
import { describe, expect, it } from 'vitest';

import {
  createTaskCommentAppRoute,
  parseAppRouteUrl,
  serializeAppRoute,
} from './appRoute';

describe('AppRoute', () => {
  it('matches the shared native route corpus', () => {
    for (const { url, route } of routeFixtures.accepted) {
      expect(parseAppRouteUrl(url), url).toEqual(route);
      expect(parseAppRouteUrl(serializeAppRoute(route as Parameters<typeof serializeAppRoute>[0]))).toEqual(route);
    }
    for (const url of routeFixtures.rejected) expect(parseAppRouteUrl(url), url).toBeNull();
  });

  it('round-trips supported v1 routes', () => {
    const commentRoute = createTaskCommentAppRoute('task_1', 'comment-2');
    expect(serializeAppRoute(commentRoute)).toBe(
      'myagents://open/v1/tasks/task_1/comments/comment-2',
    );
    expect(parseAppRouteUrl(serializeAppRoute(commentRoute))).toEqual(commentRoute);
  });

  it.each([
    'myagents://attachment/session/file.png',
    'myagents://tool-attachment/session/turn/file.png',
    'myagents-resource://attachment/session/file.png',
    'myagents://evil/v1/tasks/a/comments/b',
    'myagents://open/v2/tasks/a/comments/b',
    'myagents://open/v1/tasks/a/comments/b/extra',
    'myagents://open/v1/tasks/a/issues/b',
    'myagents://open/v1/spaces/a/issues/b',
    'myagents://open//v1/tasks/a/comments/b',
    'myagents://open/v1/tasks/a/comments/b?prompt=run',
    'myagents://open/v1/tasks/a/comments/b#fragment',
    'myagents://open/v1/tasks/a%2Fb/comments/c',
    'myagents://open/v1/tasks/a/comments/%ZZ',
    'myagents://user@open/v1/tasks/a/comments/b',
    'myagents://open:42/v1/tasks/a/comments/b',
  ])('rejects unsupported or ambiguous input: %s', (value) => {
    expect(parseAppRouteUrl(value)).toBeNull();
  });

  it('bounds identifiers before serialization', () => {
    expect(() => createTaskCommentAppRoute('task', '')).toThrow();
    expect(() => createTaskCommentAppRoute('task', 'x'.repeat(201))).toThrow();
    expect(() => createTaskCommentAppRoute('', 'comment')).toThrow();
    expect(() => createTaskCommentAppRoute('x'.repeat(201), 'comment')).toThrow();
  });
});
