import { useCallback, useMemo, type MutableRefObject } from 'react';

import { clampFloat, clampInt } from '../lib/math';

export type CreditsSectionKey = 'donors' | 'chatters';

export type CreditsStyle = {
  // Layout
  anchorX: 'left' | 'center' | 'right';
  anchorY: 'top' | 'center' | 'bottom';
  // Background container insets (distance from screen edges)
  bgInsetLeft: number;
  bgInsetRight: number;
  bgInsetTop: number;
  bgInsetBottom: number;
  maxWidthPx: number;
  maxHeightVh: number;
  textAlign: 'left' | 'center' | 'right';
  // Content padding inside background container
  contentPadLeft: number;
  contentPadRight: number;
  contentPadTop: number;
  contentPadBottom: number;

  // Sections
  sectionsOrder: CreditsSectionKey[];
  showDonors: boolean;
  showChatters: boolean;

  // Typography
  fontFamily: string;
  fontSize: number; // px (float allowed)
  fontWeight: number;
  fontColor: string;
  lineHeight: number;
  letterSpacing: number;
  titleEnabled: boolean;
  titleSize: number;
  titleWeight: number;
  titleColor: string;
  titleTransform: 'none' | 'uppercase' | 'lowercase';

  // Text effects (main lines)
  textShadowBlur: number;
  textShadowOpacity: number;
  textShadowColor: string;
  textStrokeWidth: number;
  textStrokeOpacity: number;
  textStrokeColor: string;

  // Text effects (section title)
  titleShadowBlur: number;
  titleShadowOpacity: number;
  titleShadowColor: string;
  titleStrokeWidth: number;
  titleStrokeOpacity: number;
  titleStrokeColor: string;

  // Background
  backgroundMode: 'transparent' | 'card' | 'full';
  bgColor: string;
  bgOpacity: number;
  blur: number;
  radius: number;
  shadowBlur: number;
  shadowOpacity: number;
  borderEnabled: boolean;
  borderWidth: number;
  borderColor: string;

  // Spacing
  sectionGapPx: number;
  lineGapPx: number;
  indentPx: number;

  // Motion
  scrollDirection: 'up' | 'down';
  loop: boolean;
  startDelayMs: number;
  endFadeMs: number;
  scrollSpeed: number; // px/s
  fadeInMs: number;
};

export type CreditsParams = {
  demo: boolean;
  demoBgCss: string;
  parsedStyle: Partial<CreditsStyle> | null;
  // Live-resolved values (style json + URL/live overrides)
  resolved: CreditsStyle;
  // Demo sequencing support (keeps parity with OverlayView, not strictly required)
  demoSeqRef: MutableRefObject<number>;
};

type ParsedCreditsStyle = Partial<CreditsStyle> & {
  // Legacy / back-compat fields that may still appear in stored JSON.
  padX?: unknown;
  padY?: unknown;
};

function parseJson(raw: string | null | undefined): unknown {
  try {
    const s = String(raw || '').trim();
    if (!s) return null;
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

function toBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw == null) return fallback;
  const v = String(raw).trim().toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function toEnum<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  const v = String(raw ?? '').trim().toLowerCase();
  const hit = allowed.find((a) => a.toLowerCase() === v);
  return hit ?? fallback;
}

function parseSectionsOrder(raw: unknown): CreditsSectionKey[] | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  try {
    const j = JSON.parse(s) as unknown;
    if (!Array.isArray(j)) return null;
    const keys = j
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean)
      .filter((v): v is CreditsSectionKey => v === 'donors' || v === 'chatters');
    return keys.length ? keys : null;
  } catch {
    return null;
  }
}

