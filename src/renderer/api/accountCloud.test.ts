import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

async function loadAccountCloud() {
  vi.resetModules();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  const mod = await import('./accountCloud');
  const { i18n } = await import('@/i18n');
  await i18n.changeLanguage('zh-CN');
  return mod;
}

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe('accountCloud API errors', () => {
  it('normalizes transport errors without leaking the raw URL', async () => {
    const { accountErrorMessage, normalizeAccountError } = await loadAccountCloud();
    const error = new Error(
      'Account request failed: error sending request for url (https://account.myagents.io/api/session)',
    );

    const normalized = normalizeAccountError(error);
    expect(normalized.userMessage).toBe('账号请求失败，请检查网络或稍后重试');
    expect(normalized.debugMessage).not.toContain('https://account.myagents.io');
    expect(accountErrorMessage(error)).toBe('账号请求失败，请检查网络或稍后重试');
  });

  it('redacts URLs, bearer tokens, and local paths from debug details', async () => {
    const { normalizeAccountError } = await loadAccountCloud();
    const normalized = normalizeAccountError(
      new Error(
        'Account request failed: Bearer secret.token /Users/ethan/.myagents/session.json https://account.myagents.io/api/session',
      ),
    );

    expect(normalized.userMessage).toBe('账号请求失败，请检查网络或稍后重试');
    expect(normalized.debugMessage).not.toContain('secret.token');
    expect(normalized.debugMessage).not.toContain('/Users/ethan');
    expect(normalized.debugMessage).not.toContain('https://account.myagents.io');
  });

  it('uses structured error envelopes when available', async () => {
    const { normalizeAccountError } = await loadAccountCloud();
    const envelope = {
      error: 'Not authenticated',
      code: 'NOT_AUTHENTICATED',
      requestId: 'req_123',
      recoveryHint: { message: 'Sign in again to continue.' },
    };

    const normalized = normalizeAccountError(envelope);
    expect(normalized.userMessage).toBe('账号请求失败：请重新登录');
    expect(normalized.debugMessage).toContain('NOT_AUTHENTICATED');
    expect(normalized.debugMessage).toContain('req_123');
  });

  it('reports a relogin requirement for expired sessions', async () => {
    const { normalizeAccountError } = await loadAccountCloud();
    const normalized = normalizeAccountError({
      error: 'Session expired',
      code: 'SESSION_EXPIRED',
    });
    expect(normalized.userMessage).toBe('账号请求失败：请重新登录');
  });

  it('reports permission and service failures distinctly', async () => {
    const { normalizeAccountError } = await loadAccountCloud();
    expect(normalizeAccountError({ code: 'FORBIDDEN' }).userMessage).toBe(
      '账号请求失败：权限不足',
    );
    expect(normalizeAccountError({ code: 'INTERNAL_ERROR' }).userMessage).toBe(
      '账号请求失败：服务暂时不可用，请稍后重试',
    );
  });

  it('keeps the raw business detail when the service rejects the request', async () => {
    const { normalizeAccountError } = await loadAccountCloud();
    const normalized = normalizeAccountError(new Error('permission denied'));
    expect(normalized.userMessage).toBe('账号请求失败：permission denied');
  });

  it('reads the account code from the error envelope', async () => {
    const { accountErrorCode } = await loadAccountCloud();
    expect(accountErrorCode({ code: 'NOT_AUTHENTICATED' })).toBe('NOT_AUTHENTICATED');
    expect(accountErrorCode({ accountCode: 'ACCOUNT_DISABLED' })).toBe('ACCOUNT_DISABLED');
  });
});

describe('accountCloud session commands', () => {
  it('maps every account command to its native counterpart', async () => {
    const { accountGetSession, accountLogout, accountAuthStart, accountAuthPoll, accountAuthAck } =
      await loadAccountCloud();

    mocks.invoke.mockResolvedValueOnce({ state: 'authenticated' });
    await expect(accountGetSession()).resolves.toEqual({ state: 'authenticated' });
    expect(mocks.invoke).toHaveBeenLastCalledWith('cmd_space_get_session', undefined);

    mocks.invoke.mockResolvedValueOnce(undefined);
    await accountLogout();
    expect(mocks.invoke).toHaveBeenLastCalledWith('cmd_space_logout', undefined);

    mocks.invoke.mockResolvedValueOnce({ loginToken: 'token', authorizationUrl: 'url', expiresInSeconds: 60 });
    await accountAuthStart();
    expect(mocks.invoke).toHaveBeenLastCalledWith('cmd_space_auth_start', undefined);

    mocks.invoke.mockResolvedValueOnce({ status: 'pending' });
    await accountAuthPoll('token');
    expect(mocks.invoke).toHaveBeenLastCalledWith('cmd_space_auth_poll', { input: { loginToken: 'token' } });

    mocks.invoke.mockResolvedValueOnce(undefined);
    await accountAuthAck('token');
    expect(mocks.invoke).toHaveBeenLastCalledWith('cmd_space_auth_ack', { input: { loginToken: 'token' } });
  });
});
