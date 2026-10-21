import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';

const mocks = vi.hoisted(() => ({ accountApi: vi.fn(), logout: vi.fn(), accept: vi.fn(), user: { id: 2, email: 'user@example.test', username: '' } as { id: number; email: string; username: string } | null }));
vi.mock('@/api/sub2api', async original => ({ ...await original<typeof import('@/api/sub2api')>(), sub2api: { accountApi: mocks.accountApi, logout: mocks.logout } }));
vi.mock('@/features/account/useSub2apiAccount', () => ({ useSub2apiAccount: () => ({ account: { serverUrl: 'https://example.test', user: mocks.user }, accept: mocks.accept, service: { settings: { balance_low_notify_enabled: true, balance_low_notify_threshold: 5 }, loading: false, error: null } }) }));
import Account from './Account';

beforeEach(async () => { vi.clearAllMocks(); mocks.user = { id: 2, email: 'user@example.test', username: '' }; await i18n.changeLanguage('en-US'); });

function dashboardPayload(operation: string) {
  if (operation === 'profile') return { id: 2, email: 'user@example.test', username: 'Ada', balance: 18.5 };
  if (operation === 'dashboard-stats') return { today_requests: 12, total_requests: 40, today_actual_cost: 0.25, total_actual_cost: 1.5, today_tokens: 2400, today_input_tokens: 1600, today_output_tokens: 800, today_cache_creation_tokens: 100, today_cache_read_tokens: 200, total_tokens: 9000, total_input_tokens: 6000, total_output_tokens: 3000, total_cache_creation_tokens: 400, total_cache_read_tokens: 500 };
  if (operation === 'dashboard-trend') return { trend: [{ date: '2026-10-20', input_tokens: 100, output_tokens: 50, total_tokens: 150, actual_cost: 0.01 }] };
  if (operation === 'dashboard-models') return { models: [{ model: 'claude-sonnet', requests: 8, total_tokens: 1500, actual_cost: 0.2, cost: 0.3 }] };
  return {};
}

