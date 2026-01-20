import { useCallback, useMemo } from 'react';

import { isHexColor } from '../lib/color';
import { clampAlpha, clampDeg, clampFloat, clampInt } from '../lib/math';
import { mulberry32 } from '../lib/random';

import type { OverlayAnim, OverlayPosition } from '../overlay-view/types';
import type { MutableRefObject } from 'react';

export type OverlayStyle = Record<string, unknown>;

export type OverlayParams = {
  // Base flags
  demo: boolean;

  // Preview background (demo-only)
  demoBgCss: string;

  // Preview media
  previewUrlsParam: string[];
  previewTypesParam: string[];
  previewCount: number;
  previewRepeat: boolean;
  previewModeParam: string;
  demoSeed: number;

  // Core user params
  scale: number;
  urlScaleMode: string;
  urlScaleFixed: number;
  urlScaleMin: number;
  urlScaleMax: number;
  position: OverlayPosition;
  volume: number;

  // Style json (from server config)
  parsedStyle: OverlayStyle | null;

  // Appearance
  radius: number;
  shadowBlur: number;
  shadowSpread: number;
  shadowDistance: number;
  shadowAngle: number;
  shadowOpacity: number;
  shadowColor: string;
  blur: number;
  border: number;
  borderPreset: 'custom' | 'glass' | 'glow' | 'frosted';
  borderTintColor: string;
  borderTintStrength: number;
  borderMode: 'solid' | 'gradient';
  borderColor: string;
  borderColor2: string;
  borderGradientAngle: number;
  bgOpacity: number;
  anim: OverlayAnim;
  enterMs: number;
  exitMs: number;
  easing: string;

  // Sender label presentation
  senderFontSize: number;
  senderFontWeight: number;
  senderFontFamily: string;
  senderFontColor: string;
  senderHoldMs: number;
  senderBgOpacity: number;
  senderBgColor: string;
  senderBgRadius: number;
  senderStroke: 'none' | 'glass' | 'solid';
  senderStrokeWidth: number;
  senderStrokeOpacity: number;
  senderStrokeColor: string;

  // Glass layer
  glassEnabled: boolean;
  glassPreset: string;
  glassTintColor: string;
  glassTintStrength: number;

  // Layout / positioning
  safePadPx: number;
  lockPos: boolean;
  showSafeGuide: boolean;
  posSeed: number;

  safeScale: number;
  resolvedPosition: OverlayPosition;
  getNextUserScale: () => number;
  pickRandomPosition: (salt?: number) => { xPct: number; yPct: number };
};

