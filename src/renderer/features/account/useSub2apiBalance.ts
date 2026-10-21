import { useEffect, useSyncExternalStore } from 'react';
import { sub2api } from '@/api/sub2api';
import { useSub2apiAccount } from './useSub2apiAccount';

type BalanceSnapshot = { userId: number | null; balance: number | null; loading: boolean; failed: boolean };

// The gateway owns the balance; this is only a shared read-through cache so the
// sidebar card and the recharge page show the same number and refresh together.
const FOCUS_REFRESH_MS = 30_000;
const listeners = new Set<() => void>();
let snapshot: BalanceSnapshot = { userId: null, balance: null, loading: false, failed: false };
let sequence = 0;
let fetchedAt = 0;

function emit(next: BalanceSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function refreshSub2apiBalance() {
  const userId = snapshot.userId;
  if (userId == null) return;
  const current = ++sequence;
  emit({ ...snapshot, loading: true });
  try {
    const profile = await sub2api.accountApi('profile') as Record<string, unknown> | null;
    const balance = Number(profile?.balance);
    if (current !== sequence || snapshot.userId !== userId) return;
    fetchedAt = Date.now();
    emit({ userId, balance: Number.isFinite(balance) ? balance : null, loading: false, failed: false });
  } catch {
    if (current === sequence) emit({ ...snapshot, loading: false, failed: true });
  }
}

function bindUser(userId: number | null) {
  if (snapshot.userId === userId) return;
  sequence++;
  fetchedAt = 0;
  emit({ userId, balance: null, loading: false, failed: false });
  if (userId != null) void refreshSub2apiBalance();
}

export function useSub2apiBalance() {
  const { account } = useSub2apiAccount();
  const userId = account.user?.id ?? null;
  const current = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  useEffect(() => { bindUser(userId); }, [userId]);
  useEffect(() => {
    if (userId == null) return;
    const onFocus = () => { if (Date.now() - fetchedAt > FOCUS_REFRESH_MS && !snapshot.loading) void refreshSub2apiBalance(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [userId]);
  const own = current.userId === userId;
  return {
    signedIn: userId != null,
    balance: own ? current.balance : null,
    loading: own && current.loading,
    failed: own && current.failed,
    refresh: refreshSub2apiBalance,
  };
}