describe('sub2api account workspace', () => {
  it('loads the dashboard cards and charts first', async () => {
    mocks.accountApi.mockImplementation(async (operation: string) => dashboardPayload(operation));
    render(<Account isActive />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('Balance')).toBeInTheDocument();
    expect(screen.getByText("Today's requests")).toBeInTheDocument();
    expect(screen.getByText("Today's spend")).toBeInTheDocument();
    expect(screen.getByText("Today's tokens")).toBeInTheDocument();
    expect(screen.getByText('Total tokens')).toBeInTheDocument();
    expect(screen.getByText('Input: 1.6K / Output: 800 / Cache: 300')).toBeInTheDocument();
    expect(screen.getByText('Input: 6.0K / Output: 3.0K / Cache: 900')).toBeInTheDocument();
    expect(screen.getByText('$18.50')).toBeInTheDocument();
    expect(screen.getByText('Time range:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Last 7 Days/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Model distribution' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Token usage trend' })).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet')).toBeInTheDocument();
    expect(mocks.accountApi).toHaveBeenCalledWith('dashboard-stats');
    expect(mocks.accountApi).toHaveBeenCalledWith('dashboard-trend', expect.objectContaining({ granularity: 'day' }));
    expect(mocks.accountApi).toHaveBeenCalledWith('dashboard-models', expect.objectContaining({ timezone: expect.any(String) }));
  });

  it('loads profile data and shows the signed-in account email', async () => {
    mocks.accountApi.mockImplementation(async (operation: string) => operation === 'profile' ? { id: 2, email: 'user@example.test', username: '' } : dashboardPayload(operation));
    render(<Account isActive />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Profile' }));
    expect(mocks.accountApi).toHaveBeenCalledWith('profile');
    expect(await screen.findByLabelText('Email')).toHaveValue('user@example.test');
  });

  it('creates and refreshes a key, toggles its state, and deletes it', async () => {
    const user = userEvent.setup();
    mocks.accountApi.mockImplementation(async (operation: string) => {
      if (operation === 'keys') return { items: [{ id: 7, name: 'Primary', key: 'sk-live', status: 'active', created_at: '2026-10-20T00:00:00Z' }], total: 1, page: 1, page_size: 20 };
      if (operation === 'create-key') return { key: 'sk-new' };
      return dashboardPayload(operation);
    });
    render(<Account isActive />);
    await user.click(await screen.findByRole('button', { name: 'API keys' }));
    await screen.findByText('Primary');
    await user.type(screen.getByLabelText('Key name'), 'Test key');
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    await waitFor(() => expect(mocks.accountApi).toHaveBeenCalledWith('create-key', { name: 'Test key' }));
    await user.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(mocks.accountApi).toHaveBeenCalledWith('update-key', { id: 7, status: 'inactive' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(mocks.accountApi).toHaveBeenCalledWith('delete-key', { id: 7 }));
  });

  it('does not show a loading banner while a tab is fetching', async () => {
    let resolveDashboard!: (value: unknown) => void;
    mocks.accountApi.mockImplementation(() => new Promise(resolve => { resolveDashboard = resolve; }));
    render(<Account isActive />);
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: 'Refresh' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'API keys' }));
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Refresh' })).toBeInTheDocument();
    resolveDashboard({});
  });

  it('shows a card empty state for usage, orders, and redeem history', async () => {
    mocks.accountApi.mockImplementation(async (operation: string) => {
      if (operation === 'usage' || operation === 'orders' || operation === 'redeem-history') {
        return { items: [], total: 0, page: 1, page_size: 20 };
      }
      return dashboardPayload(operation);
    });
    const user = userEvent.setup();
    render(<Account isActive />);
    await user.click(await screen.findByRole('button', { name: 'Usage history' }));
    expect(await screen.findByText('No usage yet')).toBeInTheDocument();
    expect(screen.getByText('Requests and token usage will appear here after you call a model.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'My orders' }));
    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Redeem' }));
    expect(await screen.findByText('No redemptions yet')).toBeInTheDocument();
  });

  it('signs out from the account workspace', async () => {
    mocks.accountApi.mockImplementation(async (operation: string) => dashboardPayload(operation));
    mocks.logout.mockResolvedValue({ serverUrl: 'https://example.test', user: null });
    render(<Account isActive />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalled());
    expect(mocks.accept).toHaveBeenCalledWith({ serverUrl: 'https://example.test', user: null });
  });

  it('partitions profile into overview, password, and low-balance alerts', async () => {
    const user = userEvent.setup();
    mocks.accountApi.mockImplementation(async (operation: string) => {
      if (operation === 'profile') return { id: 2, email: 'user@example.test', username: 'Ada', balance: 12.5, concurrency: 4, created_at: '2026-01-02T00:00:00Z', balance_notify_enabled: true, balance_notify_threshold: 3 };
      return dashboardPayload(operation);
    });
    render(<Account isActive />);
    await user.click(await screen.findByRole('button', { name: 'Profile' }));
    expect(screen.queryByRole('heading', { name: 'Account overview' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Change password' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Low-balance alerts' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('user@example.test');
    await user.type(screen.getByLabelText('Current password'), 'old-pass');
    await user.type(screen.getByLabelText('New password'), 'new-pass-1');
    await user.type(screen.getByLabelText('Confirm new password'), 'new-pass-1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(mocks.accountApi).toHaveBeenCalledWith('change-password', { old_password: 'old-pass', new_password: 'new-pass-1' }));
    await user.click(screen.getByLabelText('Enable low-balance alerts'));
    await waitFor(() => expect(mocks.accountApi).toHaveBeenCalledWith('update-profile', { balance_notify_enabled: false, balance_notify_threshold: 3 }));
  });

  it('lists available models from the account workspace', async () => {
    const user = userEvent.setup();
    mocks.accountApi.mockImplementation(async (operation: string) => dashboardPayload(operation));
    render(<Account isActive />);
    await user.click(await screen.findByRole('button', { name: 'Available models' }));
    expect(await screen.findByRole('heading', { name: 'Available models' })).toBeInTheDocument();
    expect(await screen.findByText('No models yet')).toBeInTheDocument();
    expect(screen.getByText('After you sign in, every model allowed by your key will appear here.')).toBeInTheDocument();
  });

  it('opens the native login entry point while signed out', async () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    mocks.user = null;
    render(<Account isActive />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in / Register' }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'sub2api-account:open-login' }));
  });
});
