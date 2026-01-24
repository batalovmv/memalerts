import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Meme } from '@/types';

import { getMemePrimaryId } from '@/shared/lib/memeIds';
import MemeCard from '@/widgets/meme-card/MemeCard';

type PersonalizedMemesSectionProps = {
  memes: Meme[];
  loading: boolean;
  profileReady: boolean;
  totalActivations: number;
  mode: 'personalized' | 'fallback';
  autoplayMemesEnabled: boolean;
  onSelectMeme: (meme: Meme) => void;
};

const MIN_ACTIVATIONS = 5;

export function PersonalizedMemesSection({
  memes,
  loading,
  profileReady,
  totalActivations,
  mode,
  autoplayMemesEnabled,
  onSelectMeme,
}: PersonalizedMemesSectionProps) {
  const { t } = useTranslation();
  const remaining = useMemo(() => Math.max(0, MIN_ACTIVATIONS - totalActivations), [totalActivations]);

  const hint = profileReady
    ? t('profile.forYouHint', { defaultValue: 'Personal picks based on your activations.' })
    : t('profile.forYouHintLocked', {
        defaultValue: 'Make {{count}} more activations to unlock personalization.',
        count: remaining,
      });

  return (
    <section className="mt-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('profile.forYouTitle', { defaultValue: 'For you' })}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">{hint}</p>
        </div>
        {mode === 'fallback' && !profileReady ? (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {t('profile.forYouFallback', { defaultValue: 'Showing fresh memes while we learn your taste.' })}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="w-56 shrink-0 rounded-xl bg-gray-200/80 dark:bg-gray-700/60 animate-pulse aspect-video" />
          ))}
        </div>
      ) : memes.length === 0 ? (
        <div className="surface p-4 text-sm text-gray-600 dark:text-gray-300">
          {t('profile.forYouEmpty', { defaultValue: 'No picks yet. Try activating a few memes.' })}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
          {memes.map((meme) => (
            <div key={getMemePrimaryId(meme)} className="w-56 shrink-0 snap-start">
              <MemeCard
                meme={meme}
                onClick={() => onSelectMeme(meme)}
                previewMode={autoplayMemesEnabled ? 'autoplayMuted' : 'hoverMuted'}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
