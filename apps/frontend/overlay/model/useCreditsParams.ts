import { useCallback, useMemo } from 'react';

import { clampFloat, clampInt } from '../lib/math';
import type { MutableRefObject } from 'react';

export type CreditsSectionKey = 'donors' | 'chatters';

export type CreditsStyle = {
  // Sections
  sectionsOrder: CreditsSectionKey[];
  showDonors: boolean;
  showChatters: boolean;

  // Typography
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontColor: string;

  // Background
  bgOpacity: number;
  blur: number;
  radius: number;
  shadowBlur: number;
  shadowOpacity: number;

  // Spacing
  sectionGapPx: number;
  lineGapPx: number;

  // Motion
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

function parseJson(raw: string | null | undefined): unknown {
  try {
    const s = String(raw || '').trim();
    if (!s) return null;
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

function toBool(raw: string | null | undefined, fallback: boolean): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
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
    return j as Partial<CreditsStyle>;
  }, [creditsStyleJson]);

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

  const showDonors = toBool(getParam('showDonors') ?? (parsedStyle?.showDonors as any), true);
  const showChatters = toBool(getParam('showChatters') ?? (parsedStyle?.showChatters as any), true);

  // Typography
  const fontFamily = String(getParam('fontFamily') || parsedStyle?.fontFamily || 'system').trim();
  const fontSize = clampInt(parseInt(String(getParam('fontSize') || parsedStyle?.fontSize || '22'), 10), 10, 64);
  const fontWeight = clampInt(parseInt(String(getParam('fontWeight') || parsedStyle?.fontWeight || '700'), 10), 300, 900);
  const fontColor = String(getParam('fontColor') || parsedStyle?.fontColor || '#ffffff').trim() || '#ffffff';

  // Background
  const bgOpacity = clampFloat(parseFloat(String(getParam('bgOpacity') || parsedStyle?.bgOpacity || '0')), 0, 0.85);
  const blur = clampInt(parseInt(String(getParam('blur') || parsedStyle?.blur || '0'), 10), 0, 40);
  const radius = clampInt(parseInt(String(getParam('radius') || parsedStyle?.radius || '18'), 10), 0, 80);
  const shadowBlur = clampInt(parseInt(String(getParam('shadowBlur') || parsedStyle?.shadowBlur || '60'), 10), 0, 240);
  const shadowOpacity = clampFloat(parseFloat(String(getParam('shadowOpacity') || parsedStyle?.shadowOpacity || '0.6')), 0, 1);

  // Spacing
  const sectionGapPx = clampInt(parseInt(String(getParam('sectionGapPx') || parsedStyle?.sectionGapPx || '24'), 10), 0, 120);
  const lineGapPx = clampInt(parseInt(String(getParam('lineGapPx') || parsedStyle?.lineGapPx || '8'), 10), 0, 80);

  // Motion
  const scrollSpeed = clampFloat(parseFloat(String(getParam('scrollSpeed') || parsedStyle?.scrollSpeed || '48')), 8, 600);
  const fadeInMs = clampInt(parseInt(String(getParam('fadeInMs') || parsedStyle?.fadeInMs || '600'), 10), 0, 5000);

  const resolved: CreditsStyle = useMemo(
    () => ({
      sectionsOrder,
      showDonors,
      showChatters,
      fontFamily,
      fontSize,
      fontWeight,
      fontColor,
      bgOpacity,
      blur,
      radius,
      shadowBlur,
      shadowOpacity,
      sectionGapPx,
      lineGapPx,
      scrollSpeed,
      fadeInMs,
    }),
    [
      bgOpacity,
      blur,
      fadeInMs,
      fontColor,
      fontFamily,
      fontSize,
      fontWeight,
      lineGapPx,
      radius,
      scrollSpeed,
      sectionGapPx,
      sectionsOrder,
      shadowBlur,
      shadowOpacity,
      showChatters,
      showDonors,
    ],
  );

  return useMemo<CreditsParams>(
    () => ({ demo, demoBgCss, parsedStyle, resolved, demoSeqRef }),
    [demo, demoBgCss, parsedStyle, resolved, demoSeqRef],
  );
}


