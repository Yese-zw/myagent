import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CODEX_DESKTOP_DOWNLOAD_URL } from './GoToCodexDialog';
import LaunchCodexButton from './LaunchCodexButton';

const codexAppStatus = vi.fn();
const launchCodex = vi.fn();

vi.mock('@/api/sub2api', () => ({
  sub2api: {
    codexAppStatus: (...args: unknown[]) => codexAppStatus(...args),
    launchCodex: (...args: unknown[]) => launchCodex(...args),
  },
  sub2apiErrorCode: (error: unknown) => (error instanceof Error ? error.message : 'UNKNOWN'),
}));

vi.mock('./useSub2apiAccount', () => ({
  useSub2apiAccount: () => ({
    account: { serverUrl: 'https://lingsiai.vip', user: { id: 1, email: 'a@b.c', username: 'a' } },
  }),
}));

describe('LaunchCodexButton', () => {
  beforeEach(() => {
    codexAppStatus.mockReset();
    launchCodex.mockReset();
  });

  it('checks for Codex in a dialog and shows the latest client download when it is missing', async () => {
    codexAppStatus.mockResolvedValue({ installed: false, name: null });
    render(<LaunchCodexButton />);

    fireEvent.click(screen.getByRole('button', { name: '前往 Codex' }));

    expect(launchCodex).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog', { name: '前往 Codex' })).toBeInTheDocument();
    expect(await screen.findByText('未检测到 Codex 桌面版。请先下载并安装最新客户端，安装完成后再前往。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: CODEX_DESKTOP_DOWNLOAD_URL })).toHaveAttribute('href', CODEX_DESKTOP_DOWNLOAD_URL);
    expect(screen.queryByRole('button', { name: '前往' })).not.toBeInTheDocument();
  });

  it('opens Codex only after the installed check is confirmed', async () => {
    codexAppStatus.mockResolvedValue({ installed: true, name: 'ChatGPT.app' });
    launchCodex.mockResolvedValue(false);
    render(<LaunchCodexButton />);

    fireEvent.click(screen.getByRole('button', { name: '前往 Codex' }));

    expect(launchCodex).not.toHaveBeenCalled();
    const go = await screen.findByRole('button', { name: '前往' });
    expect(screen.getByText(/ChatGPT\.app/)).toBeInTheDocument();
    fireEvent.click(go);
    await waitFor(() => expect(launchCodex).toHaveBeenCalledOnce());
  });
});
