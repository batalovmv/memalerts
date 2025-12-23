import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

export function AttemptsPill(props: { left: number; max?: number; className?: string }) {
  const { t } = useTranslation();
  const max = typeof props.max === 'number' && Number.isFinite(props.max) && props.max > 0 ? Math.floor(props.max) : 2;
  const leftRaw = typeof props.left === 'number' && Number.isFinite(props.left) ? Math.floor(props.left) : 0;
  const left = Math.max(0, Math.min(max, leftRaw));
  const used = max - left;

  const tone =
    left <= 0 ? 'danger' : left === 1 ? 'warn' : 'ok';
  const dotOn =
    tone === 'danger'
      ? 'bg-rose-500/90'
      : tone === 'warn'
        ? 'bg-amber-500/90'
        : 'bg-emerald-500/90';

  return (
    <span
      className={
        props.className ||
        'inline-flex items-center gap-2 rounded-full border border-white/25 dark:border-white/10 bg-white/55 dark:bg-white/10 px-2.5 py-1 text-xs text-gray-700 dark:text-gray-200 shadow-sm'
      }
      title={t('submissions.attemptsTooltip', {
        defaultValue: 'Attempts left: {{left}}/{{max}}',
        left,
        max,
      })}
    >
      <span className="sr-only">
        {t('submissions.attemptsTooltip', {
          defaultValue: 'Attempts left: {{left}}/{{max}}',
          left,
          max,
        })}
      </span>
      <span className="inline-flex items-center gap-1.5" aria-hidden="true">
        {Array.from({ length: max }).map((_, i) => {
          // Render "remaining" dots from left to right, like iOS page indicators.
          const active = i >= used;
          return (
            <span
              key={i}
              className={cn(
                'h-1.5 w-1.5 rounded-full transition-colors',
                active ? dotOn : 'bg-gray-300/80 dark:bg-white/15',
              )}
            />
          );
        })}
      </span>
    </span>
  );
}


