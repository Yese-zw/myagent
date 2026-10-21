import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  loadAppConfig: vi.fn(),
}));
vi.mock('./syncPackagedGateway', () => ({ refreshPackagedGatewayModels: mocks.refresh }));
vi.mock('@/config/services/appConfigService', () => ({ loadAppConfig: mocks.loadAppConfig }));

import AvailableModelsWorkspace from './AvailableModelsWorkspace';

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en-US');
  mocks.refresh.mockResolvedValue(undefined);
});

describe('available models workspace', () => {
  it('renders every model returned for the packaged key', async () => {
    mocks.loadAppConfig.mockResolvedValue({
      presetCustomModels: {
        myagents: [
          { model: 'claude-sonnet', modelName: 'Claude Sonnet', modelSeries: 'anthropic', contextLength: 200000 },
          { model: 'gpt-5.4', modelName: 'GPT-5.4', modelSeries: 'openai', maxOutputTokens: 128000 },
        ],
      },
    });
    render(<AvailableModelsWorkspace isActive reloadToken={1} onBusy={vi.fn()} />);
    expect(await screen.findByText('Claude Sonnet')).toBeInTheDocument();
    expect(screen.getByText('GPT-5.4')).toBeInTheDocument();
    expect(screen.getByText('2 models are available for the current key. Changing the runtime does not hide them.')).toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
