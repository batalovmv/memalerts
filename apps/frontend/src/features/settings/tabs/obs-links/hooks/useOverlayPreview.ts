import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toRecord } from '../types';
import type { CreditsSettingsState } from './useCreditsSettings';
import type { ObsLinkFormState } from './useObsLinkForm';
import { useOverlayPreviewMemes } from './useOverlayPreviewMemes';
import { useOverlayPreviewParams } from './useOverlayPreviewParams';

export type OverlayPreviewState = ReturnType<typeof useOverlayPreview>;

type UseOverlayPreviewOptions = {
  channelSlug: string;
  overlayKind: 'memes' | 'credits';
  overlayToken: string;
  origin: string;
  apiOrigin: string;
  overlayForm: ObsLinkFormState;
  creditsSettings: CreditsSettingsState;
};

export function useOverlayPreview({
  channelSlug,
  overlayKind,
  overlayToken,
  origin,
  apiOrigin,
  overlayForm,
  creditsSettings,
}: UseOverlayPreviewOptions) {
  const { i18n } = useTranslation();
  const [previewLoopEnabled, setPreviewLoopEnabled] = useState(true);
  const [previewBg, setPreviewBg] = useState<'twitch' | 'white'>('twitch');
  const [previewPosSeed, setPreviewPosSeed] = useState(1);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [previewLockPositions, setPreviewLockPositions] = useState(false);
  const [previewShowSafeGuide, setPreviewShowSafeGuide] = useState(false);
  const safeGuideTimerRef = useRef<number | null>(null);

  const { overlayMode, overlayMaxConcurrent } = overlayForm;
  const {
    previewMemes,
    loadingPreview,
    previewInitialized,
    previewSeed,
    setPreviewSeed,
    previewCount,
    fetchPreviewMemes,
  } = useOverlayPreviewMemes({ channelSlug, overlayMode, overlayMaxConcurrent });

  useEffect(() => {
    if (previewPosSeed < 0 || previewPosSeed > 1000000000) setPreviewPosSeed(1);
  }, [previewPosSeed]);

  const { activePreviewBaseUrl, activePreviewParams } = useOverlayPreviewParams({
    overlayKind,
    overlayToken,
    origin,
    apiOrigin,
    previewMemes,
    previewCount,
    previewSeed,
    previewPosSeed,
    previewBg,
    previewLockPositions,
    previewShowSafeGuide,
    previewLoopEnabled,
    overlayForm,
    creditsSettings,
    i18nLanguage: i18n.language,
  });

  const latestPreviewParamsRef = useRef<Record<string, string>>(activePreviewParams);
  useEffect(() => {
    latestPreviewParamsRef.current = activePreviewParams;
  }, [activePreviewParams]);

  const postPreviewParamsNow = useCallback((params?: Record<string, string>) => {
    const win = previewIframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(
        { type: 'memalerts:overlayParams', params: params ?? latestPreviewParamsRef.current },
        window.location.origin
      );
    } catch {
      // ignore
    }
  }, []);

  const previewPostTimerRef = useRef<number | null>(null);
  const previewPostLastAtRef = useRef<number>(0);
  const schedulePostPreviewParams = useCallback(
    (opts?: { immediate?: boolean }) => {
      const immediate = Boolean(opts?.immediate);
      if (previewPostTimerRef.current) {
        window.clearTimeout(previewPostTimerRef.current);
        previewPostTimerRef.current = null;
      }

      if (immediate) {
        previewPostLastAtRef.current = Date.now();
        postPreviewParamsNow();
        return;
      }

      const now = Date.now();
      const minIntervalMs = 60;
      const wait = Math.max(0, minIntervalMs - (now - previewPostLastAtRef.current));
      previewPostTimerRef.current = window.setTimeout(() => {
        previewPostTimerRef.current = null;
        previewPostLastAtRef.current = Date.now();
        postPreviewParamsNow();
      }, wait);
    },
    [postPreviewParamsNow]
  );

  useEffect(() => {
    schedulePostPreviewParams();
    return () => {
      if (previewPostTimerRef.current) {
        window.clearTimeout(previewPostTimerRef.current);
        previewPostTimerRef.current = null;
      }
    };
  }, [activePreviewParams, schedulePostPreviewParams]);

  const flashSafeGuide = useCallback(() => {
    setPreviewShowSafeGuide(true);
    if (safeGuideTimerRef.current) window.clearTimeout(safeGuideTimerRef.current);
    safeGuideTimerRef.current = window.setTimeout(() => {
      safeGuideTimerRef.current = null;
      setPreviewShowSafeGuide(false);
    }, 900);
  }, []);

  const onPreviewMessageRef = useRef<(event: MessageEvent) => void>(() => undefined);
  useEffect(() => {
    onPreviewMessageRef.current = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== previewIframeRef.current?.contentWindow) return;
      const data = toRecord(event.data);
      if (!data) return;
      if (data.type !== 'memalerts:overlayReady') return;
      schedulePostPreviewParams({ immediate: true });
    };
  }, [schedulePostPreviewParams]);

  useEffect(() => {
    const handler = (event: MessageEvent) => onPreviewMessageRef.current(event);
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return {
    previewMemes,
    loadingPreview,
    previewInitialized,
    previewLoopEnabled,
    setPreviewLoopEnabled,
    previewBg,
    setPreviewBg,
    previewSeed,
    setPreviewSeed,
    previewPosSeed,
    setPreviewPosSeed,
    previewLockPositions,
    setPreviewLockPositions,
    previewShowSafeGuide,
    flashSafeGuide,
    previewIframeRef,
    activePreviewBaseUrl,
    schedulePostPreviewParams,
    fetchPreviewMemes,
    previewCount,
  };
}
