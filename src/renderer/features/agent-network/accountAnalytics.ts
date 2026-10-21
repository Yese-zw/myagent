import { track } from '@/analytics';

export type AccountErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'validation_error'
  | 'network_error'
  | 'server_error'
  | 'unknown';

export function normalizeAccountErrorCode(error: unknown): AccountErrorCode {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('login')) return 'unauthorized';
  if (lower.includes('403') || lower.includes('forbidden') || lower.includes('permission')) return 'forbidden';
  if (lower.includes('404') || lower.includes('not found')) return 'not_found';
  if (lower.includes('429') || lower.includes('rate')) return 'rate_limited';
  if (lower.includes('400') || lower.includes('validation') || lower.includes('invalid')) return 'validation_error';
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('load failed')) return 'network_error';
  if (lower.includes('500') || lower.includes('server')) return 'server_error';
  return 'unknown';
}

/** Account sign-in telemetry. Shared by every surface that needs a signed-in
 * MyAgents account before it can serve its own feature. */
export function trackAccountAuth(
  operation: 'start' | 'success' | 'failure',
  ok: boolean,
  error?: unknown,
): void {
  const params = {
    operation,
    ok,
    ...(ok ? {} : { error_code: normalizeAccountErrorCode(error) }),
  };
  if (operation === 'start') track('account_auth_start', params);
  else track('account_auth_complete', params);
}
