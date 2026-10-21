import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayersIcon, LoaderIcon } from '@/components/icons';
import { loadAppConfig } from '@/config/services/appConfigService';
import { MYAGENTS_PROVIDER_ID } from '../../../shared/packaged-gateway';
import type { ModelEntity } from '../../../shared/config-types';
import { refreshPackagedGatewayModels } from './syncPackagedGateway';

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

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    onBusy(true);
    setError(null);
    void (async () => {
      try {
        await refreshPackagedGatewayModels();
        const config = await loadAppConfig();
        if (!cancelled) setModels(config.presetCustomModels?.[MYAGENTS_PROVIDER_ID] ?? []);
      } catch {
        if (!cancelled) {
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
      <p className="text-sm text-[var(--ink-muted)]">{t('sub2api.modelsHint', { count: models.length })}</p>
      <ul className="divide-y divide-[var(--line-subtle)] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)]">
        {models.map(model => {
          const context = tokens(model.contextLength);
          const output = tokens(model.maxOutputTokens);
          return (
            <li key={model.model} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0">
                <p className="font-medium text-[var(--ink)]">{model.modelName || model.model}</p>
                {model.modelName && model.modelName !== model.model && (
                  <p className="mt-0.5 break-all font-mono text-xs text-[var(--ink-muted)]">{model.model}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
                {model.modelSeries && (
                  <span className="rounded-md bg-[var(--paper-inset)] px-2 py-1">{model.modelSeries}</span>
                )}
                {context && <span className="rounded-md bg-[var(--paper-inset)] px-2 py-1">{t('sub2api.modelContext', { value: context })}</span>}
                {output && <span className="rounded-md bg-[var(--paper-inset)] px-2 py-1">{t('sub2api.modelOutput', { value: output })}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
