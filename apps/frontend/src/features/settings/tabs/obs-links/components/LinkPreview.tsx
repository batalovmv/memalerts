import { useTranslation } from 'react-i18next';

import type { OverlayPreviewState } from '../hooks/useOverlayPreview';

import { HelpTooltip } from '@/shared/ui';

type LinkPreviewProps = {
  overlayToken: string;
  preview: OverlayPreviewState;
};

export function LinkPreview({ overlayToken, preview }: LinkPreviewProps) {
  const { t } = useTranslation();
  const {
    previewMemes,
    loadingPreview,
    previewInitialized,
    previewLoopEnabled,
    setPreviewLoopEnabled,
    previewBg,
    setPreviewBg,
    previewSeed,
    setPreviewPosSeed,
    previewIframeRef,
    activePreviewBaseUrl,
    schedulePostPreviewParams,
    fetchPreviewMemes,
    previewCount,
  } = preview;

  return (
    <div className="pt-2">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t('admin.obsOverlayLivePreview')}
        </div>
        <HelpTooltip
          content={t('help.settings.obs.previewNext', {
            defaultValue: 'Load a new random meme for preview (does not affect your real overlay).',
          })}
        >
          <button
            type="button"
            className="glass-btn p-2 shrink-0"
            disabled={loadingPreview || !overlayToken}
            onClick={() => {
              const next = previewSeed >= 1000000000 ? 1 : previewSeed + 1;
              void fetchPreviewMemes(previewCount, next, { commitSeed: true });
            }}
            aria-label={t('admin.obsPreviewNextMeme')}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h11" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5-5 5" />
            </svg>
          </button>
        </HelpTooltip>
        <HelpTooltip content={t('help.settings.obs.previewLoop', { defaultValue: 'Loop preview: when on, the same preview memes repeat.' })}>
          <button
            type="button"
            className={`glass-btn p-2 shrink-0 ${previewLoopEnabled ? 'ring-2 ring-primary/40' : ''}`}
            aria-label={t('admin.obsPreviewLoop', { defaultValue: 'Loop' })}
            onClick={() => setPreviewLoopEnabled((p) => !p)}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 1l4 4-4 4" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 11V9a4 4 0 014-4h14" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 23l-4-4 4-4" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13v2a4 4 0 01-4 4H3" />
            </svg>
          </button>
        </HelpTooltip>
        <HelpTooltip content={t('help.settings.obs.previewShufflePositions', { defaultValue: 'Shuffle positions in preview (useful to test layout).' })}>
          <button
            type="button"
            className="glass-btn p-2 shrink-0"
            aria-label={t('admin.obsPreviewShufflePositions', { defaultValue: 'Shuffle positions' })}
            onClick={() => setPreviewPosSeed((s) => (s >= 1000000000 ? 1 : s + 1))}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 3h5v5" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 20l6-6" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l6-7" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 21h5v-5" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4l6 6" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 14l6 7" />
            </svg>
          </button>
        </HelpTooltip>
        <HelpTooltip content={t('help.settings.obs.previewBackground', { defaultValue: 'Switch preview background (dark/white) to see how it looks in OBS.' })}>
          <button
            type="button"
            className={`glass-btn p-2 shrink-0 ${previewBg === 'white' ? 'ring-2 ring-primary/40' : ''}`}
            aria-label={t('admin.obsPreviewBackground', { defaultValue: 'Preview background' })}
            onClick={() => setPreviewBg((b) => (b === 'twitch' ? 'white' : 'twitch'))}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11l2 2 4-4 6 6" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.5 9.5h.01" />
            </svg>
          </button>
        </HelpTooltip>
      </div>
      <div className="rounded-2xl overflow-hidden border border-white/20 dark:border-white/10 bg-black/40">
        {!previewInitialized ? (
          <div className="w-full flex items-center justify-center text-sm text-white/70" style={{ aspectRatio: '16 / 9' }}>
            {t('common.loading', { defaultValue: 'Loading:' })}
          </div>
        ) : (
          <iframe
            ref={previewIframeRef}
            aria-label={t('help.settings.obs.previewFrame', { defaultValue: 'Overlay preview frame' })}
            src={activePreviewBaseUrl}
            className="w-full"
            style={{ aspectRatio: '16 / 9', border: '0' }}
            allow="autoplay"
            onLoad={() => {
              schedulePostPreviewParams({ immediate: true });
              window.setTimeout(() => schedulePostPreviewParams({ immediate: true }), 50);
              window.setTimeout(() => schedulePostPreviewParams({ immediate: true }), 250);
            }}
          />
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-xs text-gray-600 dark:text-gray-300 min-w-0">
          {previewMemes?.[0]?.title ? (
            <span className="truncate block">
              {t('admin.obsOverlayPreviewMeme', { defaultValue: 'Preview meme' })}:{' '}
              <span className="font-mono">{previewMemes[0].title}</span>
            </span>
          ) : (
            <span>
              {t('admin.obsOverlayLivePreviewHint', {
                defaultValue:
                  'Preview uses a real random meme when available. Copy the URL above into OBS when ready.',
              })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