export function useCreditsParams(args: {
  searchParams: URLSearchParams;
  liveParams: Record<string, string>;
  creditsStyleJson: string | null | undefined;
  demoSeqRef: MutableRefObject<number>;
}) {
  const { searchParams, liveParams, creditsStyleJson, demoSeqRef } = args;

  const getParam = useCallback(
    (key: string): string | null => {
      const v = liveParams[key];
      if (typeof v === 'string') return v;
      return searchParams.get(key);
    },
    [liveParams, searchParams],
  );

  const demo = (getParam('demo') || '') === '1';

  // Demo-only background (transparent unless demo=1)
  const previewBgRaw = String(getParam('previewBg') || '').trim().toLowerCase();
  const previewBg: 'twitch' | 'white' = previewBgRaw === 'white' ? 'white' : 'twitch';
  const demoBgCss =
    previewBg === 'white'
      ? `body { background: #ffffff; }`
      : `body { background: radial-gradient(60% 60% at 25% 15%, rgba(255,255,255,0.10) 0%, rgba(0,0,0,0.85) 60%), linear-gradient(135deg, rgba(56,189,248,0.12), rgba(167,139,250,0.12)); }`;

  const parsedStyle = useMemo(() => {
    const j = parseJson(creditsStyleJson);
    if (!j || typeof j !== 'object') return null;
    return j as ParsedCreditsStyle;
  }, [creditsStyleJson]);

  // Layout
  const anchorX = toEnum(getParam('anchorX') ?? parsedStyle?.anchorX, ['left', 'center', 'right'] as const, 'center');
  const anchorY = toEnum(getParam('anchorY') ?? parsedStyle?.anchorY, ['top', 'center', 'bottom'] as const, 'center');
  // Back-compat: padX/padY previously affected wrapper padding.
  const padXLegacy = clampInt(parseInt(String(getParam('padX') || parsedStyle?.padX || '24'), 10), 0, 400);
  const padYLegacy = clampInt(parseInt(String(getParam('padY') || parsedStyle?.padY || '24'), 10), 0, 400);

  const bgInsetLeft = clampInt(parseInt(String(getParam('bgInsetLeft') || parsedStyle?.bgInsetLeft || String(padXLegacy)), 10), 0, 600);
  const bgInsetRight = clampInt(parseInt(String(getParam('bgInsetRight') || parsedStyle?.bgInsetRight || String(padXLegacy)), 10), 0, 600);
  const bgInsetTop = clampInt(parseInt(String(getParam('bgInsetTop') || parsedStyle?.bgInsetTop || String(padYLegacy)), 10), 0, 600);
  const bgInsetBottom = clampInt(parseInt(String(getParam('bgInsetBottom') || parsedStyle?.bgInsetBottom || String(padYLegacy)), 10), 0, 600);
  const maxWidthPx = clampInt(parseInt(String(getParam('maxWidthPx') || parsedStyle?.maxWidthPx || '920'), 10), 240, 2400);
  const maxHeightVh = clampInt(parseInt(String(getParam('maxHeightVh') || parsedStyle?.maxHeightVh || '88'), 10), 20, 100);
  const textAlign = toEnum(getParam('textAlign') ?? parsedStyle?.textAlign, ['left', 'center', 'right'] as const, 'center');

  // Sections
  const sectionsOrder = useMemo(() => {
    const fromLiveOrUrl = parseSectionsOrder(getParam('sectionsOrder'));
    if (fromLiveOrUrl) return fromLiveOrUrl;
    const fromStyle = parsedStyle?.sectionsOrder;
    if (Array.isArray(fromStyle)) {
      const keys = fromStyle
        .map((v) => String(v || '').trim().toLowerCase())
        .filter((v): v is CreditsSectionKey => v === 'donors' || v === 'chatters');
      if (keys.length) return keys;
    }
    return ['donors', 'chatters'] as CreditsSectionKey[];
  }, [getParam, parsedStyle?.sectionsOrder]);

  const showDonors = toBool(getParam('showDonors') ?? parsedStyle?.showDonors, true);
  const showChatters = toBool(getParam('showChatters') ?? parsedStyle?.showChatters, true);

  // Typography
  const fontFamily = String(getParam('fontFamily') || parsedStyle?.fontFamily || 'system').trim();
  const fontSize = clampFloat(parseFloat(String(getParam('fontSize') || parsedStyle?.fontSize || '22')), 10, 96);
  const fontWeight = clampInt(parseInt(String(getParam('fontWeight') || parsedStyle?.fontWeight || '700'), 10), 300, 900);
  const fontColor = String(getParam('fontColor') || parsedStyle?.fontColor || '#ffffff').trim() || '#ffffff';
  const lineHeight = clampFloat(parseFloat(String(getParam('lineHeight') || parsedStyle?.lineHeight || '1.15')), 0.9, 2.2);
  const letterSpacing = clampFloat(parseFloat(String(getParam('letterSpacing') || parsedStyle?.letterSpacing || '0')), -2, 8);
  const titleEnabled = toBool(getParam('titleEnabled') ?? parsedStyle?.titleEnabled, true);
  const titleSizeFallback = Math.max(10, Math.min(96, fontSize * 0.85));
  const titleSize = clampFloat(parseFloat(String(getParam('titleSize') || parsedStyle?.titleSize || String(titleSizeFallback))), 10, 96);
  const titleWeightFallback = Math.max(300, Math.min(900, Math.round(fontWeight)));
  const titleWeight = clampInt(parseInt(String(getParam('titleWeight') || parsedStyle?.titleWeight || String(titleWeightFallback)), 10), 300, 900);
  const titleColor = String(getParam('titleColor') || parsedStyle?.titleColor || fontColor).trim() || fontColor;
  const titleTransform = toEnum(
    getParam('titleTransform') ?? parsedStyle?.titleTransform,
    ['none', 'uppercase', 'lowercase'] as const,
    'none',
  );

  // Content padding (back-compat: if missing, default to a good readable padding)
  const contentPadXFallback = 28;
  const contentPadYFallback = 28;
  const contentPadLeft = clampInt(parseInt(String(getParam('contentPadLeft') || parsedStyle?.contentPadLeft || String(contentPadXFallback)), 10), 0, 240);
  const contentPadRight = clampInt(parseInt(String(getParam('contentPadRight') || parsedStyle?.contentPadRight || String(contentPadXFallback)), 10), 0, 240);
  const contentPadTop = clampInt(parseInt(String(getParam('contentPadTop') || parsedStyle?.contentPadTop || String(contentPadYFallback)), 10), 0, 240);
  const contentPadBottom = clampInt(parseInt(String(getParam('contentPadBottom') || parsedStyle?.contentPadBottom || String(contentPadYFallback)), 10), 0, 240);

  // Text effects (defaults: subtle shadow, no stroke)
  const textShadowBlur = clampInt(parseInt(String(getParam('textShadowBlur') || parsedStyle?.textShadowBlur || '16'), 10), 0, 120);
  const textShadowOpacity = clampFloat(parseFloat(String(getParam('textShadowOpacity') || parsedStyle?.textShadowOpacity || '0.6')), 0, 1);
  const textShadowColor = String(getParam('textShadowColor') || parsedStyle?.textShadowColor || '#000000').trim() || '#000000';
  const textStrokeWidth = clampFloat(parseFloat(String(getParam('textStrokeWidth') || parsedStyle?.textStrokeWidth || '0')), 0, 6);
  const textStrokeOpacity = clampFloat(parseFloat(String(getParam('textStrokeOpacity') || parsedStyle?.textStrokeOpacity || '0.85')), 0, 1);
  const textStrokeColor = String(getParam('textStrokeColor') || parsedStyle?.textStrokeColor || '#000000').trim() || '#000000';

  const titleShadowBlur = clampInt(parseInt(String(getParam('titleShadowBlur') || parsedStyle?.titleShadowBlur || '18'), 10), 0, 120);
  const titleShadowOpacity = clampFloat(parseFloat(String(getParam('titleShadowOpacity') || parsedStyle?.titleShadowOpacity || '0.7')), 0, 1);
  const titleShadowColor = String(getParam('titleShadowColor') || parsedStyle?.titleShadowColor || '#000000').trim() || '#000000';
  const titleStrokeWidth = clampFloat(parseFloat(String(getParam('titleStrokeWidth') || parsedStyle?.titleStrokeWidth || '0')), 0, 6);
  const titleStrokeOpacity = clampFloat(parseFloat(String(getParam('titleStrokeOpacity') || parsedStyle?.titleStrokeOpacity || '0.9')), 0, 1);
  const titleStrokeColor = String(getParam('titleStrokeColor') || parsedStyle?.titleStrokeColor || '#000000').trim() || '#000000';

  // Background
  const backgroundMode = toEnum(
    getParam('backgroundMode') ?? parsedStyle?.backgroundMode,
    ['transparent', 'card', 'full'] as const,
    'card',
  );
  const bgColor = String(getParam('bgColor') || parsedStyle?.bgColor || '#000000').trim() || '#000000';
  const bgOpacity = clampFloat(parseFloat(String(getParam('bgOpacity') || parsedStyle?.bgOpacity || '0')), 0, 0.85);
  const blur = clampInt(parseInt(String(getParam('blur') || parsedStyle?.blur || '0'), 10), 0, 40);
  const radius = clampInt(parseInt(String(getParam('radius') || parsedStyle?.radius || '18'), 10), 0, 80);
  const shadowBlur = clampInt(parseInt(String(getParam('shadowBlur') || parsedStyle?.shadowBlur || '60'), 10), 0, 240);
  const shadowOpacity = clampFloat(parseFloat(String(getParam('shadowOpacity') || parsedStyle?.shadowOpacity || '0.6')), 0, 1);
  const borderEnabled = toBool(getParam('borderEnabled') ?? parsedStyle?.borderEnabled, false);
  const borderWidth = clampInt(parseInt(String(getParam('borderWidth') || parsedStyle?.borderWidth || '1'), 10), 0, 16);
  const borderColor = String(getParam('borderColor') || parsedStyle?.borderColor || '#ffffff').trim() || '#ffffff';

  // Spacing
  const sectionGapPx = clampInt(parseInt(String(getParam('sectionGapPx') || parsedStyle?.sectionGapPx || '24'), 10), 0, 120);
  const lineGapPx = clampInt(parseInt(String(getParam('lineGapPx') || parsedStyle?.lineGapPx || '8'), 10), 0, 80);
  const indentPx = clampInt(parseInt(String(getParam('indentPx') || parsedStyle?.indentPx || '0'), 10), 0, 240);

  // Motion
  const scrollDirection = toEnum(
    getParam('scrollDirection') ?? parsedStyle?.scrollDirection,
    ['up', 'down'] as const,
    'up',
  );
  const loop = toBool(getParam('loop') ?? parsedStyle?.loop, true);
  const startDelayMs = clampInt(parseInt(String(getParam('startDelayMs') || parsedStyle?.startDelayMs || '0'), 10), 0, 60000);
  const endFadeMs = clampInt(parseInt(String(getParam('endFadeMs') || parsedStyle?.endFadeMs || '0'), 10), 0, 60000);
  const scrollSpeed = clampFloat(parseFloat(String(getParam('scrollSpeed') || parsedStyle?.scrollSpeed || '48')), 8, 600);
  const fadeInMs = clampInt(parseInt(String(getParam('fadeInMs') || parsedStyle?.fadeInMs || '600'), 10), 0, 5000);

  const resolved: CreditsStyle = useMemo(
    () => ({
      anchorX,
      anchorY,
      bgInsetLeft,
      bgInsetRight,
      bgInsetTop,
      bgInsetBottom,
      maxWidthPx,
      maxHeightVh,
      textAlign,
      contentPadLeft,
      contentPadRight,
      contentPadTop,
      contentPadBottom,
      sectionsOrder,
      showDonors,
      showChatters,
      fontFamily,
      fontSize,
      fontWeight,
      fontColor,
      lineHeight,
      letterSpacing,
      titleEnabled,
      titleSize,
      titleWeight,
      titleColor,
      titleTransform,
      textShadowBlur,
      textShadowOpacity,
      textShadowColor,
      textStrokeWidth,
      textStrokeOpacity,
      textStrokeColor,
      titleShadowBlur,
      titleShadowOpacity,
      titleShadowColor,
      titleStrokeWidth,
      titleStrokeOpacity,
      titleStrokeColor,
      backgroundMode,
      bgColor,
      bgOpacity,
      blur,
      radius,
      shadowBlur,
      shadowOpacity,
      borderEnabled,
      borderWidth,
      borderColor,
      sectionGapPx,
      lineGapPx,
      indentPx,
      scrollDirection,
      loop,
      startDelayMs,
      endFadeMs,
      scrollSpeed,
      fadeInMs,
    }),
    [
      anchorX,
      anchorY,
      bgInsetLeft,
      bgInsetRight,
      bgInsetTop,
      bgInsetBottom,
      bgColor,
      backgroundMode,
      bgOpacity,
      blur,
      borderColor,
      borderEnabled,
      borderWidth,
      contentPadLeft,
      contentPadRight,
      contentPadTop,
      contentPadBottom,
      fadeInMs,
      fontColor,
      fontFamily,
      fontSize,
      fontWeight,
      letterSpacing,
      lineHeight,
      lineGapPx,
      endFadeMs,
      indentPx,
      loop,
      maxHeightVh,
      maxWidthPx,
      radius,
      scrollDirection,
      scrollSpeed,
      sectionGapPx,
      sectionsOrder,
      shadowBlur,
      shadowOpacity,
      showChatters,
      showDonors,
      startDelayMs,
      textAlign,
      textShadowBlur,
      textShadowOpacity,
      textShadowColor,
      textStrokeWidth,
      textStrokeOpacity,
      textStrokeColor,
      titleShadowBlur,
      titleShadowOpacity,
      titleShadowColor,
      titleStrokeWidth,
      titleStrokeOpacity,
      titleStrokeColor,
      titleColor,
      titleEnabled,
      titleSize,
      titleTransform,
      titleWeight,
    ],
  );

  return useMemo<CreditsParams>(
    () => ({ demo, demoBgCss, parsedStyle, resolved, demoSeqRef }),
    [demo, demoBgCss, parsedStyle, resolved, demoSeqRef],
  );
}


