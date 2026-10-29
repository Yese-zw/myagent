import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImagePreviewProvider } from '@/context/ImagePreviewContext';
import type { Provider } from '@/config/types';
import SimpleChatInput from './SimpleChatInput';
import { ToastProvider } from './Toast';

const mocks = vi.hoisted(() => ({
  prices: new Map<string, { ratio: number | null }>(),
  refreshPrices: vi.fn(),
  refreshGateway: vi.fn(),
  service: {
    isAvailable: true,
    importBase64Files: vi.fn(), copyPaths: vi.fn(), addGitignore: vi.fn(), prepareUserImageAttachments: vi.fn(),
    searchFiles: vi.fn(), searchFilesPage: vi.fn(), listSlashCommands: vi.fn(),
  },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue({ items: [], complete: true }) }));
vi.mock('@/config/useConfigData', () => ({ useConfigData: () => ({ config: { chatSendShortcut: 'enter' }, projects: [] }) }));
vi.mock('@/hooks/useWorkspaceFileService', () => ({ useWorkspaceFileService: () => mocks.service }));
vi.mock('@/features/account/useModelPrices', () => ({ useModelPrices: () => mocks.prices, refreshModelPrices: mocks.refreshPrices }));
vi.mock('@/features/account/syncPackagedGateway', () => ({ refreshPackagedGatewayModels: mocks.refreshGateway }));

const gateway = {
  id: 'myagents', name: '灵思AGENT', primaryModel: 'gpt-5.6-sol',
  models: [{ model: 'gpt-5.6-sol', modelName: 'gpt-5.6-sol' }, { model: 'plain', modelName: 'plain' }],
} as Provider;

function renderInput() {
  render(
    <ToastProvider>
      <ImagePreviewProvider>
        <SimpleChatInput runtime="builtin" isLoading={false} onSend={vi.fn()} provider={gateway} providers={[gateway]} apiKeys={{ myagents: "sk-test" }} selectedModel="gpt-5.6-sol" />
      </ImagePreviewProvider>
    </ToastProvider>,
  );
}

describe('chat model menu pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prices = new Map([['gpt-5.6-sol', { ratio: 0.5 }], ['plain', { ratio: null }]]);
    mocks.refreshPrices.mockResolvedValue(undefined);
    mocks.refreshGateway.mockResolvedValue(undefined);
    mocks.service.searchFilesPage.mockResolvedValue({ items: [], complete: true, hasMore: false, scanLimitReached: false, nextCursor: null });
    mocks.service.listSlashCommands.mockResolvedValue([]);
  });

  it('shows the plaza discount after discounted gateway models only', async () => {
    renderInput();
    await userEvent.setup().click(screen.getByTitle('切换模型'));
    const badges = document.querySelectorAll('[data-model-discount]');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent('5折');
  });

  it('refreshes gateway models and prices from the menu header', async () => {
    const user = userEvent.setup();
    renderInput();
    await user.click(screen.getByTitle('切换模型'));
    await user.click(screen.getByRole('button', { name: '刷新模型' }));
    await waitFor(() => expect(mocks.refreshGateway).toHaveBeenCalledOnce());
    expect(mocks.refreshPrices).toHaveBeenCalledOnce();
  });
});
