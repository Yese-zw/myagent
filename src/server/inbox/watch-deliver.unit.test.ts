import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => ({
  cancellableFetch: vi.fn(),
  networkReturn: vi.fn(),
}));

vi.mock('../SessionStore', () => ({ getSessionMetadata: () => null, getSessionData: async () => null }));

vi.mock('../utils/cancellation', () => ({
  cancellableFetch: fetchMock.cancellableFetch,
}));
import { deliverSessionWatchEvents } from './watch-deliver';
import {
  clearPendingSessionWatchesForTest,
  pendingSessionWatchCount,
  registerPendingSessionWatch,
} from './watch-registry';

function registerWatch(): void {
  registerPendingSessionWatch({
    watchId: 'watch-1',
    watcherSessionId: 'watcher-session',
    targetSessionId: 'target-session',
    targetLabel: 'Target',
    targetStateAtRegistration: 'running',
    registeredAt: '2026-06-20T12:00:00.000Z',
  });
}

describe('deliverSessionWatchEvents', () => {
  afterEach(() => {
    clearPendingSessionWatchesForTest();
    fetchMock.cancellableFetch.mockReset();
    fetchMock.networkReturn.mockReset();
    delete process.env.MYAGENTS_MANAGEMENT_PORT;
  });

  it('acks a watch only after confirmed delivery', async () => {
    process.env.MYAGENTS_MANAGEMENT_PORT = '8123';
    registerWatch();
    fetchMock.cancellableFetch.mockResolvedValue(new Response(
      JSON.stringify({ ok: true, outcome: { status: 'delivered', message_id: 'msg-1' } }),
      { status: 200 },
    ));

    await deliverSessionWatchEvents('target-session', { text: 'done' });

    expect(pendingSessionWatchCount()).toBe(0);
  });

  it('keeps a watch pending when delivery fails', async () => {
    process.env.MYAGENTS_MANAGEMENT_PORT = '8123';
    registerWatch();
    fetchMock.cancellableFetch.mockResolvedValue(new Response(
      JSON.stringify({ ok: false, outcome: { status: 'delivery_failed', reason: 'starting' } }),
      { status: 200 },
    ));

    await deliverSessionWatchEvents('target-session', { text: 'done' });

    expect(pendingSessionWatchCount()).toBe(1);
  });
  it.each([true, false])('shares local automatic reply admission with its watch, delivered=%s', async delivered => {
    process.env.MYAGENTS_MANAGEMENT_PORT = '8123';
    registerPendingSessionWatch({ watchId: 'same-turn', watcherSessionId: 'caller', targetSessionId: 'target-session',
      targetLabel: 'Target', targetStateAtRegistration: 'running', registeredAt: 'now', turnId: 'turn' });
    registerPendingSessionWatch({ watchId: 'other-caller', watcherSessionId: 'other', targetSessionId: 'target-session',
      targetLabel: 'Target', targetStateAtRegistration: 'running', registeredAt: 'now', turnId: 'turn' });
    let finish!: (value: Response) => void;
    fetchMock.cancellableFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fetchMock.cancellableFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, outcome: { status: 'delivered' } })));
    const delivery = deliverSessionWatchEvents('target-session', { text: 'done', turnId: 'turn', requestEventIds: ['request'] },
      [{ fromSessionId: 'caller', fromLabel: 'Caller', originalMessageId: 'request', originalSnippet: 'query', replyBack: true }]);
    await vi.waitFor(() => expect(fetchMock.cancellableFetch).toHaveBeenCalledTimes(2));
    const messages = fetchMock.cancellableFetch.mock.calls.map(call => JSON.parse(call[1].body).message.sessionEvent);
    expect(messages.filter(event => event.targetSessionId === 'caller')).toEqual([expect.objectContaining({
      type: 'send.result', requestEventId: 'request', watchIds: ['same-turn'], turnId: 'turn',
    })]);
    finish(new Response(JSON.stringify({ ok: delivered, outcome: { status: delivered ? 'delivered' : 'unconfirmed' } })));
    await delivery;
    expect(pendingSessionWatchCount()).toBe(delivered ? 0 : 1);
    expect(fetchMock.cancellableFetch).toHaveBeenCalledTimes(2);
  });

  it('returns each same-turn request independently and never replies to notifications', async () => {
    process.env.MYAGENTS_MANAGEMENT_PORT = '8123';
    fetchMock.cancellableFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: true, outcome: { status: 'delivered' } })));
    const metas = ['one', 'two', 'notification'].map(id => ({ fromSessionId: 'caller', fromLabel: 'caller',
      originalMessageId: id, originalSnippet: id, replyBack: id !== 'notification' }));
    await deliverSessionWatchEvents('target-session', { text: 'shared result', turnId: 'turn' }, metas);
    const replies = fetchMock.cancellableFetch.mock.calls.map(call => JSON.parse(call[1].body).message);
    expect(replies.map(reply => reply.inReplyTo)).toEqual(['one', 'two']);
    expect(replies.every(reply => reply.replyBack === false && reply.text.includes('shared result'))).toBe(true);
  });

  it('acks leftover remote watches without treating them as local Sessions', async () => {
    process.env.MYAGENTS_MANAGEMENT_PORT = '8123';
    const reference = { opId: 'op', returnRouteId: 'route' };
    registerPendingSessionWatch({ watchId: 'remote-watch', watcherSessionId: 'remote-source',
      targetSessionId: 'target-session', targetLabel: 'Target', targetStateAtRegistration: 'running',
      registeredAt: 'now', networkReturn: reference });
    await deliverSessionWatchEvents('target-session', { text: 'done' });
    expect(fetchMock.cancellableFetch).not.toHaveBeenCalled();
    expect(pendingSessionWatchCount()).toBe(0);
  });

});
