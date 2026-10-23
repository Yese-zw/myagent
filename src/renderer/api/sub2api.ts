import { invoke } from '@tauri-apps/api/core';
import { isTauriEnvironment } from '@/utils/browserMock';

export interface Sub2apiUser { id: number; email: string; username: string }
export interface Sub2apiAccount { serverUrl: string; user: Sub2apiUser | null }
export interface Sub2apiAgreement { id: string; title: string; content_md: string }
export interface Sub2apiSettings {
  site_name: string;
  site_logo?: string;
  registration_enabled: boolean;
  email_verify_enabled: boolean;
  invitation_code_enabled: boolean;
  affiliate_enabled?: boolean;
  registration_email_suffix_whitelist: string[];
  login_agreement_enabled: boolean;
  login_agreement_documents: Sub2apiAgreement[];
  balance_low_notify_enabled?: boolean;
  balance_low_notify_threshold?: number;
}
export interface Sub2apiAuthInput {
  email: string; password: string; verifyCode: string; invitationCode: string; affCode?: string; agreed: boolean;
}

export class Sub2apiError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'Sub2apiError'; }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriEnvironment()) throw new Sub2apiError('DESKTOP_REQUIRED');
  try { return await invoke<T>(command, args); }
  catch (error) {
    // Rust emits bounded error codes; never echo URLs, passwords or raw errors.
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code : 'UNKNOWN';
    throw new Sub2apiError(code);
  }
}

export const sub2api = {
  account: (refresh = false) => call<Sub2apiAccount>('cmd_sub2api_get_account', { refresh }),
  settings: () => call<Sub2apiSettings>('cmd_sub2api_public_settings'),
  authenticate: (input: Sub2apiAuthInput, register: boolean) =>
    call<Sub2apiAccount>('cmd_sub2api_authenticate', { input, register }),
  gateway: () => call<{ baseUrl: string; apiKey: string }>('cmd_sub2api_gateway'),
  codexAppStatus: () => call<{ installed: boolean; name: string | null }>('cmd_sub2api_codex_app_status'),
  launchCodex: () => call<boolean>('cmd_sub2api_launch_codex'),
  sendCode: (email: string) => call<number>('cmd_sub2api_send_code', { email }),
  logout: () => call<Sub2apiAccount>('cmd_sub2api_logout'),
  cancel: () => call<void>('cmd_sub2api_cancel'),
  accountApi: (operation: string, payload?: Record<string, unknown>) => call<unknown>('cmd_sub2api_account_api', { operation, payload }),
};

export function sub2apiErrorCode(error: unknown): string {
  return error instanceof Sub2apiError ? error.code : 'UNKNOWN';
}
