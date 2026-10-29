import { useEffect, useSyncExternalStore } from 'react';
import { sub2api } from '@/api/sub2api';
import { isTauriEnvironment } from '@/utils/browserMock';
import { buildModelPrices, type ModelPrice } from './modelPricing';

/** App-wide cache of model-plaza prices for the packaged gateway, shared by the
 *  chat model picker and the available-models page so both show the same
 *  discount without each fetching the plaza. */

const EMPTY: ReadonlyMap<string, ModelPrice> = new Map();
let prices: ReadonlyMap<string, ModelPrice> = EMPTY;
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: ReadonlyMap<string, ModelPrice>) {
  prices = next;
  listeners.forEach(listener => listener());
}

/** Fetch plaza prices; `force` re-fetches even when a list is cached. Failures keep the last list. */
export function refreshModelPrices(force = true): Promise<void> {
  if (!isTauriEnvironment()) return Promise.resolve();
  if (!force && (loaded || inflight)) return inflight ?? Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [plaza, account] = await Promise.all([sub2api.accountApi('model-plaza'), sub2api.account()]);
      loaded = true;
      publish(buildModelPrices(plaza, account.appGroupId));
    } catch {
      // Plaza disabled, signed out or offline: model lists simply show no price.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Current plaza prices by model id; loads them once on first use. */
export function useModelPrices(): ReadonlyMap<string, ModelPrice> {
  useEffect(() => { void refreshModelPrices(false); }, []);
  return useSyncExternalStore(subscribe, () => prices, () => EMPTY);
}

/** Test-only reset of the module cache. */
export function resetModelPricesForTest() {
  prices = EMPTY; loaded = false; inflight = null; listeners.clear();
}
