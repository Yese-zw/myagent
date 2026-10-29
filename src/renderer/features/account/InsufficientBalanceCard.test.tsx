import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';

vi.mock('./useSub2apiBalance', () => ({
  useSub2apiBalance: () => ({ signedIn: true, balance: 0, loading: false, failed: false, refresh: vi.fn() }),
}));

import InsufficientBalanceCard from './InsufficientBalanceCard';

describe('InsufficientBalanceCard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('shows a recharge card instead of the generic AI failure copy', async () => {
    const onRecharge = vi.fn();
    const onDismiss = vi.fn();
    render(<InsufficientBalanceCard onRecharge={onRecharge} onDismiss={onDismiss} />);

    expect(screen.getByRole('status', { name: '余额不足' })).toBeInTheDocument();
    expect(screen.getByText('当前账号余额不足，请充值后再试。')).toBeInTheDocument();
    expect(screen.queryByText(/AI 调用失败/)).not.toBeInTheDocument();
    expect(screen.queryByText('重新发送')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '去充值' }));
    expect(onRecharge).toHaveBeenCalledTimes(1);
  });
});