function parseJsonStringArray(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const s = raw.trim();
  if (!s) return [];
  try {
    const j = JSON.parse(s) as unknown;
    if (!Array.isArray(j)) return [];
    return j.map((v) => String(v ?? '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function useOverlayParams(args: {
  searchParams: URLSearchParams;
  liveParams: Record<string, string>;
  overlayStyleJson: string | null | undefined;
  demoSeqRef: MutableRefObject<number>;
}) {
  const { searchParams, liveParams, overlayStyleJson, demoSeqRef } = args;

  const getParam = useCallback(
    (key: string): string | null => {
      const v = liveParams[key];
      if (typeof v === 'string') return v;
      return searchParams.get(key);
    },
    [liveParams, searchParams],
  );

  const scale = parseFloat(getParam('scale') || '1');
  const urlScaleMode = String(getParam('scaleMode') || '').trim().toLowerCase();
  const urlScaleFixed = parseFloat(String(getParam('scaleFixed') || ''));
  const urlScaleMin = parseFloat(String(getParam('scaleMin') || ''));
  const urlScaleMax = parseFloat(String(getParam('scaleMax') || ''));
  const position = (getParam('position') || 'random').toLowerCase() as OverlayPosition;
  const volume = parseFloat(getParam('volume') || '1');
  const demo = (getParam('demo') || '') === '1';

  const livePreviewUrls = useMemo(() => parseJsonStringArray(liveParams.previewUrls), [liveParams.previewUrls]);
  const livePreviewTypes = useMemo(
    () => parseJsonStringArray(liveParams.previewTypes).map((v) => v.trim().toLowerCase()).filter(Boolean),
    [liveParams.previewTypes],
  );

  const previewUrlsParam = useMemo(() => {
    if (livePreviewUrls.length > 0) return livePreviewUrls;
    return searchParams.getAll('previewUrl').map((v) => String(v || '').trim()).filter(Boolean);
  }, [livePreviewUrls, searchParams]);

  const previewTypesParam = useMemo(() => {
    if (livePreviewTypes.length > 0) return livePreviewTypes;
    return searchParams.getAll('previewType').map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
  }, [livePreviewTypes, searchParams]);

  const previewCount = clampInt(parseInt(String(getParam('previewCount') || ''), 10), 1, 5);
  const previewRepeat = (getParam('repeat') || '') === '1';
  const previewModeParam = String(getParam('previewMode') || '').trim().toLowerCase();
  const demoSeed = clampInt(parseInt(String(getParam('seed') || '1'), 10), 0, 1000000000);

  // Preview-only background (does not affect real OBS usage; default is transparent unless demo=1).
  const previewBgRaw = String(getParam('previewBg') || '').trim().toLowerCase();
  const previewBg: 'twitch' | 'white' | 'image' =
    previewBgRaw === 'white' ? 'white' : previewBgRaw === 'image' ? 'image' : 'twitch';
  const previewBgUrlRaw = String(getParam('previewBgUrl') || '').trim();
  const previewBgUrl =
    /^https?:\/\//i.test(previewBgUrlRaw) && previewBgUrlRaw.length <= 800 ? previewBgUrlRaw : '';

  const demoBgCss =
    previewBg === 'white'
      ? `body { background: #ffffff; }`
      : previewBg === 'image' && previewBgUrl
        ? `
          body {
            background-image: url(${JSON.stringify(previewBgUrl)});
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            background-attachment: fixed;
          }
          /* Keep overlay readable on busy images */
          body::before {
            content: '';
            position: fixed;
            inset: 0;
            pointer-events: none;
            background: radial-gradient(60% 60% at 25% 15%, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0.72) 65%);
          }
        `
        : `body { background: radial-gradient(60% 60% at 25% 15%, rgba(255,255,255,0.10) 0%, rgba(0,0,0,0.85) 60%), linear-gradient(135deg, rgba(56,189,248,0.12), rgba(167,139,250,0.12)); }`;

  const parsedStyle: OverlayStyle | null = useMemo(() => {
    try {
      const raw = String(overlayStyleJson || '').trim();
      if (!raw) return null;
      const j = JSON.parse(raw) as unknown;
      return j && typeof j === 'object' ? (j as OverlayStyle) : null;
    } catch {
      return null;
    }
  }, [overlayStyleJson]);

  const radius = clampInt(parseInt(String(getParam('radius') || parsedStyle?.['radius'] || ''), 10), 0, 80);
  // Shadow params (back-compat: `shadow` = blur)
  const shadowBlur = clampInt(
    parseInt(
      String(
        getParam('shadowBlur') ||
          parsedStyle?.['shadowBlur'] ||
          searchParams.get('shadow') ||
          parsedStyle?.['shadow'] ||
          '',
      ),
      10,
    ),
    0,
    240,
  );
  const shadowSpread = clampInt(parseInt(String(getParam('shadowSpread') || parsedStyle?.['shadowSpread'] || ''), 10), 0, 120);
  const shadowDistance = clampInt(
    parseInt(String(getParam('shadowDistance') || parsedStyle?.['shadowDistance'] || ''), 10),
    0,
    120,
  );
  const shadowAngle = clampDeg(parseFloat(String(getParam('shadowAngle') || parsedStyle?.['shadowAngle'] || '')));
  const shadowOpacity = clampAlpha(
    parseFloat(String(getParam('shadowOpacity') || parsedStyle?.['shadowOpacity'] || '0.60')),
    0,
    1,
  );
  const shadowColorRaw = String(getParam('shadowColor') || parsedStyle?.['shadowColor'] || '').trim();
  const shadowColor = isHexColor(shadowColorRaw) ? shadowColorRaw : '#000000';
  const blur = clampInt(parseInt(String(getParam('blur') || parsedStyle?.['blur'] || ''), 10), 0, 40);
  const border = clampInt(parseInt(String(getParam('border') || parsedStyle?.['border'] || ''), 10), 0, 12);

  const borderPresetRaw = String(getParam('borderPreset') || parsedStyle?.['borderPreset'] || 'custom').trim().toLowerCase();
  const borderPreset: 'custom' | 'glass' | 'glow' | 'frosted' =
    borderPresetRaw === 'glass'
      ? 'glass'
      : borderPresetRaw === 'glow'
        ? 'glow'
        : borderPresetRaw === 'frosted'
          ? 'frosted'
          : 'custom';
  const borderTintColorRaw = String(getParam('borderTintColor') || parsedStyle?.['borderTintColor'] || '#7dd3fc').trim();
  const borderTintColor = isHexColor(borderTintColorRaw) ? borderTintColorRaw : '#7dd3fc';
  const borderTintStrength = clampAlpha(
    parseFloat(String(getParam('borderTintStrength') || parsedStyle?.['borderTintStrength'] || '0.35')),
    0,
    1,
  );

  const borderModeRaw = String(getParam('borderMode') || parsedStyle?.['borderMode'] || 'solid').trim().toLowerCase();
  const borderMode: 'solid' | 'gradient' = borderModeRaw === 'gradient' ? 'gradient' : 'solid';
  const borderColorRaw = String(getParam('borderColor') || parsedStyle?.['borderColor'] || '').trim();
  const borderColor = isHexColor(borderColorRaw) ? borderColorRaw : '#FFFFFF';
  const borderColor2Raw = String(getParam('borderColor2') || parsedStyle?.['borderColor2'] || '').trim();
  const borderColor2 = isHexColor(borderColor2Raw) ? borderColor2Raw : '#00E5FF';
  const borderGradientAngle = clampDeg(
    parseFloat(String(getParam('borderGradientAngle') || parsedStyle?.['borderGradientAngle'] || '135')),
  );
  const bgOpacity = clampFloat(parseFloat(String(getParam('bgOpacity') || parsedStyle?.['bgOpacity'] || '')), 0, 0.65);
  const anim = (String(getParam('anim') || parsedStyle?.['anim'] || 'fade').toLowerCase() as OverlayAnim) || 'fade';
  const enterMs = clampInt(parseInt(String(getParam('enterMs') || parsedStyle?.['enterMs'] || ''), 10), 0, 1200);
  const exitMs = clampInt(parseInt(String(getParam('exitMs') || parsedStyle?.['exitMs'] || ''), 10), 0, 1200);

  const easingPresetRaw = String(getParam('easing') || parsedStyle?.['easing'] || 'ios').trim().toLowerCase();
  const easingX1 = clampFloat(parseFloat(String(getParam('easingX1') || parsedStyle?.['easingX1'] || '0.22')), -1, 2);
  const easingY1 = clampFloat(parseFloat(String(getParam('easingY1') || parsedStyle?.['easingY1'] || '1')), -1, 2);
  const easingX2 = clampFloat(parseFloat(String(getParam('easingX2') || parsedStyle?.['easingX2'] || '0.36')), -1, 2);
  const easingY2 = clampFloat(parseFloat(String(getParam('easingY2') || parsedStyle?.['easingY2'] || '1')), -1, 2);
  const easing = (() => {
    if (easingPresetRaw === 'custom') return `cubic-bezier(${easingX1}, ${easingY1}, ${easingX2}, ${easingY2})`;
    if (easingPresetRaw === 'smooth') return 'cubic-bezier(0.16, 1, 0.3, 1)';
    if (easingPresetRaw === 'snappy') return 'cubic-bezier(0.34, 1.56, 0.64, 1)';
    if (easingPresetRaw === 'expo') return 'cubic-bezier(0.16, 1, 0.3, 1)'; // close to easeOutExpo-ish feel
    if (easingPresetRaw === 'linear') return 'linear';
    // default "ios"
    return 'cubic-bezier(0.22, 1, 0.36, 1)';
  })();

  const senderFontSize = clampInt(
    parseInt(String(getParam('senderFontSize') || parsedStyle?.['senderFontSize'] || ''), 10),
    10,
    28,
  );
  const senderFontWeight = clampInt(
    parseInt(String(getParam('senderFontWeight') || parsedStyle?.['senderFontWeight'] || ''), 10),
    400,
    800,
  );
  const senderFontFamily = String(getParam('senderFontFamily') || parsedStyle?.['senderFontFamily'] || 'system')
    .trim()
    .toLowerCase();
  const senderFontColorRaw = String(getParam('senderFontColor') || parsedStyle?.['senderFontColor'] || '#ffffff').trim();
  const senderFontColor = isHexColor(senderFontColorRaw) ? senderFontColorRaw : '#ffffff';

  const senderHoldMs = clampInt(parseInt(String(getParam('senderHoldMs') || parsedStyle?.['senderHoldMs'] || ''), 10), 0, 12000);
  const senderBgOpacity = clampAlpha(
    parseFloat(String(getParam('senderBgOpacity') || parsedStyle?.['senderBgOpacity'] || '0.62')),
    0,
    1,
  );
  const senderBgColorRaw = String(getParam('senderBgColor') || parsedStyle?.['senderBgColor'] || '#000000').trim();
  const senderBgColor = isHexColor(senderBgColorRaw) ? senderBgColorRaw : '#000000';
  const senderBgRadius = clampInt(
    parseInt(String(getParam('senderBgRadius') || parsedStyle?.['senderBgRadius'] || '999'), 10),
    0,
    999,
  );
  const senderStrokeRaw = String(getParam('senderStroke') || parsedStyle?.['senderStroke'] || 'glass').trim().toLowerCase();
  const senderStroke: 'none' | 'glass' | 'solid' =
    senderStrokeRaw === 'none' ? 'none' : senderStrokeRaw === 'solid' ? 'solid' : 'glass';
  const senderStrokeWidth = clampInt(
    parseInt(String(getParam('senderStrokeWidth') || parsedStyle?.['senderStrokeWidth'] || '1'), 10),
    0,
    6,
  );
  const senderStrokeOpacity = clampAlpha(
    parseFloat(String(getParam('senderStrokeOpacity') || parsedStyle?.['senderStrokeOpacity'] || '0.22')),
    0,
    1,
  );
  const senderStrokeColorRaw = String(getParam('senderStrokeColor') || parsedStyle?.['senderStrokeColor'] || '#ffffff').trim();
  const senderStrokeColor = isHexColor(senderStrokeColorRaw) ? senderStrokeColorRaw : '#ffffff';

  const glassEnabledRaw = String(getParam('glass') || parsedStyle?.['glass'] || parsedStyle?.['glassEnabled'] || '').trim().toLowerCase();
  const glassEnabled =
    glassEnabledRaw.length > 0
      ? glassEnabledRaw === '1' || glassEnabledRaw === 'true' || glassEnabledRaw === 'yes' || glassEnabledRaw === 'on'
      : blur > 0 || bgOpacity > 0;
  const glassPreset = String(getParam('glassPreset') || parsedStyle?.['glassPreset'] || 'ios').trim().toLowerCase();
  const glassTintColorRaw = String(getParam('glassTintColor') || parsedStyle?.['glassTintColor'] || '#7dd3fc').trim();
  const glassTintColor = isHexColor(glassTintColorRaw) ? glassTintColorRaw : '#7dd3fc';
  const glassTintStrength = clampAlpha(
    parseFloat(String(getParam('glassTintStrength') || parsedStyle?.['glassTintStrength'] || '0.22')),
    0,
    1,
  );

  const safePadRaw = String(getParam('safePad') || parsedStyle?.['safePad'] || '').trim();
  const safePadPx = clampInt(parseInt(safePadRaw, 10), 0, 240);
  const lockPos = (getParam('lockPos') || '') === '1';
  const showSafeGuide = (getParam('showSafeGuide') || '') === '1';
  const posSeed = clampInt(parseInt(String(getParam('posSeed') || '1'), 10), 0, 1000000000);

  const safeScale = useMemo(() => {
    const urlFixed = Number.isFinite(urlScaleFixed) && urlScaleFixed > 0 ? urlScaleFixed : NaN;
    const fixed = Number(parsedStyle?.['scaleFixed']);
    const s = Number.isFinite(urlFixed)
      ? urlFixed
      : Number.isFinite(fixed) && fixed > 0
        ? fixed
        : (Number.isFinite(scale) ? scale : 1);
    return Math.min(2.5, Math.max(0.25, s));
  }, [parsedStyle, scale, urlScaleFixed]);

  const resolvedPosition = useMemo<OverlayPosition>(() => {
    const p = String(parsedStyle?.['position'] || '').toLowerCase();
    if (
      p === 'random' ||
      p === 'center' ||
      p === 'top' ||
      p === 'bottom' ||
      p === 'top-left' ||
      p === 'top-right' ||
      p === 'bottom-left' ||
      p === 'bottom-right'
    ) {
      return p as OverlayPosition;
    }
    return position;
  }, [parsedStyle, position]);

  const getNextUserScale = useCallback((): number => {
    const mode = urlScaleMode || String(parsedStyle?.['scaleMode'] || '').toLowerCase();
    if (mode === 'range') {
      const min = clampFloat(Number.isFinite(urlScaleMin) ? urlScaleMin : Number(parsedStyle?.['scaleMin']), 0.25, 2.5);
      const max = clampFloat(Number.isFinite(urlScaleMax) ? urlScaleMax : Number(parsedStyle?.['scaleMax']), 0.25, 2.5);
      const lo = Math.min(min, max);
      const hi = Math.max(min, max);
      return clampFloat(lo + Math.random() * (hi - lo), 0.25, 2.5);
    }
    const fixed = clampFloat(Number.isFinite(urlScaleFixed) ? urlScaleFixed : Number(parsedStyle?.['scaleFixed']), 0.25, 2.5);
    if (Number.isFinite(fixed) && fixed > 0) return fixed;
    return safeScale;
  }, [parsedStyle, safeScale, urlScaleFixed, urlScaleMax, urlScaleMin, urlScaleMode]);

  const pickRandomPosition = useCallback(
    (salt: number = 0): { xPct: number; yPct: number } => {
      const baseMargin = 12;
      const pad = safePadPx > 0 ? safePadPx : 0;
      const minSide = Math.max(1, Math.min(window.innerWidth || 0, window.innerHeight || 0));
      const padPct = pad > 0 ? Math.round((pad / minSide) * 100) : 0;
      const margin = Math.min(28, Math.max(8, Math.round(baseMargin * safeScale) + padPct));
      const rng = demo ? mulberry32((demoSeed + posSeed * 7919 + demoSeqRef.current * 9973 + salt * 1013) >>> 0) : null;
      const r1 = rng ? rng() : Math.random();
      const r2 = rng ? rng() : Math.random();
      const xPct = margin + r1 * (100 - margin * 2);
      const yPct = margin + r2 * (100 - margin * 2);
      return { xPct, yPct };
    },
    [demo, demoSeed, demoSeqRef, posSeed, safePadPx, safeScale],
  );

  return useMemo<OverlayParams>(
    () => ({
      demo,
      demoBgCss,
      previewUrlsParam,
      previewTypesParam,
      previewCount,
      previewRepeat,
      previewModeParam,
      demoSeed,
      scale,
      urlScaleMode,
      urlScaleFixed,
      urlScaleMin,
      urlScaleMax,
      position,
      volume,
      parsedStyle,
      radius,
      shadowBlur,
      shadowSpread,
      shadowDistance,
      shadowAngle,
      shadowOpacity,
      shadowColor,
      blur,
      border,
      borderPreset,
      borderTintColor,
      borderTintStrength,
      borderMode,
      borderColor,
      borderColor2,
      borderGradientAngle,
      bgOpacity,
      anim,
      enterMs,
      exitMs,
      easing,
      senderFontSize,
      senderFontWeight,
      senderFontFamily,
      senderFontColor,
      senderHoldMs,
      senderBgOpacity,
      senderBgColor,
      senderBgRadius,
      senderStroke,
      senderStrokeWidth,
      senderStrokeOpacity,
      senderStrokeColor,
      glassEnabled,
      glassPreset,
      glassTintColor,
      glassTintStrength,
      safePadPx,
      lockPos,
      showSafeGuide,
      posSeed,
      safeScale,
      resolvedPosition,
      getNextUserScale,
      pickRandomPosition,
    }),
    [
      anim,
      bgOpacity,
      blur,
      border,
      borderColor,
      borderColor2,
      borderGradientAngle,
      borderMode,
      borderPreset,
      borderTintColor,
      borderTintStrength,
      demo,
      demoBgCss,
      demoSeed,
      easing,
      enterMs,
      exitMs,
      getNextUserScale,
      glassEnabled,
      glassPreset,
      glassTintColor,
      glassTintStrength,
      lockPos,
      parsedStyle,
      pickRandomPosition,
      posSeed,
      position,
      previewCount,
      previewModeParam,
      previewRepeat,
      previewTypesParam,
      previewUrlsParam,
      radius,
      resolvedPosition,
      safePadPx,
      safeScale,
      scale,
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
      showSafeGuide,
      urlScaleFixed,
      urlScaleMax,
      urlScaleMin,
      urlScaleMode,
      volume,
    ],
  );
}


