import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  loadAppConfig: vi.fn(),
  accountApi: vi.fn(),
  account: vi.fn(),
}));
vi.mock('./syncPackagedGateway', () => ({ refreshPackagedGatewayModels: mocks.refresh }));
vi.mock('@/config/services/appConfigService', () => ({ loadAppConfig: mocks.loadAppConfig }));
vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => true }));
vi.mock('@/api/sub2api', () => ({
  sub2api: { accountApi: mocks.accountApi, account: mocks.account },
}));

import AvailableModelsWorkspace from './AvailableModelsWorkspace';
import { resetModelPricesForTest } from './useModelPrices';

beforeEach(async () => {
  vi.clearAllMocks();
  resetModelPricesForTest();
  await i18n.changeLanguage('en-US');
  mocks.refresh.mockResolvedValue(undefined);
  mocks.accountApi.mockRejectedValue(new Error('plaza disabled'));
  mocks.account.mockResolvedValue({ serverUrl: 'https://example.test', user: null, appGroupId: 35 });
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
    expect(screen.queryByText(/models are available for the current key/)).not.toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalled();
  });
});

describe('available models loading', () => {
  it('shows the saved list before the gateway refresh finishes', async () => {
    let finishRefresh!: () => void;
    mocks.refresh.mockReturnValue(new Promise<void>(resolve => { finishRefresh = resolve; }));
    mocks.loadAppConfig.mockResolvedValue({
      presetCustomModels: { myagents: [{ model: 'claude-sonnet', modelName: 'Claude Sonnet' }] },
    });
    render(<AvailableModelsWorkspace isActive reloadToken={1} onBusy={vi.fn()} />);
    expect(await screen.findByText('Claude Sonnet')).toBeInTheDocument();
    finishRefresh();
  });

  it('keeps the saved list when the refresh fails', async () => {
    mocks.refresh.mockRejectedValue(new Error('offline'));
    mocks.loadAppConfig.mockResolvedValue({
      presetCustomModels: { myagents: [{ model: 'claude-sonnet', modelName: 'Claude Sonnet' }] },
    });
    render(<AvailableModelsWorkspace isActive reloadToken={1} onBusy={vi.fn()} />);
    expect(await screen.findByText('Claude Sonnet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('available models pricing', () => {
  const plaza = {
    groups: [{
      id: 35,
      rate_multiplier: 1,
      long_context_pricing_enabled: true,
      models: [{
        name: 'gpt-5.6-sol',
        pricing: {
          input_price: 2.5e-6, output_price: 1.5e-5,
          intervals: [
            { min_tokens: 0, max_tokens: 272000, tier_label: '≤272K', input_price: 2.5e-6, output_price: 1.5e-5, cache_write_price: 3.12e-6, cache_write_1h_price: 3.12e-6, cache_read_price: 2.5e-7 },
            { min_tokens: 272000, max_tokens: null, tier_label: '>272K', input_price: 5e-6, output_price: 2.25e-5, cache_write_price: 6.24e-6, cache_write_1h_price: 6.24e-6, cache_read_price: 5e-7 },
          ],
        },
        official_pricing: {
          input_price: 5e-6, output_price: 3e-5,
          intervals: [
            { min_tokens: 0, max_tokens: 272000, input_price: 5e-6, output_price: 3e-5, cache_write_price: 6.25e-6, cache_read_price: 5e-7 },
            { min_tokens: 272000, max_tokens: null, input_price: 1e-5, output_price: 4.5e-5, cache_write_price: 1.25e-5, cache_read_price: 1e-6 },
          ],
        },
      }],
    }],
  };

  it('shows the discount where the series chip was and expands tier details on click', async () => {
    mocks.accountApi.mockResolvedValue(plaza);
    mocks.loadAppConfig.mockResolvedValue({ presetCustomModels: { myagents: [{ model: 'gpt-5.6-sol', modelName: 'gpt-5.6-sol', modelSeries: 'myagents' }] } });
    render(<AvailableModelsWorkspace isActive reloadToken={1} onBusy={vi.fn()} />);
    expect(await screen.findByText('50% off')).toBeInTheDocument();
    expect(screen.queryByText('myagents')).not.toBeInTheDocument();
    expect(screen.getByText('$2.5 / $15')).toBeInTheDocument();

    const row = screen.getByRole('button', { expanded: false });
    await userEvent.setup().click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const details = within(document.querySelector('[data-model-price-details]') as HTMLElement);
    expect(details.getByText('Your price')).toBeInTheDocument();
    expect(details.getByText('Official')).toBeInTheDocument();
    expect(details.getAllByText('≤272K')).toHaveLength(2);
    expect(details.getByText('$22.5')).toBeInTheDocument();
    expect(details.getByText('$45')).toBeInTheDocument();
    expect(mocks.accountApi).toHaveBeenCalledWith('model-plaza');
  });
});
