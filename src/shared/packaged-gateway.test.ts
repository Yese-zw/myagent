import { describe, expect, it } from 'vitest';
import { buildPackagedGatewayProvider, MYAGENTS_PROVIDER_ID, packagedGatewayBaseUrl, packagedGatewayOrigin, withoutPackagedGatewayDisabled } from './packaged-gateway';

describe('packaged gateway provider', () => {
  it('pins the origin, /v1 base URL, and discovered models', () => {
    expect(packagedGatewayOrigin()).toBe('https://lingsiai.vip');
    expect(packagedGatewayBaseUrl()).toBe('https://lingsiai.vip/v1');
    const provider = buildPackagedGatewayProvider([
      { model: 'claude-sonnet', modelName: 'Claude Sonnet', modelSeries: 'claude', source: 'discovered' },
    ]);
    expect(provider.id).toBe(MYAGENTS_PROVIDER_ID);
    expect(provider.config.baseUrl).toBe('https://lingsiai.vip/v1');
    expect(provider.modelListUrl).toBe('https://lingsiai.vip/v1/models');
    expect(provider.apiProtocol).toBe('openai');
    expect(provider.primaryModel).toBe('claude-sonnet');
    expect(provider.models).toHaveLength(1);
  });

  it('never leaves the packaged gateway in the disabled list', () => {
    expect(withoutPackagedGatewayDisabled({
      disabledProviderIds: [MYAGENTS_PROVIDER_ID, 'other'],
    }).disabledProviderIds).toEqual(['other']);
  });
});
