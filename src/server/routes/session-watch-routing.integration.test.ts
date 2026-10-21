import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTERNAL_CLI_TOKEN_ENV, INTERNAL_CLI_TOKEN_HEADER } from '../../shared/externalCliCapabilities';
import type { NetworkReturnReference } from '../inbox/types';
import {
  clearPendingSessionWatchesForTest,
  listPendingSessionWatches,
  registerPendingSessionWatch,
} from '../inbox/watch-registry';
import { composeSidecarRequestHandler, resolveSidecarComposition } from '../sidecar-composition';

const mocks = vi.hoisted(() => ({
  engine: {
    getRuntimeIdentity: vi.fn(() => ({ sessionId: 'target', runtime: 'builtin' })),
    getLiveSessionState: vi.fn(() => ({ sessionState: 'running', isBusy: true })),
    getExecutionTurnId: vi.fn(() => 'turn-1'),
  },
}));
vi.mock('../session-engine', () => ({ getSessionEngine: () => mocks.engine }));
vi.mock('../SessionStore', () => ({
  getSessionMetadata: () => ({ id: 'target', title: 'Target' }),
  getSessionData: vi.fn(),
  isHistoryVisibleSession: vi.fn(),
}));

import { handleSessionReadRoute } from './session-read';

const token = 'isolated-watch-routing-test';
const reference: NetworkReturnReference = {
  opId: '00000000-0000-4000-8000-000000000001',
  returnRouteId: '00000000-0000-4000-8000-000000000002',
};
const replacement: NetworkReturnReference = {
  opId: '00000000-0000-4000-8000-000000000003',
  returnRouteId: '00000000-0000-4000-8000-000000000004',
};

function pending(watchId: string, watcherSessionId: string, networkReturn?: NetworkReturnReference) {
  return registerPendingSessionWatch({
    watchId, watcherSessionId, targetSessionId: 'target', targetLabel: 'Target',
    registeredAt: '2026-10-04T00:00:00Z', targetStateAtRegistration: 'running', turnId: 'turn-1',
    ...(networkReturn ? { networkReturn, observerScope: 'device-1' } : {}),
  });
}

function composed(role: 'session' | 'global' | 'development-union') {
  const handler = vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    return await handleSessionReadRoute(url.pathname, request, url) ?? new Response(null, { status: 404 });
  });
  return {
    handler,
    dispatch: composeSidecarRequestHandler(
      role === 'development-union' ? resolveSidecarComposition(null, true) : resolveSidecarComposition(role, false),
      handler,
    ),
  };
}

function post(path: string, body: unknown, authenticated = true) {
  return new Request(`http://127.0.0.1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authenticated ? { [INTERNAL_CLI_TOKEN_HEADER]: token } : {}) },
    body: JSON.stringify(body),
  });
}

describe('composed Session watch owner routes', () => {
  beforeEach(() => {
    clearPendingSessionWatchesForTest();
    vi.stubEnv(INTERNAL_CLI_TOKEN_ENV, token);
    vi.clearAllMocks();
  });
  afterEach(() => {
    clearPendingSessionWatchesForTest();
    vi.unstubAllEnvs();
  });

  it.each(['session', 'development-union'] as const)('%s lists and cancels only the caller local watches', async role => {
    pending('mine', 'caller');
    pending('other', 'other-caller');
    pending('network', 'caller', reference);
    const { dispatch } = composed(role);
    const listed = await dispatch(post('/api/session-watch/manage', { watcherSessionId: 'caller' }));
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ watches: [{
      watchId: 'mine', targetSessionId: 'target', turnId: 'turn-1', source: 'local', cancelled: false,
    }] });
    const foreign = await dispatch(post('/api/session-watch/manage', { watcherSessionId: 'caller', cancel: 'other' }));
    expect((await foreign.json()).watches[0].cancelled).toBe(false);
    const cancelled = await dispatch(post('/api/session-watch/manage', { watcherSessionId: 'caller', all: true }));
    expect((await cancelled.json()).watches[0].cancelled).toBe(true);
    expect(listPendingSessionWatches().map(watch => watch.watchId)).toEqual(['other', 'network']);
    expect(mocks.engine.getLiveSessionState).not.toHaveBeenCalled();
  });

  it.each(['session', 'development-union'] as const)('%s rejects AgentNet watch register and cleanup', async role => {
    const { dispatch } = composed(role);
    const register = await dispatch(post('/api/session-watch/register', {
      watchId: 'original', watcherSessionId: 'caller', targetSessionId: 'target', observerScope: 'device-1', networkReturn: reference,
    }));
    expect(register.status).toBe(400);
    const remove = await dispatch(post('/api/session-watch/network-remove', {
      watchId: 'original', targetSessionId: 'target', networkReturn: reference,
    }));
    expect(remove.status).toBe(400);
    expect(await remove.json()).toEqual({ accepted: false });
  });

  it.each(['/api/session-watch/manage', '/api/session-watch/network-remove'])('%s requires original owner and internal credentials', async path => {
    pending('network', 'caller', reference);
    const body = { watcherSessionId: 'caller', all: true, watchId: 'network', targetSessionId: 'target', networkReturn: reference };
    const global = composed('global');
    expect((await global.dispatch(post(path, body))).status).toBe(404);
    expect(global.handler).not.toHaveBeenCalled();
    const session = composed('session');
    expect((await session.dispatch(post(path, body, false))).status).toBe(401);
    expect(listPendingSessionWatches()).toHaveLength(1);
    expect((await session.dispatch(post('/api/session-watch/future-owner', body))).status).toBe(404);
    expect(session.handler).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched targets and invalid cleanup references without removing a watch', async () => {
    pending('network', 'caller', reference);
    const { dispatch } = composed('session');
    for (const body of [
      { watchId: 'network', targetSessionId: 'other', networkReturn: reference },
      { watchId: 'network', targetSessionId: 'target', networkReturn: { ...reference, extra: true } },
    ]) {
      expect((await dispatch(post('/api/session-watch/network-remove', body))).status).toBe(400);
    }
    expect((await dispatch(post('/api/session-watch/register', {
      watchId: 'wrong-target', watcherSessionId: 'caller', targetSessionId: 'other',
    }))).status).toBe(409);
    expect(listPendingSessionWatches().map(watch => watch.watchId)).toEqual(['network']);
  });
});
