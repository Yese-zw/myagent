import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { getHomeDirOrNull } from './platform';

export function readPackagedGatewayApiKey(): string | undefined {
  const home = getHomeDirOrNull();
  if (!home) return undefined;
  const path = resolve(home, '.myagents', 'credentials', 'sub2api.json');
  if (!existsSync(path)) return undefined;
  try {
    const stored = JSON.parse(readFileSync(path, 'utf-8')) as {
      grant?: { api_key?: unknown };
    };
    const key = stored.grant?.api_key;
    return typeof key === 'string' && key.trim().length >= 8 ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}
