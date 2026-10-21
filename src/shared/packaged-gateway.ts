import defaults from './sub2api-defaults.json';
import type { ModelEntity, Provider } from './config-types';

export const MYAGENTS_PROVIDER_ID = 'myagents';

export function packagedGatewayOrigin(): string {
  return String(defaults.serverUrl ?? '').replace(/\/+$/, '');
}

export function packagedGatewayBaseUrl(): string {
  return `${packagedGatewayOrigin()}/v1`;
}

export function withoutPackagedGatewayDisabled<T extends { disabledProviderIds?: string[] }>(settings: T): T {
  const disabled = (settings.disabledProviderIds ?? []).filter(id => id !== MYAGENTS_PROVIDER_ID);
  return { ...settings, disabledProviderIds: disabled.length ? disabled : undefined };
}

export function buildPackagedGatewayProvider(models: ModelEntity[] = []): Provider {
  const baseUrl = packagedGatewayBaseUrl();
  return {
    id: MYAGENTS_PROVIDER_ID,
    name: 'LSAGENT',
    vendor: 'LSAGENT',
    cloudProvider: '官方',
    type: 'api',
    primaryModel: models[0]?.model ?? '',
    isBuiltin: true,
    apiProtocol: 'openai',
    upstreamFormat: 'chat_completions',
    authType: 'api_key',
    modelListUrl: `${baseUrl}/models`,
    websiteUrl: packagedGatewayOrigin(),
    config: { baseUrl },
    models,
    enabled: true,
  };
}
