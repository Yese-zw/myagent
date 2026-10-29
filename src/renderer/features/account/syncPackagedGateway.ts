import { fetchProviderModels } from '@/config/services/modelDiscoveryService';
import { atomicModifyConfig } from '@/config/services/appConfigService';
import { deleteApiKey, rebuildAndPersistAvailableProviders, saveApiKey } from '@/config/services/providerService';
import { MYAGENTS_PROVIDER_ID } from '../../../shared/packaged-gateway';
import { sub2api, type Sub2apiAccount } from '@/api/sub2api';
import { isTauriEnvironment } from '@/utils/browserMock';

// User + key group last synced; a group switched on the website re-syncs the key.
let syncedAccountKey: string | null = null;
let inflight: Promise<void> | null = null;
let inflightAccountKey: string | null = null;

export async function syncPackagedGateway(
  account: Sub2apiAccount,
  options?: { force?: boolean },
): Promise<void> {
  if (!isTauriEnvironment()) return;
  if (!account.user) {
    syncedAccountKey = null;
    await deleteApiKey(MYAGENTS_PROVIDER_ID).catch(() => undefined);
    return;
  }
  const accountKey = `${account.user.id}:${account.appGroupId ?? ''}`;
  if (!options?.force && syncedAccountKey === accountKey) return;
  if (inflight) {
    if (inflightAccountKey === accountKey) return inflight;
    // A newer key group arrived while an older sync runs: re-sync after it.
    await inflight;
    return syncPackagedGateway(account, options);
  }
  inflightAccountKey = accountKey;
  inflight = (async () => {
    const creds = await sub2api.gateway();
    await saveApiKey(MYAGENTS_PROVIDER_ID, creds.apiKey);
    const discovered = await fetchProviderModels({
      id: MYAGENTS_PROVIDER_ID,
      config: { baseUrl: creds.baseUrl },
      modelListUrl: `${creds.baseUrl.replace(/\/+$/, '')}/models`,
    }, creds.apiKey);
    const models = discovered.map(item => ({
      model: item.id,
      modelName: item.displayName || item.id,
      modelSeries: item.ownedBy || 'myagents',
      contextLength: item.contextLength,
      maxOutputTokens: item.maxOutputTokens,
      source: 'discovered' as const,
    }));
    await atomicModifyConfig(current => ({
      ...current,
      defaultProviderId: MYAGENTS_PROVIDER_ID,
      presetCustomModels: {
        ...(current.presetCustomModels ?? {}),
        [MYAGENTS_PROVIDER_ID]: models,
      },
      providerPrimaryModels: {
        ...(current.providerPrimaryModels ?? {}),
        ...(models[0]?.model ? { [MYAGENTS_PROVIDER_ID]: models[0].model } : {}),
      },
    }));
    await rebuildAndPersistAvailableProviders();
    syncedAccountKey = accountKey;
  })().catch(error => {
    console.warn('[sub2api] gateway sync failed', error);
  }).finally(() => { inflight = null; });
  return inflight;
}

export function resetPackagedGatewaySync() {
  syncedAccountKey = null;
  inflight = null;
}

export async function refreshPackagedGatewayModels(): Promise<void> {
  if (!isTauriEnvironment()) return;
  const account = await sub2api.account();
  await syncPackagedGateway(account, { force: true });
}
