import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(), account: vi.fn(), authenticate: vi.fn(), sendCode: vi.fn(), logout: vi.fn(), cancel: vi.fn(), gateway: vi.fn(),
}));
vi.mock('@/api/sub2api', async (original) => ({ ...await original<typeof import('@/api/sub2api')>(), sub2api: mocks }));
vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => true }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: vi.fn() }));
import Sub2apiAccountEntry, { Sub2apiAccountDialog } from './Sub2apiAccountEntry';
import { resetSub2apiAccountStore } from './useSub2apiAccount';
import { Sub2apiError } from '@/api/sub2api';

const account = { serverUrl: 'https://account.example', user: null };
const settings = {
  site_name: 'Example AI', registration_enabled: true, email_verify_enabled: true,
  invitation_code_enabled: false, registration_email_suffix_whitelist: [],
  login_agreement_enabled: false, login_agreement_documents: [],
};
const props = () => ({ account, settings, onAccount: vi.fn(), onClose: vi.fn() });

beforeEach(async () => {
  resetSub2apiAccountStore();
  vi.resetAllMocks();
  await i18n.changeLanguage('en-US');
  mocks.settings.mockResolvedValue(settings);
  mocks.account.mockResolvedValue(account);
  mocks.gateway.mockResolvedValue({ baseUrl: 'https://lingsiai.vip/v1', apiKey: 'sk-test-key' });
});

