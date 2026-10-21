import { i18n } from "@/i18n";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function inv<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`LSAGENT account requires Tauri runtime: ${cmd}`);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export type AccountAvatarUrls = Record<"64" | "128" | "256", string>;

export interface AccountUser {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  avatarPresetId?: string | null;
  avatarUrls?: AccountAvatarUrls | null;
}

export interface AccountSpaceInfo {
  id: string;
  slug: string;
  name: string;
}

export interface AccountMembership {
  role: string;
}

export interface AccountSession {
  sessionBindingId?: string;
  baseUrl: string;
  expiresAt?: string | null;
  user: AccountUser;
  space: AccountSpaceInfo;
  membership: AccountMembership;
  updatedAt: string;
}

export type AccountProfile = Omit<AccountSession, "sessionBindingId" | "expiresAt">;

export type AccountSessionView =
  | { state: "authenticated"; session: AccountSession }
  | {
      state: "reauth_required";
      account: AccountProfile;
      invalidatedSessionBindingId: string;
    };

export interface AccountCommandError {
  code: string;
  message: string;
  cloudCode?: string;
  httpStatus?: number;
  requestId?: string;
  retryable?: boolean;
  sessionBindingId?: string;
}

export interface AccountErrorContext {
  method?: string;
  path?: string;
  operation?: string;
}

export interface NormalizedAccountError {
  userMessage: string;
  debugMessage: string;
}

function rawErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  if (
    error &&
    typeof error === "object" &&
    "error" in error &&
    typeof error.error === "string"
  ) {
    return error.error;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function sanitizeAccountError(message: string): string {
  return message
    .replace(/\s*\(https?:\/\/[^)]+\)/g, "")
    .replace(/https?:\/\/\S+/g, "[URL]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\/Users\/[^\s)]+/g, "[path]")
    .replace(/\/var\/folders\/[^\s)]+/g, "[path]")
    .replace(/[A-Z]:\\Users\\[^\s)]+/g, "[path]")
    .trim();
}

function accountText(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(`app:account.errors.${key}`, options));
}

export function accountErrorCode(error: unknown): string | null {
  const raw = rawErrorMessage(error);
  const rawCode = raw.match(/\b([A-Z][A-Z0-9_]+):/)?.[1] ?? null;
  if (!error || typeof error !== "object") return rawCode;
  const maybeError = error as { accountCode?: unknown; code?: unknown };
  if (typeof maybeError.accountCode === "string") return maybeError.accountCode;
  if (typeof maybeError.code === "string") return maybeError.code;
  return rawCode;
}

export function normalizeAccountError(
  error: unknown,
  context?: AccountErrorContext,
): NormalizedAccountError {
  const raw = rawErrorMessage(error);
  const sanitized = sanitizeAccountError(raw);
  const operation = context?.operation ?? accountText("operations.request");
  const lower = raw.toLowerCase();
  const envelope =
    error && typeof error === "object"
      ? (error as { code?: unknown; requestId?: unknown; recoveryHint?: { message?: unknown } })
      : null;
  const code = typeof envelope?.code === "string" ? envelope.code : "";
  const requestId = typeof envelope?.requestId === "string" ? envelope.requestId : "";
  const recoveryMessage =
    typeof envelope?.recoveryHint?.message === "string"
      ? envelope.recoveryHint.message.trim()
      : "";
  const debugSuffix = [code, requestId].filter(Boolean).join(" ");

  if (
    code === "NOT_AUTHENTICATED" ||
    code === "SESSION_EXPIRED" ||
    code === "SPACE_REAUTH_REQUIRED"
  ) {
    return {
      userMessage: accountText("templates.relogin", { operation }),
      debugMessage: [debugSuffix, sanitized].filter(Boolean).join(" · "),
    };
  }

  if (
    code === "FORBIDDEN" ||
    code.includes("PERMISSION") ||
    lower.includes("permission required")
  ) {
    return {
      userMessage: accountText("templates.permissionDenied", { operation }),
      debugMessage: [debugSuffix, sanitized].filter(Boolean).join(" · "),
    };
  }

  if (code === "INTERNAL_ERROR") {
    return {
      userMessage: accountText("templates.serviceUnavailable", { operation }),
      debugMessage: [debugSuffix, sanitized].filter(Boolean).join(" · "),
    };
  }

  if (recoveryMessage) {
    return {
      userMessage: accountText("templates.withDetail", {
        operation,
        detail: recoveryMessage,
      }),
      debugMessage: [debugSuffix, sanitized].filter(Boolean).join(" · "),
    };
  }

  if (
    lower.includes("error sending request") ||
    lower.includes("account request failed") ||
    lower.includes("load failed") ||
    lower.includes("network") ||
    lower.includes("timed out")
  ) {
    return {
      userMessage: accountText("templates.network", { operation }),
      debugMessage: [debugSuffix, sanitized].filter(Boolean).join(" · "),
    };
  }

  if (
    lower.includes("invalid space api response") ||
    lower.includes("response missing data")
  ) {
    return {
      userMessage: accountText("templates.invalidResponse", { operation }),
      debugMessage: [debugSuffix, sanitized].filter(Boolean).join(" · "),
    };
  }

  if (sanitized) {
    return {
      userMessage: accountText("templates.withDetail", {
        operation,
        detail: sanitized,
      }),
      debugMessage: [debugSuffix, sanitized].filter(Boolean).join(" · "),
    };
  }

  return {
    userMessage: accountText("templates.failed", { operation }),
    debugMessage: [debugSuffix, raw].filter(Boolean).join(" · "),
  };
}

export function accountErrorMessage(
  error: unknown,
  context?: AccountErrorContext,
): string {
  return normalizeAccountError(error, context).userMessage;
}

export function accountGetSession(): Promise<AccountSessionView | null> {
  return inv("cmd_space_get_session");
}

export function accountLogout(): Promise<void> {
  return inv("cmd_space_logout");
}

export function accountAuthStart(): Promise<{
  loginToken: string;
  authorizationUrl: string;
  expiresInSeconds: number;
}> {
  return inv("cmd_space_auth_start");
}

export function accountAuthPoll(
  loginToken: string,
): Promise<Record<string, unknown>> {
  return inv("cmd_space_auth_poll", { input: { loginToken } });
}

export function accountAuthAck(loginToken: string): Promise<void> {
  return inv("cmd_space_auth_ack", { input: { loginToken } });
}
