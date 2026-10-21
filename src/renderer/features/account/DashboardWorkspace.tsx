import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArcElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LineController,
  LineElement,
  DoughnutController,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';
import { ChevronDownIcon, LoaderIcon } from '@/components/icons';
import { sub2api, sub2apiErrorCode } from '@/api/sub2api';
import DateRangePicker from './DateRangePicker';

Chart.register(ArcElement, CategoryScale, DoughnutController, Filler, Legend, LineController, LineElement, LinearScale, PointElement, Tooltip);

type RecordValue = Record<string, unknown>;
type TrendPoint = {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  actual_cost: number;
  cost: number;
};
type ModelRow = { model: string; requests: number; total_tokens: number; actual_cost: number; cost: number };

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}
function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function money(value: unknown, digits = 2) {
  return `$${num(value).toFixed(digits)}`;
}
function tokens(value: unknown) {
  const n = num(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}
function formatChartTokens(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K`;
  return value.toLocaleString();
}
function formatChartCost(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K`;
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(3);
  return value.toFixed(4);
}
function localDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
function parseTrend(value: unknown): TrendPoint[] {
  const source = record(value);
  const items = Array.isArray(value) ? value : Array.isArray(source.trend) ? source.trend : [];
  return items.filter(item => item && typeof item === 'object').map(item => {
    const row = record(item);
    return {
      date: String(row.date ?? ''),
      input_tokens: num(row.input_tokens),
      output_tokens: num(row.output_tokens),
      cache_creation_tokens: num(row.cache_creation_tokens),
      cache_read_tokens: num(row.cache_read_tokens),
      actual_cost: num(row.actual_cost),
      cost: num(row.cost),
    };
  });
}
function parseModels(value: unknown): ModelRow[] {
  const source = record(value);
  const items = Array.isArray(value) ? value : Array.isArray(source.models) ? source.models : [];
  return items.filter(item => item && typeof item === 'object').map(item => {
    const row = record(item);
    return {
      model: String(row.model ?? '—'),
      requests: num(row.requests),
      total_tokens: num(row.total_tokens),
      actual_cost: num(row.actual_cost),
      cost: num(row.cost),
    };
  });
}
function themeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    text: styles.getPropertyValue('--ink').trim() || '#374151',
    muted: styles.getPropertyValue('--ink-muted').trim() || '#6b7280',
    grid: styles.getPropertyValue('--line').trim() || '#e5e7eb',
  };
}

function ChartView({ config }: { config: ChartConfiguration }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas?.getContext('2d')) return;
    const chart = new Chart(canvas, config);
    return () => chart.destroy();
  }, [config]);
  return <canvas ref={canvasRef} />;
}

