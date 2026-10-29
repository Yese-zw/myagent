import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  gateway: vi.fn(),
  saveApiKey: vi.fn(),
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => true }));
vi.mock('@/api/sub2api', () => ({ sub2api: { gateway: mocks.gateway } }));
vi.mock('@/config/services/providerService', () => ({
  saveApiKey: mocks.saveApiKey,
  deleteApiKey: vi.fn(async () => undefined),
  rebuildAndPersistAvailableProviders: vi.fn(async () => undefined),
}));
vi.mock('@/config/services/appConfigService', () => ({ atomicModifyConfig: vi.fn(async () => undefined) }));
vi.mock('@/config/services/modelDiscoveryService', () => ({ fetchProviderModels: vi.fn(async () => []) }));

import { resetPackagedGatewaySync, syncPackagedGateway } from './syncPackagedGateway';

const account = (appGroupId: number | null) => ({
  serverUrl: 'https://example.test',
  user: { id: 7, email: 'a@example.test', username: 'a' },
  appGroupId,
});

describe('syncPackagedGateway', () => {
  beforeEach(() => {
    resetPackagedGatewaySync();
    mocks.gateway.mockReset();
    mocks.saveApiKey.mockReset();
    mocks.gateway.mockImplementation(async () => ({ baseUrl: 'https://example.test/v1', apiKey: 'sk-key' }));
  });

  it('re-syncs the key when the App group was switched on the website', async () => {
    await syncPackagedGateway(account(110));
    await syncPackagedGateway(account(110));
    expect(mocks.gateway).toHaveBeenCalledTimes(1);

    await syncPackagedGateway(account(7));
    expect(mocks.gateway).toHaveBeenCalledTimes(2);
  });

  it('runs a newer group after an older sync that is still in flight', async () => {
    let release!: () => void;
    mocks.gateway.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve({ baseUrl: 'https://example.test/v1', apiKey: 'sk-old' });
    }));
    const first = syncPackagedGateway(account(110));
    const second = syncPackagedGateway(account(7));
    release();
    await Promise.all([first, second]);

    expect(mocks.gateway).toHaveBeenCalledTimes(2);
    expect(mocks.saveApiKey).toHaveBeenLastCalledWith('myagents', 'sk-key');
  });
});
