import { useMemo } from 'react';

import type { PreviewMeme } from '../types';
import type { ObsLinkFormState } from './useObsLinkForm';

type UseOverlayPreviewParamsOptions = {
  overlayToken: string;
  origin: string;
  previewMemes: PreviewMeme[];
  previewCount: number;
  previewSeed: number;
  previewPosSeed: number;
  previewBg: 'twitch' | 'white';
  previewLockPositions: boolean;
  previewShowSafeGuide: boolean;
  previewLoopEnabled: boolean;
  overlayForm: ObsLinkFormState;
};

export type OverlayPreviewParamsState = ReturnType<typeof useOverlayPreviewParams>;

export function useOverlayPreviewParams({
  overlayToken,
  origin,
  previewMemes,
  previewCount,
  previewSeed,
  previewPosSeed,
  previewBg,
  previewLockPositions,
  previewShowSafeGuide,
  previewLoopEnabled,
  overlayForm,
}: UseOverlayPreviewParamsOptions) {
  const {
    overlayMode,
    overlayShowSender,
    urlPosition,
    urlVolume,
    scaleMode,
    scaleFixed,
    scaleMin,
    scaleMax,
    safePad,
    urlAnim,
    urlEnterMs,
    urlExitMs,
    urlRadius,
    shadowBlur,
    shadowSpread,
    shadowDistance,
    shadowAngle,
    shadowOpacity,
    shadowColor,
    glassEnabled,
    glassPreset,
    glassTintColor,
    glassTintStrength,
    urlBlur,
    urlBorder,
    borderPreset,
    borderTintColor,
    borderTintStrength,
    borderMode,
    urlBorderColor,
    urlBorderColor2,
    urlBorderGradientAngle,
    urlBgOpacity,
    senderHoldMs,
    senderBgColor,
    senderBgOpacity,
    senderBgRadius,
    senderStroke,
    senderStrokeWidth,
    senderStrokeOpacity,
    senderStrokeColor,
    animEasingPreset,
    animEasingX1,
    animEasingY1,
    animEasingX2,
    animEasingY2,
    senderFontSize,
    senderFontWeight,
    senderFontFamily,
    senderFontColor,
  } = overlayForm;

  const overlayUrl = overlayToken ? `${origin}/overlay/t/${overlayToken}` : '';

  const overlayPreviewBaseUrl = useMemo(() => {
    if (!overlayUrl) return '';
    const u = new URL(overlayUrl);
    u.searchParams.set('demo', '1');
    return u.toString();
  }, [overlayUrl]);

  const overlayPreviewParams = useMemo(() => {
    const target = Math.min(5, Math.max(1, previewCount));
    const pool = previewMemes.length > 0 ? previewMemes : [];
    const urls: string[] = [];
    const types: string[] = [];
    for (let i = 0; i < target; i++) {
      const m = pool[i % Math.max(1, pool.length)];
      if (m?.fileUrl) urls.push(m.fileUrl);
      if (m?.type) types.push(m.type);
    }

    const params: Record<string, string> = {
      demo: '1',
      seed: String(previewSeed),
      posSeed: String(previewPosSeed),
      previewBg,
      position: urlPosition,
      safePad: String(safePad),
      lockPos: previewLockPositions ? '1' : '0',
      showSafeGuide: previewShowSafeGuide ? '1' : '0',
      previewCount: String(previewCount),
      previewMode: overlayMode,
      repeat: previewLoopEnabled ? '1' : '0',
      previewUrls: JSON.stringify(urls),
      previewTypes: JSON.stringify(types),
      volume: String(urlVolume),
      anim: urlAnim,
      enterMs: String(urlEnterMs),
      exitMs: String(urlExitMs),
      radius: String(urlRadius),
      shadowBlur: String(shadowBlur),
      shadowSpread: String(shadowSpread),
      shadowDistance: String(shadowDistance),
      shadowAngle: String(shadowAngle),
      shadowOpacity: String(shadowOpacity),
      shadowColor: String(shadowColor),
      glass: glassEnabled ? '1' : '0',
      glassPreset,
      glassTintColor: String(glassTintColor),
      glassTintStrength: String(glassTintStrength),
      blur: String(urlBlur),
      border: String(urlBorder),
      borderPreset,
      borderTintColor: String(borderTintColor),
      borderTintStrength: String(borderTintStrength),
      borderMode,
      borderColor: String(urlBorderColor),
      borderColor2: String(urlBorderColor2),
      borderGradientAngle: String(urlBorderGradientAngle),
      bgOpacity: String(urlBgOpacity),
      senderHoldMs: String(senderHoldMs),
      senderBgColor: String(senderBgColor),
      senderBgOpacity: String(senderBgOpacity),
      senderBgRadius: String(senderBgRadius),
      senderStroke,
      senderStrokeWidth: String(senderStrokeWidth),
      senderStrokeOpacity: String(senderStrokeOpacity),
      senderStrokeColor: String(senderStrokeColor),
      easing: animEasingPreset,
      easingX1: String(animEasingX1),
      easingY1: String(animEasingY1),
      easingX2: String(animEasingX2),
      easingY2: String(animEasingY2),
      showSender: overlayShowSender ? '1' : '0',
      senderFontSize: String(senderFontSize),
      senderFontWeight: String(senderFontWeight),
      senderFontFamily: String(senderFontFamily),
      senderFontColor: String(senderFontColor),
      scaleMode,
    };
    if (scaleMode === 'fixed') {
      params.scaleFixed = String(scaleFixed);
      params.scale = String(scaleFixed);
    } else {
      params.scaleMin = String(scaleMin);
      params.scaleMax = String(scaleMax);
    }
    return params;
  }, [
    animEasingPreset,
    animEasingX1,
    animEasingX2,
    animEasingY1,
    animEasingY2,
    borderMode,
    borderPreset,
    borderTintColor,
    borderTintStrength,
    glassEnabled,
    glassPreset,
    glassTintColor,
    glassTintStrength,
    overlayMode,
    overlayShowSender,
    previewBg,
    previewCount,
    previewLockPositions,
    previewLoopEnabled,
    previewMemes,
    previewPosSeed,
    previewSeed,
    previewShowSafeGuide,
    safePad,
    scaleFixed,
    scaleMax,
    scaleMin,
    scaleMode,
    senderBgColor,
    senderBgOpacity,
    senderBgRadius,
    senderStroke,
    senderStrokeColor,
    senderStrokeOpacity,
    senderStrokeWidth,
    senderFontColor,
    senderFontFamily,
    senderFontSize,
    senderFontWeight,
    senderHoldMs,
    shadowAngle,
    shadowBlur,
    shadowColor,
    shadowDistance,
    shadowOpacity,
    shadowSpread,
    urlAnim,
    urlBgOpacity,
    urlBlur,
    urlBorder,
    urlBorderColor,
    urlBorderColor2,
    urlBorderGradientAngle,
    urlEnterMs,
    urlExitMs,
    urlPosition,
    urlRadius,
    urlVolume,
  ]);

  return {
    activePreviewBaseUrl: overlayPreviewBaseUrl,
    activePreviewParams: overlayPreviewParams,
  };
}