export default function DashboardWorkspace({
  isActive,
  reloadToken,
  onBusy,
}: {
  isActive: boolean;
  reloadToken: number;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation('app');
  const [startDate, setStartDate] = useState(() => localDate(-6));
  const [endDate, setEndDate] = useState(() => localDate());
  const [granularity, setGranularity] = useState<'day' | 'hour'>('day');
  const [profile, setProfile] = useState<RecordValue>({});
  const [stats, setStats] = useState<RecordValue>({});
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  useEffect(() => {
    if (!isActive) return;
    const current = ++sequence.current;
    setError('');
    setLoading(true);
    onBusy(true);
    const range = { start_date: startDate, end_date: endDate, timezone };
    void Promise.all([
      sub2api.accountApi('profile'),
      sub2api.accountApi('dashboard-stats'),
      sub2api.accountApi('dashboard-trend', { ...range, granularity }),
      sub2api.accountApi('dashboard-models', range),
    ]).then(([nextProfile, nextStats, nextTrend, nextModels]) => {
      if (current !== sequence.current) return;
      setProfile(record(nextProfile));
      setStats(record(nextStats));
      setTrend(parseTrend(nextTrend));
      setModels(parseModels(nextModels));
    }).catch(reason => {
      if (current !== sequence.current) return;
      setError(t(`sub2api.errors.${sub2apiErrorCode(reason)}`, { defaultValue: t('sub2api.errors.UNKNOWN') }));
    }).finally(() => {
      if (current !== sequence.current) return;
      setLoading(false);
      onBusy(false);
    });
    return () => { sequence.current += 1; onBusy(false); };
  }, [endDate, granularity, isActive, onBusy, reloadToken, startDate, t, timezone]);

  const tokenHint = (input: unknown, output: unknown, cacheCreate: unknown, cacheRead: unknown) =>
    `${t('sub2api.dashboard.input')}: ${tokens(input)} / ${t('sub2api.dashboard.output')}: ${tokens(output)} / ${t('sub2api.dashboard.cache')}: ${tokens(num(cacheCreate) + num(cacheRead))}`;
  const primaryCards = [
    { label: t('sub2api.dashboard.balance'), value: money(profile.balance), hint: t('sub2api.dashboard.available') },
    { label: t('sub2api.dashboard.todayRequests'), value: String(num(stats.today_requests)), hint: `${t('sub2api.dashboard.total')}: ${num(stats.total_requests).toLocaleString()}` },
    { label: t('sub2api.dashboard.todayCost'), value: money(stats.today_actual_cost ?? stats.today_cost, 4), hint: `${t('sub2api.dashboard.total')}: ${money(stats.total_actual_cost ?? stats.total_cost, 4)}` },
  ];
  const tokenCards = [
    { label: t('sub2api.dashboard.todayTokens'), value: tokens(stats.today_tokens), hint: tokenHint(stats.today_input_tokens, stats.today_output_tokens, stats.today_cache_creation_tokens, stats.today_cache_read_tokens) },
    { label: t('sub2api.dashboard.totalTokens'), value: tokens(stats.total_tokens), hint: tokenHint(stats.total_input_tokens, stats.total_output_tokens, stats.total_cache_creation_tokens, stats.total_cache_read_tokens) },
  ];

  if (loading && !Object.keys(stats).length && !Object.keys(profile).length) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label={t('sub2api.refresh')}><LoaderIcon className="h-8 w-8 animate-spin text-[var(--ink-muted)]" /></div>;
  }

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="text-sm text-[var(--error)]">{error}</p>}
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {primaryCards.map(card => <StatCard key={card.label} {...card} />)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {tokenCards.map(card => <StatCard key={card.label} {...card} />)}
        </div>
      </div>
      <section className="rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--ink)]">{t('sub2api.dashboard.timeRange')}:</span>
            <DateRangePicker startDate={startDate} endDate={endDate} onChange={range => { setStartDate(range.start); setEndDate(range.end); }} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--ink)]">{t('sub2api.dashboard.granularity')}:</span>
            <div className="relative w-28">
              <select
                value={granularity}
                onChange={event => setGranularity(event.target.value === 'hour' ? 'hour' : 'day')}
                className="w-full appearance-none rounded-lg border border-[var(--line)] bg-[var(--paper-elevated)] px-3 py-2 pr-8 text-sm font-medium text-[var(--ink)] outline-none hover:border-[var(--ink-muted)] focus:border-[var(--focus-border)] focus:ring-2 focus:ring-[var(--focus-border)]/30"
              >
                <option value="day">{t('sub2api.dashboard.day')}</option>
                <option value="hour">{t('sub2api.dashboard.hour')}</option>
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
            </div>
          </div>
        </div>
      </section>
      <div className="space-y-5">
        <ModelDistribution models={models} />
        <TokenTrend trend={trend} />
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <section className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-4">
      <p className="text-xs font-medium text-[var(--ink-muted)]">{label}</p>
      <p className="mt-2 text-xl font-semibold text-[var(--ink)]">{value}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{hint}</p>
    </section>
  );
}

