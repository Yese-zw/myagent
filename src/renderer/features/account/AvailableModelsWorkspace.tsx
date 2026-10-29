import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon, LayersIcon, LoaderIcon } from '@/components/icons';
import { loadAppConfig } from '@/config/services/appConfigService';
import { MYAGENTS_PROVIDER_ID } from '../../../shared/packaged-gateway';
import type { ModelEntity } from '../../../shared/config-types';
import { refreshPackagedGatewayModels } from './syncPackagedGateway';
import { formatUsd, platformLabel, type ModelPrice, type PriceTier } from './modelPricing';
import { refreshModelPrices, useModelPrices } from './useModelPrices';

function tokens(value: number | undefined) {
  if (!value) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
  return String(value);
}

export default function AvailableModelsWorkspace({
  isActive,
  reloadToken,
  onBusy,
}: {
  isActive: boolean;
  reloadToken: number;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation('app');
  const [models, setModels] = useState<ModelEntity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prices = useModelPrices();
  const [expanded, setExpanded] = useState<string | null>(null);

  // Plaza prices are a best-effort overlay: the list renders without them.
  useEffect(() => {
    if (isActive) void refreshModelPrices();
  }, [isActive, reloadToken]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    onBusy(true);
    setError(null);
    const readSaved = async () => (await loadAppConfig()).presetCustomModels?.[MYAGENTS_PROVIDER_ID] ?? [];
    void (async () => {
      // Show the last synced list at once; the gateway refresh below can take
      // several round trips (key, /models, config write) before it lands.
      let shown = false;
      try {
        const saved = await readSaved();
        if (!cancelled && saved.length > 0) {
          setModels(saved);
          shown = true;
        }
      } catch {
        // No saved list yet: wait for the refresh.
      }
      try {
        await refreshPackagedGatewayModels();
        const fresh = await readSaved();
        if (!cancelled) setModels(fresh);
      } catch {
        // Keep a list already on screen; only an empty page reports the failure.
        if (!cancelled && !shown) {
          setModels([]);
          setError(t('sub2api.modelsLoadFailed'));
        }
      } finally {
        if (!cancelled) onBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isActive, onBusy, reloadToken, t]);

  if (models === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label={t('sub2api.refresh')}>
        <LoaderIcon className="h-8 w-8 animate-spin text-[var(--ink-muted)]" />
      </div>
    );
  }

  if (error) {
    return <p role="alert" className="text-sm text-[var(--error)]">{error}</p>;
  }

  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--line)] bg-[var(--paper-elevated)] px-6 py-16 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--paper-inset)] text-[var(--ink-muted)]">
          <LayersIcon className="h-6 w-6" />
        </span>
        <p className="mt-4 text-sm font-medium text-[var(--ink)]">{t('sub2api.emptyState.modelsTitle')}</p>
        <p className="mt-1 max-w-sm text-sm leading-6 text-[var(--ink-muted)]">{t('sub2api.emptyState.modelsHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-[var(--line-subtle)] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)]">
        {models.map(model => {
          const context = tokens(model.contextLength);
          const output = tokens(model.maxOutputTokens);
          const price = prices.get(model.model);
          const canExpand = !!price && (price.tiers.length > 0 || price.officialTiers.length > 0);
          const open = canExpand && expanded === model.model;
          const head = (
            <>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-[var(--ink)]">
                  <span className="truncate">{model.modelName || model.model}</span>
                  {price?.platform && (
                    <span className="shrink-0 rounded-md bg-[var(--paper-inset)] px-1.5 py-0.5 text-xs font-medium text-[var(--ink-muted)]" data-model-platform>
                      {platformLabel(price.platform)}
                    </span>
                  )}
                </p>
                {model.modelName && model.modelName !== model.model && (
                  <p className="mt-0.5 break-all font-mono text-xs text-[var(--ink-muted)]">{model.model}</p>
                )}
                {price && <PriceSummary price={price} />}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-[var(--ink-muted)]">
                {context && <span className="rounded-md bg-[var(--paper-inset)] px-2 py-1">{t('sub2api.modelContext', { value: context })}</span>}
                {output && <span className="rounded-md bg-[var(--paper-inset)] px-2 py-1">{t('sub2api.modelOutput', { value: output })}</span>}
                {price?.ratio != null && <DiscountBadge ratio={price.ratio} />}
                {canExpand && (
                  <ChevronDownIcon className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                )}
              </div>
            </>
          );
          return (
            <li key={model.model} className={open ? 'bg-[var(--paper-inset)]/40' : undefined}>
              {canExpand ? (
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(current => (current === model.model ? null : model.model))}
                  className="flex w-full items-start gap-4 px-4 py-3.5 text-left transition-colors hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                >
                  {head}
                </button>
              ) : (
                <div className="flex items-start gap-4 px-4 py-3.5">{head}</div>
              )}
              {open && price && <PriceDetails price={price} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function discountLabel(t: (key: string, options?: Record<string, unknown>) => string, ratio: number) {
  return t('sub2api.modelPrice.discount', { value: Number((ratio * 10).toFixed(1)), percent: Math.round((1 - ratio) * 100) });
}

function DiscountBadge({ ratio }: { ratio: number }) {
  const { t } = useTranslation('app');
  return (
    <span className="rounded-md bg-[var(--accent-warm-subtle)] px-2.5 py-1 text-sm font-semibold text-[var(--accent-warm)]" data-model-discount>
      {discountLabel(t, ratio)}
    </span>
  );
}

const usd = (value: number | null) => (value == null ? '—' : formatUsd(value));

/** One-line input / output price under the model name. */
function PriceSummary({ price }: { price: ModelPrice }) {
  const { t } = useTranslation('app');
  if (price.input == null && price.output == null) {
    if (price.perRequest == null) return null;
    return <p className="mt-1.5 text-xs font-medium text-[var(--ink)]">{t('sub2api.modelPrice.perRequest', { price: formatUsd(price.perRequest) })}</p>;
  }
  return (
    <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-xs text-[var(--ink-muted)]" data-model-price>
      <span className="font-medium text-[var(--ink)]">{usd(price.input)} / {usd(price.output)}</span>
      {price.ratio != null && (price.officialInput != null || price.officialOutput != null) && (
        <span className="line-through">{usd(price.officialInput)} / {usd(price.officialOutput)}</span>
      )}
      <span>{t('sub2api.modelPrice.unitShort')}</span>
    </p>
  );
}

function CacheCell({ tier }: { tier: PriceTier }) {
  const { t } = useTranslation('app');
  if (tier.cacheWrite == null && tier.cacheRead == null) return <>—</>;
  return (
    <span className="flex flex-col gap-0.5">
      {tier.cacheWrite != null && (
        <span>
          {t('sub2api.modelPrice.cacheWrite')} {usd(tier.cacheWrite)}
          {tier.cacheWrite1h != null && <span className="text-[var(--ink-muted)]"> (1h {usd(tier.cacheWrite1h)})</span>}
        </span>
      )}
      {tier.cacheRead != null && <span>{t('sub2api.modelPrice.cacheRead')} {usd(tier.cacheRead)}</span>}
    </span>
  );
}

function TierRows({ title, tiers, muted }: { title: string; tiers: PriceTier[]; muted?: boolean }) {
  return (
    <>
      {tiers.map((tier, index) => (
        <tr key={`${title}-${tier.label ?? index}`} className={muted ? 'text-[var(--ink-muted)]' : 'text-[var(--ink)]'}>
          {index === 0 && (
            <th scope="rowgroup" rowSpan={tiers.length} className="whitespace-nowrap py-2 pr-4 text-left align-top font-medium">
              {title}
            </th>
          )}
          <td className="whitespace-nowrap py-2 pr-4 align-top text-[var(--ink-muted)]">{tier.label ?? '—'}</td>
          <td className="whitespace-nowrap py-2 pr-4 align-top tabular-nums">{usd(tier.input)}</td>
          <td className="whitespace-nowrap py-2 pr-4 align-top tabular-nums">{usd(tier.output)}</td>
          <td className="py-2 align-top tabular-nums"><CacheCell tier={tier} /></td>
        </tr>
      ))}
    </>
  );
}

/** Expanded row: every tier of what you pay against the official reference. */
function PriceDetails({ price }: { price: ModelPrice }) {
  const { t } = useTranslation('app');
  return (
    <div className="px-4 pb-4" data-model-price-details>
      <div className="overflow-x-auto rounded-lg border border-[var(--line-subtle)] bg-[var(--paper-elevated)] px-4 py-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--line-subtle)] text-left text-[var(--ink-muted)]">
              <th scope="col" className="py-2 pr-4 font-medium"><span className="sr-only">{t('sub2api.modelPrice.kind')}</span></th>
              <th scope="col" className="py-2 pr-4 font-medium">{t('sub2api.modelPrice.tier')}</th>
              <th scope="col" className="py-2 pr-4 font-medium">{t('sub2api.modelPrice.input')}</th>
              <th scope="col" className="py-2 pr-4 font-medium">{t('sub2api.modelPrice.output')}</th>
              <th scope="col" className="py-2 font-medium">{t('sub2api.modelPrice.cache')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line-subtle)]">
            {price.tiers.length > 0 && <TierRows title={t('sub2api.modelPrice.current')} tiers={price.tiers} />}
            {price.officialTiers.length > 0 && <TierRows title={t('sub2api.modelPrice.official')} tiers={price.officialTiers} muted />}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
        <span>{t('sub2api.modelPrice.unit')}</span>
        {price.ratio != null && <span>{t('sub2api.modelPrice.savings', { discount: discountLabel(t, price.ratio) })}</span>}
      </p>
    </div>
  );
}
