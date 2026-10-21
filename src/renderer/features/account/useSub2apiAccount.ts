import { useSyncExternalStore } from 'react';
import { sub2api, type Sub2apiAccount, type Sub2apiSettings } from '@/api/sub2api';
import defaults from '../../../shared/sub2api-defaults.json';
import { isTauriEnvironment } from '@/utils/browserMock';
import { listenWithCleanup } from '@/utils/tauriListen';
import { resetPackagedGatewaySync, syncPackagedGateway } from './syncPackagedGateway';

type ServiceState = { settings: Sub2apiSettings | null; loading: boolean; error: unknown };
type Snapshot = { account: Sub2apiAccount; error: unknown; service: ServiceState };

const emptyAccount = (): Sub2apiAccount => ({ serverUrl: defaults.serverUrl, user: null });
const emptyService = (): ServiceState => ({ settings: null, loading: false, error: null });

const listeners = new Set<() => void>();
let restoreStarted = false;
let restoreAbort: AbortController | null = null;
let sequence = 0;
let serviceSequence = 0;
let snapshot: Snapshot = { account: emptyAccount(), error: null, service: emptyService() };

function emit(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  startRestore();
  return () => { listeners.delete(listener); };
}

async function loadSettings() {
  const current = ++serviceSequence;
  emit({ ...snapshot, service: { ...snapshot.service, error: null } });
  try {
    const settings = await sub2api.settings();
    if (current === serviceSequence) emit({ ...snapshot, service: { settings, loading: false, error: null } });
  } catch (error) {
    if (current === serviceSequence) emit({ ...snapshot, service: { settings: snapshot.service.settings, loading: false, error } });
  }
}

async function refresh(verify = false) {
  const current = ++sequence;
  try {
    const account = await sub2api.account(verify);
    if (current === sequence) {
      emit({ ...snapshot, account, error: null });
      void syncPackagedGateway(account);
    }
  } catch (error) {
    if (current === sequence) emit({ ...snapshot, error });
  }
}

function accept(account: Sub2apiAccount) {
  sequence++;
  emit({ ...snapshot, account, error: null });
  void syncPackagedGateway(account);
}

function startRestore() {
  if (restoreStarted || !isTauriEnvironment()) return;
  restoreStarted = true;
  restoreAbort = new AbortController();
  const { signal } = restoreAbort;
  void loadSettings();
  void (async () => {
    await refresh();
    if (!signal.aborted) await refresh(true);
  })();
  void listenWithCleanup('sub2api-account:changed', () => { void refresh(); }, signal);
}

export function resetSub2apiAccountStore() {
  sequence++;
  serviceSequence++;
  restoreStarted = false;
  restoreAbort?.abort();
  restoreAbort = null;
  resetPackagedGatewaySync();
  emit({ account: emptyAccount(), error: null, service: emptyService() });
}

export function useSub2apiAccount() {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  return {
    account: current.account,
    error: current.error,
    service: current.service,
    refresh,
    accept,
    loadSettings,
  };
}
