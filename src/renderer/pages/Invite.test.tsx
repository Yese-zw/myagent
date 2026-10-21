import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';

const mocks = vi.hoisted(() => ({
  accountApi: vi.fn(),
  refresh: vi.fn(),
  copy: vi.fn(),
  user: { id: 2, email: 'user@example.test', username: 'Ada' } as { id: number; email: string; username: string } | null,
}));
vi.mock('@/api/sub2api', async original => ({ ...await original<typeof import('@/api/sub2api')>(), sub2api: { accountApi: mocks.accountApi } }));
vi.mock('@/features/account/useSub2apiAccount', () => ({ useSub2apiAccount: () => ({ account: { serverUrl: 'https://example.test', user: mocks.user } }) }));
vi.mock('@/features/account/useSub2apiBalance', () => ({ useSub2apiBalance: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/utils/clipboard', () => ({ copyPlainText: mocks.copy }));
import Invite from './Invite';

const detail = {
  user_id: 2,
  aff_code: 'INVITE88',
  aff_count: 1,
  aff_quota: 8,
  aff_frozen_quota: 0,
  aff_history_quota: 12,
  effective_rebate_rate_percent: 20,
  invitees: [{ user_id: 4, email: 'friend@example.test', username: 'Friend', created_at: '2026-10-20T00:00:00Z', total_rebate: 3 }],
};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.user = { id: 2, email: 'user@example.test', username: 'Ada' };
  mocks.accountApi.mockResolvedValue(detail);
  mocks.copy.mockResolvedValue(undefined);
  await i18n.changeLanguage('en-US');
});

describe('invite workspace', () => {
  it('loads affiliate stats, copies the invite code, and transfers rebate', async () => {
    const user = userEvent.setup();
    mocks.accountApi.mockImplementation(async (operation: string) => {
      if (operation === 'affiliate-transfer') return { transferred_quota: 8, balance: 26 };
      return detail;
    });
    render(<Invite isActive />);
    expect(await screen.findByRole('heading', { name: 'Invite & earn' })).toBeInTheDocument();
    expect(screen.getByText('INVITE88')).toBeInTheDocument();
    expect(screen.queryByText(/register\?aff=/)).not.toBeInTheDocument();
    expect(screen.getByText('friend@example.test')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(mocks.copy).toHaveBeenCalledWith('INVITE88');
    await user.click(screen.getByRole('button', { name: 'Transfer to balance' }));
    await waitFor(() => expect(mocks.accountApi).toHaveBeenCalledWith('affiliate-transfer'));
    expect(mocks.refresh).toHaveBeenCalled();
    expect(await screen.findByText('$8.00 moved to your balance')).toBeInTheDocument();
  });

  it('asks the user to sign in before loading affiliate data', async () => {
    mocks.user = null;
    render(<Invite isActive />);
    expect(await screen.findByText('Sign in to view your invite code and rebates')).toBeInTheDocument();
    expect(mocks.accountApi).not.toHaveBeenCalled();
  });
});
