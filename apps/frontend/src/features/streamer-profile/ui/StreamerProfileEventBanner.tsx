import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Event } from '@memalerts/api-contracts';

import { Button } from '@/shared/ui';

type StreamerProfileEventBannerProps = {
  events: Event[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
};

function formatDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}

export function StreamerProfileEventBanner({ events, loading, error, onReload }: StreamerProfileEventBannerProps) {
  const { t } = useTranslation();
  const event = events[0];

  const dateRange = useMemo(() => {
    if (!event) return '';
    const start = formatDate(event.startsAt);
    const end = formatDate(event.endsAt);
    if (start && end) return `${start} — ${end}`;
    return start || end || '';
  }, [event]);

  if (!event && !loading && !error) return null;

  const accent = event?.theme?.accentColor || '#38bdf8';
  const backgroundUrl = event?.theme?.backgroundUrl || null;

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/70 dark:bg-white/5 p-4"
      style={{
        backgroundImage: backgroundUrl
          ? `linear-gradient(135deg, rgba(0,0,0,0.35), rgba(0,0,0,0.1)), url(${backgroundUrl})`
          : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background:
            backgroundUrl
              ? undefined
              : `radial-gradient(120% 120% at 0% 0%, ${accent}33 0%, transparent 60%), radial-gradient(120% 120% at 100% 100%, ${accent}22 0%, transparent 55%)`,
        }}
      />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-gray-600 dark:text-gray-300">
            {t('events.title', { defaultValue: 'Event' })}
          </div>
          {loading ? (
            <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
              {t('events.loading', { defaultValue: 'Loading event…' })}
            </div>
          ) : error ? (
            <div className="mt-1 text-sm text-red-500">{error}</div>
          ) : event ? (
            <>
              <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{event.title}</div>
              {event.description ? (
                <div className="mt-1 text-sm text-gray-700 dark:text-gray-200 max-w-3xl">{event.description}</div>
              ) : null}
              {dateRange ? (
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">{dateRange}</div>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onReload} disabled={loading}>
            {t('events.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </div>
      </div>
    </section>
  );
}
