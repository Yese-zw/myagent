import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findEffectiveProvider, resolveProviderEnv } from './admin-config';

const scratchDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const scratch of scratchDirs.splice(0)) {
    rmSync(scratch, { recursive: true, force: true });
  }
});

function isolateHome() {
  const scratch = mkdtempSync(join(tmpdir(), 'myagents-packaged-gateway-'));
  scratchDirs.push(scratch);
  mkdirSync(join(scratch, '.myagents'), { recursive: true });
  vi.stubEnv(process.platform === 'win32' ? 'USERPROFILE' : 'HOME', scratch);
  return scratch;
}

describe('packaged gateway provider env', () => {
  it('registers myagents even when it is not a preset provider', () => {
    isolateHome();
    const provider = findEffectiveProvider('myagents', {
      presetCustomModels: {
        myagents: [{ model: 'claude-sonnet', modelName: 'Claude Sonnet', modelSeries: 'anthropic' }],
      },
      providerApiKeys: { myagents: 'sk-live-from-config' },
    });
    expect(provider?.id).toBe('myagents');
    expect(resolveProviderEnv('myagents', {
      presetCustomModels: {
        myagents: [{ model: 'claude-sonnet', modelName: 'Claude Sonnet', modelSeries: 'anthropic' }],
      },
      providerApiKeys: { myagents: 'sk-live-from-config' },
    })?.apiKey).toBe('sk-live-from-config');
  });

  it('reuses the account grant key when config has not copied it yet', () => {
    const home = isolateHome();
    mkdirSync(join(home, '.myagents', 'credentials'), { recursive: true });
    writeFileSync(join(home, '.myagents', 'credentials', 'sub2api.json'), JSON.stringify({
      schema_version: 1,
      grant: {
        server_url: 'https://lingsiai.vip',
        access_token: 'token',
        refresh_token: 'refresh',
        user: { id: 1, email: 'a@example.com', username: 'Ada' },
        api_key: 'sk-grant-shared-key',
      },
    }));
    const env = resolveProviderEnv('myagents', {
      presetCustomModels: {
        myagents: [{ model: 'claude-sonnet', modelName: 'Claude Sonnet', modelSeries: 'anthropic' }],
      },
      providerApiKeys: {},
    });
    expect(env?.apiKey).toBe('sk-grant-shared-key');
    expect(env?.baseUrl).toBe('https://lingsiai.vip/v1');
  });

  it('does not disable the packaged gateway when it appears in disabledProviderIds', () => {
    isolateHome();
    const env = resolveProviderEnv('myagents', {
      disabledProviderIds: ['myagents'],
      presetCustomModels: {
        myagents: [{ model: 'claude-sonnet', modelName: 'Claude Sonnet', modelSeries: 'anthropic' }],
      },
      providerApiKeys: { myagents: 'sk-still-usable' },
    });
    expect(env?.apiKey).toBe('sk-still-usable');
  });
});