function ModelDistribution({ models }: { models: ModelRow[] }) {
  const { t } = useTranslation('app');
  const config = useMemo<ChartConfiguration<'doughnut'>>(() => ({
    type: 'doughnut',
    data: {
      labels: models.map(item => item.model),
      datasets: [{ data: models.map(item => item.total_tokens), backgroundColor: COLORS, borderWidth: 0 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: item => `${item.label}: ${formatChartTokens(Number(item.parsed))} tokens`,
          },
        },
      },
    },
  }), [models]);
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-4">
      <h3 className="mb-4 text-sm font-semibold text-[var(--ink)]">{t('sub2api.dashboard.modelDistribution')}</h3>
      {models.length === 0 ? <div className="flex h-48 items-center justify-center text-sm text-[var(--ink-muted)]">{t('sub2api.dashboard.noData')}</div> : (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
          <div className="h-48 w-48 shrink-0"><ChartView config={config} /></div>
          <div className="max-h-48 w-full min-w-0 flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--ink-muted)]">
                  <th className="pb-2 text-left font-medium">{t('sub2api.dashboard.model')}</th>
                  <th className="pb-2 text-right font-medium">{t('sub2api.dashboard.requests')}</th>
                  <th className="pb-2 text-right font-medium">{t('sub2api.dashboard.tokens')}</th>
                  <th className="pb-2 text-right font-medium">{t('sub2api.dashboard.actual')}</th>
                  <th className="pb-2 text-right font-medium">{t('sub2api.dashboard.standard')}</th>
                </tr>
              </thead>
              <tbody>
                {models.map(item => (
                  <tr key={item.model} className="border-t border-[var(--line-subtle)]">
                    <td className="max-w-[100px] truncate py-1.5 font-medium text-[var(--ink)]" title={item.model}>{item.model}</td>
                    <td className="py-1.5 text-right text-[var(--ink-muted)]">{item.requests.toLocaleString()}</td>
                    <td className="py-1.5 text-right text-[var(--ink-muted)]">{tokens(item.total_tokens)}</td>
                    <td className="py-1.5 text-right text-emerald-600">${formatChartCost(item.actual_cost)}</td>
                    <td className="py-1.5 text-right text-[var(--ink-muted)]">${formatChartCost(item.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function TokenTrend({ trend }: { trend: TrendPoint[] }) {
  const { t } = useTranslation('app');
  const config = useMemo<ChartConfiguration<'line'>>(() => {
    const colors = themeColors();
    return {
      type: 'line',
      data: {
        labels: trend.map(item => item.date),
        datasets: [
          { label: t('sub2api.dashboard.input'), data: trend.map(item => item.input_tokens), borderColor: '#3b82f6', backgroundColor: '#3b82f620', fill: true, tension: 0.3 },
          { label: t('sub2api.dashboard.output'), data: trend.map(item => item.output_tokens), borderColor: '#10b981', backgroundColor: '#10b98120', fill: true, tension: 0.3 },
          { label: t('sub2api.dashboard.cacheCreation'), data: trend.map(item => item.cache_creation_tokens), borderColor: '#f59e0b', backgroundColor: '#f59e0b20', fill: true, tension: 0.3 },
          { label: t('sub2api.dashboard.cacheRead'), data: trend.map(item => item.cache_read_tokens), borderColor: '#06b6d4', backgroundColor: '#06b6d420', fill: true, tension: 0.3 },
          {
            label: t('sub2api.dashboard.cacheHitRate'),
            data: trend.map(item => {
              const prompt = item.input_tokens + item.cache_read_tokens + item.cache_creation_tokens;
              return prompt > 0 ? (item.cache_read_tokens / prompt) * 100 : 0;
            }),
            borderColor: '#8b5cf6',
            backgroundColor: '#8b5cf620',
            borderDash: [5, 5],
            fill: false,
            tension: 0.3,
            yAxisID: 'yPercent',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: colors.text, usePointStyle: true, pointStyle: 'circle', padding: 15, font: { size: 11 } },
          },
          tooltip: {
            callbacks: {
              label: item => item.dataset.yAxisID === 'yPercent'
                ? `${item.dataset.label}: ${Number(item.raw).toFixed(1)}%`
                : `${item.dataset.label}: ${formatChartTokens(Number(item.raw))}`,
              footer: items => {
                const point = trend[items[0]?.dataIndex ?? -1];
                return point ? `${t('sub2api.dashboard.actual')}: $${formatChartCost(point.actual_cost)} | ${t('sub2api.dashboard.standard')}: $${formatChartCost(point.cost)}` : '';
              },
            },
          },
        },
        scales: {
          x: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 10 } } },
          y: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 10 }, callback: value => formatChartTokens(Number(value)) } },
          yPercent: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { color: '#8b5cf6', font: { size: 10 }, callback: value => `${value}%` } },
        },
      },
    };
  }, [t, trend]);
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-4">
      <h3 className="mb-4 text-sm font-semibold text-[var(--ink)]">{t('sub2api.dashboard.tokenTrend')}</h3>
      {trend.length === 0
        ? <div className="flex h-48 items-center justify-center text-sm text-[var(--ink-muted)]">{t('sub2api.dashboard.noData')}</div>
        : <div className="h-48"><ChartView config={config} /></div>}
    </section>
  );
}
