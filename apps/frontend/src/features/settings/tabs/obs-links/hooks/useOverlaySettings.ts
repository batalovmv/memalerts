import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { SenderFontFamily, UrlAnim, UrlPosition } from '../types';
import { getNumber, isSenderFontFamily, isUrlAnim, isUrlPosition, toRecord } from '../types';
import type { ObsLinkFormState } from './useObsLinkForm';

import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

export type OverlaySettingsState = ReturnType<typeof useOverlaySettings>;

export function useOverlaySettings(channelSlug: string, form: ObsLinkFormState) {
  const { t } = useTranslation();
  const {
    overlayMode,
    setOverlayMode,
    overlayShowSender,
    setOverlayShowSender,
    overlayMaxConcurrent,
    setOverlayMaxConcurrent,
    urlPosition,
    setUrlPosition,
    urlVolume,
    setUrlVolume,
    scaleMode,
    setScaleMode,
    scaleFixed,
    setScaleFixed,
    scaleMin,
    setScaleMin,
    scaleMax,
    setScaleMax,
    safePad,
    setSafePad,
    urlRadius,
    setUrlRadius,
    shadowBlur,
    setShadowBlur,
    shadowSpread,
    setShadowSpread,
    shadowDistance,
    setShadowDistance,
    shadowAngle,
    setShadowAngle,
    shadowOpacity,
    setShadowOpacity,
    shadowColor,
    setShadowColor,
    urlBlur,
    setUrlBlur,
    urlBorder,
    setUrlBorder,
    borderPreset,
    setBorderPreset,
    borderTintColor,
    setBorderTintColor,
    borderTintStrength,
    setBorderTintStrength,
    borderMode,
    setBorderMode,
    urlBorderColor,
    setUrlBorderColor,
    urlBorderColor2,
    setUrlBorderColor2,
    urlBorderGradientAngle,
    setUrlBorderGradientAngle,
    urlBgOpacity,
    setUrlBgOpacity,
    urlAnim,
    setUrlAnim,
    urlEnterMs,
    setUrlEnterMs,
    urlExitMs,
    setUrlExitMs,
    animEasingPreset,
    setAnimEasingPreset,
    animEasingX1,
    setAnimEasingX1,
    animEasingY1,
    setAnimEasingY1,
    animEasingX2,
    setAnimEasingX2,
    animEasingY2,
    setAnimEasingY2,
    senderFontSize,
    setSenderFontSize,
    senderFontWeight,
    setSenderFontWeight,
    senderFontFamily,
    setSenderFontFamily,
    senderFontColor,
    setSenderFontColor,
    senderHoldMs,
    setSenderHoldMs,
    senderBgColor,
    setSenderBgColor,
    senderBgOpacity,
    setSenderBgOpacity,
    senderBgRadius,
    setSenderBgRadius,
    senderStroke,
    setSenderStroke,
    senderStrokeWidth,
    setSenderStrokeWidth,
    senderStrokeOpacity,
    setSenderStrokeOpacity,
    senderStrokeColor,
    setSenderStrokeColor,
    glassEnabled,
    setGlassEnabled,
    glassPreset,
    setGlassPreset,
    glassTintColor,
    setGlassTintColor,
    glassTintStrength,
    setGlassTintStrength,
    overlayStyleJson,
    overlaySettingsPayload,
  } = form;

  const [overlayToken, setOverlayToken] = useState('');
  const [loadingToken, setLoadingToken] = useState(false);
  const [loadingOverlaySettings, setLoadingOverlaySettings] = useState(false);
  const [savingOverlaySettings, setSavingOverlaySettings] = useState(false);
  const [overlaySettingsSavedPulse, setOverlaySettingsSavedPulse] = useState(false);
  const [rotatingOverlayToken, setRotatingOverlayToken] = useState(false);
  const overlaySettingsLoadedRef = useRef<string | null>(null);
  const [lastSavedOverlaySettingsPayload, setLastSavedOverlaySettingsPayload] = useState<string | null>(null);

  useEffect(() => {
    if (!channelSlug) return;
    let mounted = true;
    (async () => {
      try {
        setLoadingToken(true);
        setLoadingOverlaySettings(true);
        const { api } = await import('@/lib/api');
        const resp = await api.get<{ token: string; overlayMode?: string; overlayShowSender?: boolean; overlayMaxConcurrent?: number; overlayStyleJson?: string | null }>(
          '/streamer/overlay/token'
        );
        if (!mounted) return;
        setOverlayToken(resp.token || '');

        const nextMode = resp.overlayMode === 'simultaneous' ? 'simultaneous' : 'queue';
        const nextShowSender = Boolean(resp.overlayShowSender);
        const nextMax = typeof resp.overlayMaxConcurrent === 'number' ? Math.min(5, Math.max(1, resp.overlayMaxConcurrent)) : 3;

        setOverlayMode(nextMode);
        setOverlayShowSender(nextShowSender);
        setOverlayMaxConcurrent(nextMax);

        // Hydrate advanced style if present
        let styleFromServer: Record<string, unknown> | null = null;
        if (resp.overlayStyleJson) {
          try {
            const j: unknown = JSON.parse(resp.overlayStyleJson);
            styleFromServer = toRecord(j);
          } catch {
            styleFromServer = null;
          }
        }

        const nextPosition: UrlPosition =
          typeof styleFromServer?.position === 'string' && isUrlPosition(styleFromServer.position) ? styleFromServer.position : urlPosition;
        const nextVolume = typeof styleFromServer?.volume === 'number' ? styleFromServer.volume : urlVolume;
        const nextScaleMode: 'fixed' | 'range' = styleFromServer?.scaleMode === 'range' ? 'range' : 'fixed';
        const nextScaleFixed = typeof styleFromServer?.scaleFixed === 'number' ? styleFromServer.scaleFixed : scaleFixed;
        const nextScaleMin = typeof styleFromServer?.scaleMin === 'number' ? styleFromServer.scaleMin : scaleMin;
        const nextScaleMax = typeof styleFromServer?.scaleMax === 'number' ? styleFromServer.scaleMax : scaleMax;
        const nextSafePad = getNumber(styleFromServer, 'safePad') ?? getNumber(styleFromServer, 'safePadPx') ?? safePad;
        const nextRadius = typeof styleFromServer?.radius === 'number' ? styleFromServer.radius : urlRadius;
        const nextShadowBlur = typeof styleFromServer?.shadowBlur === 'number'
          ? styleFromServer.shadowBlur
          : typeof styleFromServer?.shadow === 'number'
            ? styleFromServer.shadow
            : shadowBlur;
        const nextShadowSpread = typeof styleFromServer?.shadowSpread === 'number' ? styleFromServer.shadowSpread : shadowSpread;
        const nextShadowDistance = typeof styleFromServer?.shadowDistance === 'number' ? styleFromServer.shadowDistance : shadowDistance;
        const nextShadowAngle = typeof styleFromServer?.shadowAngle === 'number' ? styleFromServer.shadowAngle : shadowAngle;
        const nextShadowOpacity = typeof styleFromServer?.shadowOpacity === 'number' ? styleFromServer.shadowOpacity : shadowOpacity;
        const nextShadowColor = typeof styleFromServer?.shadowColor === 'string' ? styleFromServer.shadowColor : shadowColor;
        const nextBlur = typeof styleFromServer?.blur === 'number' ? styleFromServer.blur : urlBlur;
        const nextBorder = typeof styleFromServer?.border === 'number' ? styleFromServer.border : urlBorder;
        const nextBorderPreset: 'custom' | 'glass' | 'glow' | 'frosted' =
          styleFromServer?.borderPreset === 'glass'
            ? 'glass'
            : styleFromServer?.borderPreset === 'glow'
              ? 'glow'
              : styleFromServer?.borderPreset === 'frosted'
                ? 'frosted'
                : 'custom';
        const nextBorderTintColor = typeof styleFromServer?.borderTintColor === 'string' ? styleFromServer.borderTintColor : borderTintColor;
        const nextBorderTintStrength =
          typeof styleFromServer?.borderTintStrength === 'number' ? styleFromServer.borderTintStrength : borderTintStrength;
        const nextBorderMode: 'solid' | 'gradient' = styleFromServer?.borderMode === 'gradient' ? 'gradient' : 'solid';
        const nextBorderColor = typeof styleFromServer?.borderColor === 'string' ? styleFromServer.borderColor : urlBorderColor;
        const nextBorderColor2 = typeof styleFromServer?.borderColor2 === 'string' ? styleFromServer.borderColor2 : urlBorderColor2;
        const nextBorderGradientAngle = typeof styleFromServer?.borderGradientAngle === 'number'
          ? styleFromServer.borderGradientAngle
          : urlBorderGradientAngle;
        const nextBgOpacity = typeof styleFromServer?.bgOpacity === 'number' ? styleFromServer.bgOpacity : urlBgOpacity;
        const nextAnim: UrlAnim = typeof styleFromServer?.anim === 'string' && isUrlAnim(styleFromServer.anim) ? styleFromServer.anim : urlAnim;
        const nextEnterMs = typeof styleFromServer?.enterMs === 'number' ? styleFromServer.enterMs : urlEnterMs;
        const nextExitMs = typeof styleFromServer?.exitMs === 'number' ? styleFromServer.exitMs : urlExitMs;
        const nextEasingPreset: 'ios' | 'smooth' | 'snappy' | 'linear' | 'custom' =
          styleFromServer?.easing === 'custom'
            ? 'custom'
            : styleFromServer?.easing === 'smooth'
              ? 'smooth'
              : styleFromServer?.easing === 'snappy'
                ? 'snappy'
                : styleFromServer?.easing === 'linear'
                  ? 'linear'
                  : 'ios';
        const nextEasingX1 = typeof styleFromServer?.easingX1 === 'number' ? styleFromServer.easingX1 : animEasingX1;
        const nextEasingY1 = typeof styleFromServer?.easingY1 === 'number' ? styleFromServer.easingY1 : animEasingY1;
        const nextEasingX2 = typeof styleFromServer?.easingX2 === 'number' ? styleFromServer.easingX2 : animEasingX2;
        const nextEasingY2 = typeof styleFromServer?.easingY2 === 'number' ? styleFromServer.easingY2 : animEasingY2;
        const nextSenderFontSize = typeof styleFromServer?.senderFontSize === 'number' ? styleFromServer.senderFontSize : senderFontSize;
        const nextSenderFontWeight = typeof styleFromServer?.senderFontWeight === 'number' ? styleFromServer.senderFontWeight : senderFontWeight;
        const nextSenderFontFamily: SenderFontFamily =
          typeof styleFromServer?.senderFontFamily === 'string' && isSenderFontFamily(styleFromServer.senderFontFamily)
            ? styleFromServer.senderFontFamily
            : senderFontFamily;
        const nextSenderFontColor = typeof styleFromServer?.senderFontColor === 'string' ? styleFromServer.senderFontColor : senderFontColor;
        const nextSenderHoldMs = typeof styleFromServer?.senderHoldMs === 'number' ? styleFromServer.senderHoldMs : senderHoldMs;
        const nextSenderBgColor = typeof styleFromServer?.senderBgColor === 'string' ? styleFromServer.senderBgColor : senderBgColor;
        const nextSenderBgOpacity = typeof styleFromServer?.senderBgOpacity === 'number' ? styleFromServer.senderBgOpacity : senderBgOpacity;
        const nextSenderBgRadius = typeof styleFromServer?.senderBgRadius === 'number' ? styleFromServer.senderBgRadius : senderBgRadius;
        const nextSenderStroke: 'none' | 'glass' | 'solid' =
          styleFromServer?.senderStroke === 'none' ? 'none' : styleFromServer?.senderStroke === 'solid' ? 'solid' : 'glass';
        const nextSenderStrokeWidth = typeof styleFromServer?.senderStrokeWidth === 'number' ? styleFromServer.senderStrokeWidth : senderStrokeWidth;
        const nextSenderStrokeOpacity =
          typeof styleFromServer?.senderStrokeOpacity === 'number' ? styleFromServer.senderStrokeOpacity : senderStrokeOpacity;
        const nextSenderStrokeColor =
          typeof styleFromServer?.senderStrokeColor === 'string' ? styleFromServer.senderStrokeColor : senderStrokeColor;

        const nextGlassEnabled =
          typeof styleFromServer?.glass === 'boolean'
            ? styleFromServer.glass
            : typeof styleFromServer?.glass === 'number'
              ? styleFromServer.glass === 1
              : typeof styleFromServer?.glassEnabled === 'boolean'
                ? styleFromServer.glassEnabled
                : typeof styleFromServer?.glassEnabled === 'number'
                  ? styleFromServer.glassEnabled === 1
                  : nextBlur > 0 || nextBgOpacity > 0;
        const nextGlassPreset: 'ios' | 'clear' | 'prism' =
          styleFromServer?.glassPreset === 'clear' ? 'clear' : styleFromServer?.glassPreset === 'prism' ? 'prism' : 'ios';
        const nextGlassTintColor = typeof styleFromServer?.glassTintColor === 'string' ? styleFromServer.glassTintColor : glassTintColor;
        const nextGlassTintStrength =
          typeof styleFromServer?.glassTintStrength === 'number' ? styleFromServer.glassTintStrength : glassTintStrength;

        setUrlPosition(nextPosition);
        setUrlVolume(nextVolume);
        setScaleMode(nextScaleMode);
        setScaleFixed(nextScaleFixed);
        setScaleMin(nextScaleMin);
        setScaleMax(nextScaleMax);
        setSafePad(Math.max(0, Math.min(240, nextSafePad)));
        setUrlRadius(nextRadius);
        setShadowBlur(nextShadowBlur);
        setShadowSpread(nextShadowSpread);
        setShadowDistance(nextShadowDistance);
        setShadowAngle(nextShadowAngle);
        setShadowOpacity(nextShadowOpacity);
        setShadowColor(nextShadowColor);
        setUrlBlur(nextBlur);
        setUrlBorder(nextBorder);
        setBorderPreset(nextBorderPreset);
        setBorderTintColor(String(nextBorderTintColor || '#7dd3fc').toLowerCase());
        setBorderTintStrength(nextBorderTintStrength);
        setBorderMode(nextBorderMode);
        setUrlBorderColor(nextBorderColor);
        setUrlBorderColor2(nextBorderColor2);
        setUrlBorderGradientAngle(nextBorderGradientAngle);
        setUrlBgOpacity(nextBgOpacity);
        setUrlAnim(nextAnim);
        setUrlEnterMs(nextEnterMs);
        setUrlExitMs(nextExitMs);
        setAnimEasingPreset(nextEasingPreset);
        setAnimEasingX1(nextEasingX1);
        setAnimEasingY1(nextEasingY1);
        setAnimEasingX2(nextEasingX2);
        setAnimEasingY2(nextEasingY2);
        setSenderFontSize(nextSenderFontSize);
        setSenderFontWeight(nextSenderFontWeight);
        setSenderFontFamily(nextSenderFontFamily);
        setSenderFontColor(String(nextSenderFontColor || '#ffffff').toLowerCase());
        setSenderHoldMs(nextSenderHoldMs);
        setSenderBgColor(String(nextSenderBgColor || '#000000').toLowerCase());
        setSenderBgOpacity(nextSenderBgOpacity);
        setSenderBgRadius(nextSenderBgRadius);
        setSenderStroke(nextSenderStroke);
        setSenderStrokeWidth(nextSenderStrokeWidth);
        setSenderStrokeOpacity(nextSenderStrokeOpacity);
        setSenderStrokeColor(String(nextSenderStrokeColor || '#ffffff').toLowerCase());
        setGlassEnabled(Boolean(nextGlassEnabled));
        setGlassPreset(nextGlassPreset);
        setGlassTintColor(String(nextGlassTintColor || '#7dd3fc').toLowerCase());
        setGlassTintStrength(nextGlassTintStrength);

        // Establish baseline so opening the page never triggers auto-save.
        const overlayStyleJsonBaseline = JSON.stringify({
          position: nextPosition,
          volume: nextVolume,
          scaleMode: nextScaleMode,
          scaleFixed: nextScaleFixed,
          scaleMin: nextScaleMin,
          scaleMax: nextScaleMax,
          safePad: nextSafePad,
          radius: nextRadius,
          shadowBlur: nextShadowBlur,
          shadowSpread: nextShadowSpread,
          shadowDistance: nextShadowDistance,
          shadowAngle: nextShadowAngle,
          shadowOpacity: nextShadowOpacity,
          shadowColor: nextShadowColor,
          glass: Boolean(nextGlassEnabled),
          glassPreset: nextGlassPreset,
          glassTintColor: nextGlassTintColor,
          glassTintStrength: nextGlassTintStrength,
          blur: nextBlur,
          border: nextBorder,
          borderPreset: nextBorderPreset,
          borderTintColor: nextBorderTintColor,
          borderTintStrength: nextBorderTintStrength,
          borderMode: nextBorderMode,
          borderColor: nextBorderColor,
          borderColor2: nextBorderColor2,
          borderGradientAngle: nextBorderGradientAngle,
          bgOpacity: nextBgOpacity,
          anim: nextAnim,
          enterMs: nextEnterMs,
          exitMs: nextExitMs,
          easing: nextEasingPreset,
          easingX1: nextEasingX1,
          easingY1: nextEasingY1,
          easingX2: nextEasingX2,
          easingY2: nextEasingY2,
          senderFontSize: nextSenderFontSize,
          senderFontWeight: nextSenderFontWeight,
          senderFontFamily: nextSenderFontFamily,
          senderFontColor: nextSenderFontColor,
          senderHoldMs: nextSenderHoldMs,
          senderBgColor: nextSenderBgColor,
          senderBgOpacity: nextSenderBgOpacity,
          senderBgRadius: nextSenderBgRadius,
          senderStroke: nextSenderStroke,
          senderStrokeWidth: nextSenderStrokeWidth,
          senderStrokeOpacity: nextSenderStrokeOpacity,
          senderStrokeColor: nextSenderStrokeColor,
        });
        const baselinePayload = JSON.stringify({
          overlayMode: nextMode,
          overlayShowSender: nextShowSender,
          overlayMaxConcurrent: nextMax,
          overlayStyleJson: overlayStyleJsonBaseline,
        });
        setLastSavedOverlaySettingsPayload(baselinePayload);
        overlaySettingsLoadedRef.current = channelSlug;
      } catch (e) {
        if (mounted) setOverlayToken('');
      } finally {
        if (mounted) setLoadingToken(false);
        if (mounted) setLoadingOverlaySettings(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelSlug]);

  const overlaySettingsDirty = useMemo(() => {
    if (!overlaySettingsLoadedRef.current) return false;
    if (lastSavedOverlaySettingsPayload === null) return false;
    return overlaySettingsPayload !== lastSavedOverlaySettingsPayload;
  }, [lastSavedOverlaySettingsPayload, overlaySettingsPayload]);

  const handleSaveOverlaySettings = useCallback(async (): Promise<void> => {
    if (!channelSlug) return;
    if (loadingOverlaySettings) return;
    if (!overlaySettingsLoadedRef.current) return;
    if (!overlaySettingsDirty) return;
    const startedAt = Date.now();
    try {
      setSavingOverlaySettings(true);
      const { api } = await import('@/lib/api');
      await api.patch('/streamer/channel/settings', {
        overlayMode,
        overlayShowSender,
        overlayMaxConcurrent,
        overlayStyleJson,
      });
      setLastSavedOverlaySettingsPayload(overlaySettingsPayload);
      toast.success(t('admin.settingsSaved'));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave'));
    } finally {
      await ensureMinDuration(startedAt, 650);
      setSavingOverlaySettings(false);
      setOverlaySettingsSavedPulse(true);
      window.setTimeout(() => setOverlaySettingsSavedPulse(false), 700);
    }
  }, [
    channelSlug,
    loadingOverlaySettings,
    overlayMaxConcurrent,
    overlayMode,
    overlaySettingsDirty,
    overlaySettingsPayload,
    overlayShowSender,
    overlayStyleJson,
    t,
  ]);

  const handleRotateOverlayToken = useCallback(async (): Promise<void> => {
    if (!channelSlug) return;
    try {
      setRotatingOverlayToken(true);
      const { api } = await import('@/lib/api');
      const resp = await api.post<{ token: string }>('/streamer/overlay/token/rotate', {});
      setOverlayToken(resp?.token || '');
      toast.success(t('admin.obsOverlayTokenRotated', { defaultValue: 'Overlay link updated. Paste the new URL into OBS.' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save' }));
    } finally {
      setRotatingOverlayToken(false);
    }
  }, [channelSlug, t]);

  return {
    overlayToken,
    loadingToken,
    loadingOverlaySettings,
    savingOverlaySettings,
    overlaySettingsSavedPulse,
    rotatingOverlayToken,
    overlaySettingsDirty,
    handleSaveOverlaySettings,
    handleRotateOverlayToken,
  };
}