describe('native sub2api account form', () => {
  it('logs in inside the app and never asks for a website navigation', async () => {
    const user = userEvent.setup(); const callbacks = props();
    const signedIn = { ...account, user: { id: 1, email: 'a@example.com', username: 'Alice' } };
    mocks.authenticate.mockResolvedValue(signedIn);
    render(<Sub2apiAccountDialog {...callbacks} />);
    await screen.findByRole('heading', { name: 'Account' });
    const loginEmail = screen.getByLabelText('Email');
    expect(loginEmail.closest('[class*="backdrop-blur"]')).toBeNull();
    await user.type(loginEmail, 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'example-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(callbacks.onAccount).toHaveBeenCalledWith(signedIn));
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.objectContaining({ email: 'a@example.com', password: 'example-password' }), false);
    expect(callbacks.onClose).toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('registers with matching passwords and the server-required email code', async () => {
    const user = userEvent.setup(); render(<Sub2apiAccountDialog {...props()} />);
    await screen.findByRole('heading', { name: 'Account' });
    await user.click(screen.getByRole('tab', { name: 'Register' }));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'example-password');
    await user.type(screen.getByLabelText('Confirm password'), 'another-password');
    await user.type(screen.getByLabelText('Email verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Register' }));
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(mocks.authenticate).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Confirm password'));
    await user.type(screen.getByLabelText('Confirm password'), 'example-password');
    await user.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(mocks.authenticate).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.com', verifyCode: '123456', affCode: '', invitationCode: '' }), true));
  });

  it('lets register send an optional affiliate invitation code', async () => {
    const user = userEvent.setup();
    render(<Sub2apiAccountDialog {...props()} />);
    await user.click(await screen.findByRole('tab', { name: 'Register' }));
    expect(screen.getByText('Optional')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'example-password');
    await user.type(screen.getByLabelText('Confirm password'), 'example-password');
    await user.type(screen.getByLabelText('Email verification code'), '123456');
    await user.type(screen.getByLabelText(/Invitation code/), '  FRIEND1  ');
    await user.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(mocks.authenticate).toHaveBeenCalledWith(expect.objectContaining({ invitationCode: '', affCode: 'FRIEND1' }), true));
  });

  it('requires the invitation code when the server enables it', async () => {
    const user = userEvent.setup();
    render(<Sub2apiAccountDialog {...props()} settings={{ ...settings, invitation_code_enabled: true }} />);
    await user.click(await screen.findByRole('tab', { name: 'Register' }));
    expect(screen.queryByText('Optional')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'example-password');
    await user.type(screen.getByLabelText('Confirm password'), 'example-password');
    await user.type(screen.getByLabelText('Email verification code'), '123456');
    expect(screen.getByRole('button', { name: 'Register' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Invitation code/), 'NEEDTHIS');
    await user.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(mocks.authenticate).toHaveBeenCalledWith(expect.objectContaining({ invitationCode: 'NEEDTHIS', affCode: '' }), true));
  });

  it('lets register pick a supported email domain from the input dropdown', async () => {
    const user = userEvent.setup();
    render(<Sub2apiAccountDialog {...props()} settings={{ ...settings, registration_email_suffix_whitelist: ['@gmail.com', 'outlook.com'] }} />);
    await user.click(await screen.findByRole('tab', { name: 'Register' }));
    expect(screen.queryByText(/Supported email domains/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email domain')).toHaveTextContent('@gmail.com');
    await user.click(screen.getByLabelText('Email domain'));
    const domainOption = screen.getByRole('button', { name: '@outlook.com' });
    expect(domainOption.closest('[aria-hidden="true"]')).toBeNull();
    expect(domainOption.closest('[inert]')).toBeNull();
    await user.click(domainOption);
    const email = screen.getByLabelText('Email');
    expect(email.closest('[aria-hidden="true"]')).toBeNull();
    expect(email.closest('[inert]')).toBeNull();
    await user.type(screen.getByLabelText('Email'), 'new-user');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'example-password');
    await user.type(screen.getByLabelText('Confirm password'), 'example-password');
    await user.type(screen.getByLabelText('Email verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(mocks.authenticate).toHaveBeenCalledWith(expect.objectContaining({ email: 'new-user@outlook.com', verifyCode: '123456', affCode: '' }), true));
  });

  it('requires explicit agreement and does not silently accept service terms', async () => {
    const terms = { ...settings, login_agreement_enabled: true, login_agreement_documents: [{ id: 'terms', title: 'Terms', content_md: '# Terms\nExample terms' }] };
    const user = userEvent.setup(); render(<Sub2apiAccountDialog {...props()} settings={terms} />);
    await screen.findByRole('heading', { name: 'Account' });
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Terms' }));
    const termsHeading = await screen.findByRole('heading', { name: 'Terms' });
    expect(termsHeading.closest('[aria-hidden="true"]')).toBeNull();
    expect(termsHeading.closest('[inert]')).toBeNull();
    expect(await screen.findByText('Example terms')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('connects at app entry mount and reuses settings when opening and reopening the dialog', async () => {
    const user = userEvent.setup();
    render(<Sub2apiAccountEntry expanded />);
    await waitFor(() => expect(mocks.settings).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in / Register' }));
    await screen.findByRole('heading', { name: 'Account' });
    expect(screen.queryByLabelText('Service address')).not.toBeInTheDocument();
    expect(screen.queryByText(/https:\/\//)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Sign in / Register' }));
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(mocks.settings).toHaveBeenCalledTimes(1);
  });

  it('keeps the signed-in account when the workspace remounts', async () => {
    const signedIn = { ...account, user: { id: 1, email: 'a@example.com', username: 'Alice' } };
    mocks.account.mockResolvedValue(signedIn);
    const first = render(<Sub2apiAccountEntry expanded />);
    expect(await screen.findByRole('button', { name: 'Alice' })).toBeInTheDocument();
    first.unmount();
    render(<Sub2apiAccountEntry expanded />);
    expect(screen.getByRole('button', { name: 'Alice' })).toBeInTheDocument();
  });

  it('lets the user sign in immediately without a connecting-to-service banner', async () => {
    let resolveSettings!: (value: typeof settings) => void;
    mocks.settings.mockImplementation(() => new Promise(resolve => { resolveSettings = resolve; }));
    const user = userEvent.setup();
    render(<Sub2apiAccountEntry expanded />);
    await user.click(screen.getByRole('button', { name: 'Sign in / Register' }));
    expect(screen.queryByText(/Connecting/)).not.toBeInTheDocument();
    expect(screen.queryByText(/正在连接/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    await act(async () => { resolveSettings(settings); });
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByText('Example AI')).not.toBeInTheDocument();
    expect(screen.queryByText(/Connecting/)).not.toBeInTheDocument();
  });

  it('prevents duplicate submissions and recovers after a failed login', async () => {
    let reject!: (error: unknown) => void;
    mocks.authenticate.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const user = userEvent.setup(); render(<Sub2apiAccountDialog {...props()} />);
    await screen.findByRole('heading', { name: 'Account' });
    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'example-password');
    const form = screen.getByRole('button', { name: 'Sign in' }).closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(mocks.authenticate).toHaveBeenCalledTimes(1));
    await act(async () => { reject(new Sub2apiError('INVALID_CREDENTIALS')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('signs out the sub2api account through its own owner', async () => {
    const callbacks = props(); mocks.logout.mockResolvedValue(account);
    const user = userEvent.setup();
    render(<Sub2apiAccountDialog {...callbacks} account={{ ...account, user: { id: 1, email: 'a@example.com', username: 'Alice' } }} />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(callbacks.onAccount).toHaveBeenCalledWith(account));
  });
});
