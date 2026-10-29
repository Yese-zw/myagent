import { describe, expect, it } from 'vitest';

import { isInsufficientBalanceError } from './insufficientBalanceError';

describe('isInsufficientBalanceError', () => {
  it('matches the packaged gateway 403 balance failure', () => {
    expect(isInsufficientBalanceError(
      '(403) 权限不足 - Failed to authenticate. API Error: 403 Insufficient account balance',
    )).toBe(true);
  });

  it('matches 402 and Chinese balance copy', () => {
    expect(isInsufficientBalanceError('(402) 余额或额度不足')).toBe(true);
    expect(isInsufficientBalanceError('账户余额不足，请充值')).toBe(true);
  });

  it('does not treat a generic 403 as a balance error', () => {
    expect(isInsufficientBalanceError('(403) 权限不足 - Forbidden')).toBe(false);
    expect(isInsufficientBalanceError(null)).toBe(false);
    expect(isInsufficientBalanceError('')).toBe(false);
  });
});
