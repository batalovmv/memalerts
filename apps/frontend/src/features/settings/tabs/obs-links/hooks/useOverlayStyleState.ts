import { useCallback, useEffect, useMemo, useState } from 'react';

import { clampFloat, clampInt, isHexColor, type OverlaySharePayload } from '../../obs/lib/shareCode';

import type {
  AnimEasingPreset,
  BorderMode,
  BorderPreset,
  GlassPreset,
  SenderFontFamily,
  SenderStroke,
  UrlAnim,
  UrlPosition,
} from '../types';
export type OverlayStyleState = ReturnType<typeof useOverlayStyleState>;

export function useOverlayStyleState() {
  const [overlayMode, setOverlayMode] = useState<'queue' | 'simultaneous'>('queue');
  const [overlayShowSender, setOverlayShowSender] = useState(false);
  const [overlayMaxConcurrent, setOverlayMaxConcurrent] = useState<number>(3);

  const [advancedTab, setAdvancedTab] = useState<'layout' | 'animation' | 'shadow' | 'border' | 'glass' | 'sender'>('layout');
  const [obsUiMode, setObsUiMode] = useState<'basic' | 'pro'>('basic');

  useEffect(() => {
    if (advancedTab === 'sender' && !overlayShowSender) setAdvancedTab('layout');
  }, [advancedTab, overlayShowSender]);

  const [urlPosition, setUrlPosition] = useState<UrlPosition>('random');
  const [urlVolume, setUrlVolume] = useState<number>(1);
  const [scaleMode, setScaleMode] = useState<'fixed' | 'range'>('fixed');
  const [scaleFixed, setScaleFixed] = useState<number>(1);
  const [scaleMin, setScaleMin] = useState<number>(0.7);
  const [scaleMax, setScaleMax] = useState<number>(1);
  const [urlRadius, setUrlRadius] = useState<number>(20);
  const [urlBlur, setUrlBlur] = useState<number>(6);
  const [urlBorder, setUrlBorder] = useState<number>(2);
  const [safePad, setSafePad] = useState<number>(80);
  const [glassEnabled, setGlassEnabled] = useState<boolean>(false);
  const [glassPreset, setGlassPreset] = useState<GlassPreset>('ios');
  const [glassTintColor, setGlassTintColor] = useState<string>('#7dd3fc');
  const [glassTintStrength, setGlassTintStrength] = useState<number>(0.22);
  const [borderPreset, setBorderPreset] = useState<BorderPreset>('custom');
  const [borderTintColor, setBorderTintColor] = useState<string>('#7dd3fc');
  const [borderTintStrength, setBorderTintStrength] = useState<number>(0.35);
  const [borderMode, setBorderMode] = useState<BorderMode>('solid');
  const [urlBorderColor, setUrlBorderColor] = useState<string>('#ffffff');
  const [urlBorderColor2, setUrlBorderColor2] = useState<string>('#00e5ff');
  const [urlBorderGradientAngle, setUrlBorderGradientAngle] = useState<number>(135);
  const [shadowBlur, setShadowBlur] = useState<number>(70);
  const [shadowSpread, setShadowSpread] = useState<number>(0);
  const [shadowDistance, setShadowDistance] = useState<number>(22);
  const [shadowAngle, setShadowAngle] = useState<number>(90);
  const [shadowOpacity, setShadowOpacity] = useState<number>(0.6);
  const [shadowColor, setShadowColor] = useState<string>('#000000');
  const [urlBgOpacity, setUrlBgOpacity] = useState<number>(0.18);
  const [urlAnim, setUrlAnim] = useState<UrlAnim>('fade');
  const [animEasingPreset, setAnimEasingPreset] = useState<AnimEasingPreset>('ios');
  const [animEasingX1, setAnimEasingX1] = useState<number>(0.22);
  const [animEasingY1, setAnimEasingY1] = useState<number>(1);
  const [animEasingX2, setAnimEasingX2] = useState<number>(0.36);
  const [animEasingY2, setAnimEasingY2] = useState<number>(1);
  const [urlEnterMs, setUrlEnterMs] = useState<number>(420);
  const [urlExitMs, setUrlExitMs] = useState<number>(320);
  const [senderFontSize, setSenderFontSize] = useState<number>(13);
  const [senderFontWeight, setSenderFontWeight] = useState<number>(600);
  const [senderFontFamily, setSenderFontFamily] = useState<SenderFontFamily>('system');
  const [senderFontColor, setSenderFontColor] = useState<string>('#ffffff');
  const [senderHoldMs, setSenderHoldMs] = useState<number>(1200);
  const [senderBgColor, setSenderBgColor] = useState<string>('#000000');
  const [senderBgOpacity, setSenderBgOpacity] = useState<number>(0.62);
  const [senderBgRadius, setSenderBgRadius] = useState<number>(999);
  const [senderStroke, setSenderStroke] = useState<SenderStroke>('glass');
  const [senderStrokeWidth, setSenderStrokeWidth] = useState<number>(1);
  const [senderStrokeOpacity, setSenderStrokeOpacity] = useState<number>(0.22);
  const [senderStrokeColor, setSenderStrokeColor] = useState<string>('#ffffff');

  const makeSharePayload = useCallback((): OverlaySharePayload => {
    const style: Record<string, unknown> = {
      position: urlPosition,
      volume: urlVolume,
      scaleMode,
      scaleFixed,
      scaleMin,
      scaleMax,
      safePad,
      radius: urlRadius,
      shadowBlur,
      shadowSpread,
      shadowDistance,
      shadowAngle,
      shadowOpacity,
      shadowColor,
      glass: glassEnabled,
      glassPreset,
      glassTintColor,
      glassTintStrength,
      blur: urlBlur,
      border: urlBorder,
      borderPreset,
      borderTintColor,
      borderTintStrength,
      borderMode,
      borderColor: urlBorderColor,
      borderColor2: urlBorderColor2,
      borderGradientAngle: urlBorderGradientAngle,
      bgOpacity: urlBgOpacity,
      anim: urlAnim,
      enterMs: urlEnterMs,
      exitMs: urlExitMs,
      easing: animEasingPreset,
      easingX1: animEasingX1,
      easingY1: animEasingY1,
      easingX2: animEasingX2,
      easingY2: animEasingY2,
      senderFontSize,
      senderFontWeight,
      senderFontFamily,
      senderFontColor,
      senderHoldMs,
      senderBgColor,
      senderBgOpacity,
      senderBgRadius,
      senderStroke,
      senderStrokeWidth,
      senderStrokeOpacity,
      senderStrokeColor,
    };
    return {
      v: 1,
      overlayMode,
      overlayShowSender,
      overlayMaxConcurrent,
      style,
    };
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
    overlayMaxConcurrent,
    overlayMode,
    overlayShowSender,
    scaleFixed,
    scaleMax,
    scaleMin,
    scaleMode,
    safePad,
    senderBgColor,
    senderBgOpacity,
    senderBgRadius,
    senderFontColor,
    senderFontFamily,
    senderFontSize,
    senderFontWeight,
    senderHoldMs,
    senderStroke,
    senderStrokeColor,
    senderStrokeOpacity,
    senderStrokeWidth,
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

  const applySharePayload = useCallback(
    (p: OverlaySharePayload) => {
      if (p.overlayMode === 'queue' || p.overlayMode === 'simultaneous') setOverlayMode(p.overlayMode);
      if (typeof p.overlayShowSender === 'boolean') setOverlayShowSender(p.overlayShowSender);
      if (typeof p.overlayMaxConcurrent === 'number') setOverlayMaxConcurrent(Math.max(1, Math.min(5, Math.round(p.overlayMaxConcurrent))));

      const s = (p.style && typeof p.style === 'object' ? p.style : {}) as Record<string, unknown>;

      const nextBorderPreset: BorderPreset =
        s.borderPreset === 'glass' ? 'glass' : s.borderPreset === 'glow' ? 'glow' : s.borderPreset === 'frosted' ? 'frosted' : 'custom';
      setBorderPreset(nextBorderPreset);
      if (isHexColor(s.borderTintColor)) setBorderTintColor(String(s.borderTintColor).toLowerCase());
      setBorderTintStrength(clampFloat(s.borderTintStrength, 0, 1, borderTintStrength));

      const nextBorderMode: BorderMode = s.borderMode === 'gradient' ? 'gradient' : 'solid';
      setBorderMode(nextBorderMode);
      if (isHexColor(s.borderColor)) setUrlBorderColor(String(s.borderColor).toLowerCase());
      if (isHexColor(s.borderColor2)) setUrlBorderColor2(String(s.borderColor2).toLowerCase());
      setUrlBorderGradientAngle(clampInt(s.borderGradientAngle, 0, 360, urlBorderGradientAngle));

      setUrlBorder(clampInt(s.border, 0, 12, urlBorder));
      setUrlRadius(clampInt(s.radius, 0, 80, urlRadius));

      const pos = typeof s.position === 'string' ? s.position : urlPosition;
      if (
        pos === 'random' ||
        pos === 'center' ||
        pos === 'top' ||
        pos === 'bottom' ||
        pos === 'top-left' ||
        pos === 'top-right' ||
        pos === 'bottom-left' ||
        pos === 'bottom-right'
      ) {
        setUrlPosition(pos);
      }

      setUrlVolume(clampFloat(s.volume, 0, 1, urlVolume));
      const sm = s.scaleMode === 'range' ? 'range' : 'fixed';
      setScaleMode(sm);
      setScaleFixed(clampFloat(s.scaleFixed, 0.25, 2.5, scaleFixed));
      setScaleMin(clampFloat(s.scaleMin, 0.25, 2.5, scaleMin));
      setScaleMax(clampFloat(s.scaleMax, 0.25, 2.5, scaleMax));
      setSafePad(clampInt(s.safePad, 0, 240, safePad));

      const anim = typeof s.anim === 'string' ? s.anim : urlAnim;
      if (anim === 'fade' || anim === 'zoom' || anim === 'slide-up' || anim === 'pop' || anim === 'lift' || anim === 'none') setUrlAnim(anim);
      setUrlEnterMs(clampInt(s.enterMs, 0, 1200, urlEnterMs));
      setUrlExitMs(clampInt(s.exitMs, 0, 1200, urlExitMs));

      const easingPreset: AnimEasingPreset =
        s.easing === 'custom'
          ? 'custom'
          : s.easing === 'smooth'
            ? 'smooth'
            : s.easing === 'snappy'
              ? 'snappy'
              : s.easing === 'linear'
                ? 'linear'
                : 'ios';
      setAnimEasingPreset(easingPreset);
      setAnimEasingX1(clampFloat(s.easingX1, 0, 1, animEasingX1));
      setAnimEasingY1(clampFloat(s.easingY1, 0, 1, animEasingY1));
      setAnimEasingX2(clampFloat(s.easingX2, 0, 1, animEasingX2));
      setAnimEasingY2(clampFloat(s.easingY2, 0, 1, animEasingY2));

      setShadowBlur(clampInt(s.shadowBlur, 0, 240, shadowBlur));
      setShadowSpread(clampInt(s.shadowSpread, -120, 120, shadowSpread));
      setShadowDistance(clampInt(s.shadowDistance, 0, 120, shadowDistance));
      setShadowAngle(clampInt(s.shadowAngle, 0, 360, shadowAngle));
      setShadowOpacity(clampFloat(s.shadowOpacity, 0, 1, shadowOpacity));
      if (isHexColor(s.shadowColor)) setShadowColor(String(s.shadowColor).toLowerCase());

      const nextGlassEnabled =
        typeof s.glass === 'boolean'
          ? s.glass
          : typeof s.glass === 'number'
            ? s.glass === 1
            : typeof s.glassEnabled === 'boolean'
              ? s.glassEnabled
              : typeof s.glassEnabled === 'number'
                ? s.glassEnabled === 1
                : glassEnabled;
      setGlassEnabled(Boolean(nextGlassEnabled));
      setGlassPreset(s.glassPreset === 'clear' ? 'clear' : s.glassPreset === 'prism' ? 'prism' : 'ios');
      if (isHexColor(s.glassTintColor)) setGlassTintColor(String(s.glassTintColor).toLowerCase());
      setGlassTintStrength(clampFloat(s.glassTintStrength, 0, 1, glassTintStrength));

      setUrlBlur(clampInt(s.blur, 0, 40, urlBlur));
      setUrlBgOpacity(clampFloat(s.bgOpacity, 0, 0.9, urlBgOpacity));

      const nextSenderStroke: SenderStroke = s.senderStroke === 'solid' ? 'solid' : s.senderStroke === 'none' ? 'none' : 'glass';
      setSenderStroke(nextSenderStroke);
      setSenderStrokeWidth(clampInt(s.senderStrokeWidth, 0, 12, senderStrokeWidth));
      setSenderStrokeOpacity(clampFloat(s.senderStrokeOpacity, 0, 1, senderStrokeOpacity));
      if (isHexColor(s.senderStrokeColor)) setSenderStrokeColor(String(s.senderStrokeColor).toLowerCase());

      setSenderFontSize(clampInt(s.senderFontSize, 10, 32, senderFontSize));
      setSenderFontWeight(clampInt(s.senderFontWeight, 300, 900, senderFontWeight));
      if (typeof s.senderFontFamily === 'string') setSenderFontFamily(s.senderFontFamily as SenderFontFamily);
      if (isHexColor(s.senderFontColor)) setSenderFontColor(String(s.senderFontColor).toLowerCase());
      setSenderHoldMs(clampInt(s.senderHoldMs, 0, 6000, senderHoldMs));
      if (isHexColor(s.senderBgColor)) setSenderBgColor(String(s.senderBgColor).toLowerCase());
      setSenderBgOpacity(clampFloat(s.senderBgOpacity, 0, 1, senderBgOpacity));
      setSenderBgRadius(clampInt(s.senderBgRadius, 0, 999, senderBgRadius));
    },
    [
      animEasingX1,
      animEasingX2,
      animEasingY1,
      animEasingY2,
      borderTintStrength,
      glassEnabled,
      glassTintStrength,
      safePad,
      scaleFixed,
      scaleMax,
      scaleMin,
      senderBgOpacity,
      senderBgRadius,
      senderFontSize,
      senderFontWeight,
      senderHoldMs,
      senderStrokeOpacity,
      senderStrokeWidth,
      shadowAngle,
      shadowBlur,
      shadowDistance,
      shadowOpacity,
      shadowSpread,
      urlAnim,
      urlBgOpacity,
      urlBlur,
      urlBorder,
      urlBorderGradientAngle,
      urlEnterMs,
      urlExitMs,
      urlPosition,
      urlRadius,
      urlVolume,
    ]
  );

  const overlayStyleJson = useMemo(() => {
    return JSON.stringify({
      position: urlPosition,
      volume: urlVolume,
      scaleMode,
      scaleFixed,
      scaleMin,
      scaleMax,
      safePad,
      radius: urlRadius,
      shadowBlur,
      shadowSpread,
      shadowDistance,
      shadowAngle,
      shadowOpacity,
      shadowColor,
      glass: glassEnabled,
      glassPreset,
      glassTintColor,
      glassTintStrength,
      blur: urlBlur,
      border: urlBorder,
      borderPreset,
      borderTintColor,
      borderTintStrength,
      borderMode,
      borderColor: urlBorderColor,
      borderColor2: urlBorderColor2,
      borderGradientAngle: urlBorderGradientAngle,
      bgOpacity: urlBgOpacity,
      anim: urlAnim,
      enterMs: urlEnterMs,
      exitMs: urlExitMs,
      easing: animEasingPreset,
      easingX1: animEasingX1,
      easingY1: animEasingY1,
      easingX2: animEasingX2,
      easingY2: animEasingY2,
      senderFontSize,
      senderFontWeight,
      senderFontFamily,
      senderFontColor,
      senderHoldMs,
      senderBgColor,
      senderBgOpacity,
      senderBgRadius,
      senderStroke,
      senderStrokeWidth,
      senderStrokeOpacity,
      senderStrokeColor,
    });
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
    scaleFixed,
    scaleMax,
    scaleMin,
    scaleMode,
    safePad,
    senderBgColor,
    senderBgOpacity,
    senderBgRadius,
    senderFontColor,
    senderFontFamily,
    senderFontSize,
    senderFontWeight,
    senderHoldMs,
    senderStroke,
    senderStrokeColor,
    senderStrokeOpacity,
    senderStrokeWidth,
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

  const overlaySettingsPayload = useMemo(() => {
    return JSON.stringify({ overlayMode, overlayShowSender, overlayMaxConcurrent, overlayStyleJson });
  }, [overlayMaxConcurrent, overlayMode, overlayShowSender, overlayStyleJson]);

  return {
    overlayMode, setOverlayMode, overlayShowSender, setOverlayShowSender, overlayMaxConcurrent, setOverlayMaxConcurrent,
    advancedTab, setAdvancedTab, obsUiMode, setObsUiMode,
    urlPosition, setUrlPosition, urlVolume, setUrlVolume,
    scaleMode, setScaleMode, scaleFixed, setScaleFixed, scaleMin, setScaleMin, scaleMax, setScaleMax,
    urlRadius, setUrlRadius, urlBlur, setUrlBlur, urlBorder, setUrlBorder, safePad, setSafePad,
    glassEnabled, setGlassEnabled, glassPreset, setGlassPreset, glassTintColor, setGlassTintColor, glassTintStrength, setGlassTintStrength,
    borderPreset, setBorderPreset, borderTintColor, setBorderTintColor, borderTintStrength, setBorderTintStrength, borderMode, setBorderMode,
    urlBorderColor, setUrlBorderColor, urlBorderColor2, setUrlBorderColor2, urlBorderGradientAngle, setUrlBorderGradientAngle,
    shadowBlur, setShadowBlur, shadowSpread, setShadowSpread, shadowDistance, setShadowDistance, shadowAngle, setShadowAngle,
    shadowOpacity, setShadowOpacity, shadowColor, setShadowColor,
    urlBgOpacity, setUrlBgOpacity, urlAnim, setUrlAnim,
    animEasingPreset, setAnimEasingPreset, animEasingX1, setAnimEasingX1, animEasingY1, setAnimEasingY1, animEasingX2, setAnimEasingX2, animEasingY2, setAnimEasingY2,
    urlEnterMs, setUrlEnterMs, urlExitMs, setUrlExitMs,
    senderFontSize, setSenderFontSize, senderFontWeight, setSenderFontWeight, senderFontFamily, setSenderFontFamily, senderFontColor, setSenderFontColor,
    senderHoldMs, setSenderHoldMs, senderBgColor, setSenderBgColor, senderBgOpacity, setSenderBgOpacity, senderBgRadius, setSenderBgRadius,
    senderStroke, setSenderStroke, senderStrokeWidth, setSenderStrokeWidth, senderStrokeOpacity, setSenderStrokeOpacity, senderStrokeColor, setSenderStrokeColor,
    makeSharePayload, applySharePayload, overlayStyleJson, overlaySettingsPayload,
  };
}
