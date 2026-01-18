import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import {
  clampFloat,
  clampInt,
  isHexColor,
  type OverlaySharePayload,
} from './obs/lib/shareCode';
import { RotateIcon } from './obs/ui/RotateIcon';

import SecretCopyField from '@/components/SecretCopyField';
import { useSocket } from '@/contexts/SocketContext';
import { getApiOriginForRedirect } from '@/shared/auth/login';
import { getRuntimeConfig } from '@/shared/config/runtimeConfig';
import {
  getCreditsState,
  getCreditsToken,
  getIgnoredChatters,
  getReconnectWindow,
  resetCreditsSession as resetCreditsSessionApi,
  rotateCreditsToken,
  saveCreditsSettings,
  setIgnoredChatters,
  setReconnectWindow,
} from '@/shared/api/creditsOverlay';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';
import { Button, HelpTooltip, IconButton, Input, Textarea } from '@/shared/ui';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';
import { useAppSelector } from '@/store/hooks';

type BorderPreset = 'custom' | 'glass' | 'glow' | 'frosted';
type BorderMode = 'solid' | 'gradient';
type GlassPreset = 'ios' | 'clear' | 'prism';
type SenderFontFamily =
  | 'system'
  | 'inter'
  | 'roboto'
  | 'montserrat'
  | 'poppins'
  | 'oswald'
  | 'raleway'
  | 'nunito'
  | 'playfair'
  | 'jetbrains-mono'
  | 'mono'
  | 'serif';
type UrlPosition =
  | 'random'
  | 'center'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';
type UrlAnim = 'fade' | 'zoom' | 'slide-up' | 'pop' | 'lift' | 'none';
type AnimEasingPreset = 'ios' | 'smooth' | 'snappy' | 'linear' | 'custom';
type ScaleMode = 'fixed' | 'range';
type SenderStroke = 'none' | 'glass' | 'solid';
type CreditsTextAlign = 'left' | 'center' | 'right';
type CreditsBackgroundMode = 'transparent' | 'card' | 'full';
type CreditsScrollDirection = 'up' | 'down';
type CreditsAnchorX = 'left' | 'center' | 'right';
type CreditsAnchorY = 'top' | 'center' | 'bottom';
type CreditsTitleTransform = 'none' | 'uppercase' | 'lowercase';

const SENDER_FONT_FAMILIES: ReadonlyArray<SenderFontFamily> = [
  'system',
  'inter',
  'roboto',
  'montserrat',
  'poppins',
  'oswald',
  'raleway',
  'nunito',
  'playfair',
  'jetbrains-mono',
  'mono',
  'serif',
];

function isSenderFontFamily(v: string): v is SenderFontFamily {
  return (SENDER_FONT_FAMILIES as ReadonlyArray<string>).includes(v);
}

const URL_POSITIONS: ReadonlyArray<UrlPosition> = [
  'random',
  'center',
  'top',
  'bottom',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

function isUrlPosition(v: string): v is UrlPosition {
  return (URL_POSITIONS as ReadonlyArray<string>).includes(v);
}

const URL_ANIMS: ReadonlyArray<UrlAnim> = ['fade', 'zoom', 'slide-up', 'pop', 'lift', 'none'];

function isUrlAnim(v: string): v is UrlAnim {
  return (URL_ANIMS as ReadonlyArray<string>).includes(v);
}

function toRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  if (Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function getNumber(obj: Record<string, unknown> | null, key: string): number | undefined {
  const v = obj?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
export function ObsLinksSettings() {
  const { t, i18n } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const { socket, isConnected } = useSocket();

  const channelSlug = user?.channel?.slug || '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const apiOrigin = typeof window !== 'undefined' ? getApiOriginForRedirect() : '';

  const [overlayKind, setOverlayKind] = useState<'memes' | 'credits'>('memes');
  const creditsEnabled = getRuntimeConfig()?.creditsOverlayEnabled !== false;

  useEffect(() => {
    if (!creditsEnabled && overlayKind === 'credits') {
      setOverlayKind('memes');
    }
  }, [creditsEnabled, overlayKind]);

  const [overlayToken, setOverlayToken] = useState<string>('');
  const [loadingToken, setLoadingToken] = useState(false);
  const [previewMemes, setPreviewMemes] = useState<Array<{ fileUrl: string; type: string; title?: string }>>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewInitialized, setPreviewInitialized] = useState(false);
  const [previewLoopEnabled, setPreviewLoopEnabled] = useState<boolean>(true);
  const [previewBg, setPreviewBg] = useState<'twitch' | 'white'>('twitch');
  const [advancedTab, setAdvancedTab] = useState<'layout' | 'animation' | 'shadow' | 'border' | 'glass' | 'sender'>('layout');
  const [previewSeed, setPreviewSeed] = useState<number>(1);
  const [previewPosSeed, setPreviewPosSeed] = useState<number>(1);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewSeedRef = useRef<number>(1);
  const previewCacheRef = useRef(new Map<string, { at: number; memes: Array<{ fileUrl: string; type: string; title?: string }> }>());
  const previewInFlightRef = useRef(new Map<string, Promise<Array<{ fileUrl: string; type: string; title?: string }>>>());
  const overlayReadyRef = useRef(false);
  const [obsUiMode, setObsUiMode] = useState<'basic' | 'pro'>('basic');
  const [previewLockPositions, setPreviewLockPositions] = useState(false);
  const [previewShowSafeGuide, setPreviewShowSafeGuide] = useState(false);
  const safeGuideTimerRef = useRef<number | null>(null);

  const perfRestoreRef = useRef<null | {
    glassEnabled: boolean;
    urlBlur: number;
    urlBgOpacity: number;
    shadowBlur: number;
    shadowSpread: number;
    shadowDistance: number;
  }>(null);
  const [performanceMode, setPerformanceMode] = useState(false);

  const [overlayMode, setOverlayMode] = useState<'queue' | 'simultaneous'>('queue');
  const [overlayShowSender, setOverlayShowSender] = useState(false);
  const [overlayMaxConcurrent, setOverlayMaxConcurrent] = useState<number>(3);
  const [loadingOverlaySettings, setLoadingOverlaySettings] = useState(false);
  const [savingOverlaySettings, setSavingOverlaySettings] = useState(false);
  const [overlaySettingsSavedPulse, setOverlaySettingsSavedPulse] = useState(false);
  const [rotatingOverlayToken, setRotatingOverlayToken] = useState(false);
  const overlaySettingsLoadedRef = useRef<string | null>(null);
  const [lastSavedOverlaySettingsPayload, setLastSavedOverlaySettingsPayload] = useState<string | null>(null);
  const lastChangeRef = useRef<'mode' | 'sender' | null>(null);

  // Credits overlay (twitch chat + DonationAlerts) settings
  const [creditsToken, setCreditsToken] = useState<string>('');
  const [creditsUrl, setCreditsUrl] = useState<string>('');
  const [loadingCreditsToken, setLoadingCreditsToken] = useState(false);
  const [loadingCreditsSettings, setLoadingCreditsSettings] = useState(false);
  const [savingCreditsSettings, setSavingCreditsSettings] = useState(false);
  const [creditsSettingsSavedPulse, setCreditsSettingsSavedPulse] = useState(false);
  const [rotatingCreditsToken, setRotatingCreditsToken] = useState(false);
  const creditsSettingsLoadedRef = useRef<string | null>(null);
  const [lastSavedCreditsSettingsPayload, setLastSavedCreditsSettingsPayload] = useState<string | null>(null);

  const [creditsShowDonors, setCreditsShowDonors] = useState(true);
  const [creditsShowChatters, setCreditsShowChatters] = useState(true);
  const [creditsSectionsOrder, setCreditsSectionsOrder] = useState<Array<'donors' | 'chatters'>>(['donors', 'chatters']);

  const [creditsTitleText, setCreditsTitleText] = useState<string>('Credits');
  const [creditsDonorsTitleText, setCreditsDonorsTitleText] = useState<string>('Donors');
  const [creditsChattersTitleText, setCreditsChattersTitleText] = useState<string>('Chatters');

  const [creditsShowNumbers, setCreditsShowNumbers] = useState<boolean>(true);
  const [creditsShowAvatars, setCreditsShowAvatars] = useState<boolean>(true);
  const [creditsAvatarSize, setCreditsAvatarSize] = useState<number>(32);
  const [creditsAvatarRadius, setCreditsAvatarRadius] = useState<number>(10);

  const [creditsFontFamily, setCreditsFontFamily] = useState<string>('system');
  const [creditsFontSize, setCreditsFontSize] = useState<number>(26);
  const [creditsFontWeight, setCreditsFontWeight] = useState<number>(800);
  const [creditsFontColor, setCreditsFontColor] = useState<string>('#ffffff');

  const [creditsBgOpacity, setCreditsBgOpacity] = useState<number>(0.18);
  const [creditsBlur, setCreditsBlur] = useState<number>(6);
  const [creditsRadius, setCreditsRadius] = useState<number>(20);
  const [creditsShadowBlur, setCreditsShadowBlur] = useState<number>(90);
  const [creditsShadowOpacity, setCreditsShadowOpacity] = useState<number>(0.6);
  const [creditsBgColor, setCreditsBgColor] = useState<string>('#000000');
  const [creditsBackgroundMode, setCreditsBackgroundMode] = useState<'transparent' | 'card' | 'full'>('card');
  const [creditsBorderEnabled, setCreditsBorderEnabled] = useState(false);
  const [creditsBorderWidth, setCreditsBorderWidth] = useState<number>(1);
  const [creditsBorderColor, setCreditsBorderColor] = useState<string>('#ffffff');

  const [creditsAnchorX, setCreditsAnchorX] = useState<'left' | 'center' | 'right'>('center');
  const [creditsAnchorY, setCreditsAnchorY] = useState<'top' | 'center' | 'bottom'>('center');
  // Background insets (distance between background and screen edges)
  const [creditsBgInsetLeft, setCreditsBgInsetLeft] = useState<number>(24);
  const [creditsBgInsetRight, setCreditsBgInsetRight] = useState<number>(24);
  const [creditsBgInsetTop, setCreditsBgInsetTop] = useState<number>(24);
  const [creditsBgInsetBottom, setCreditsBgInsetBottom] = useState<number>(24);
  // Content padding (inside background)
  const [creditsContentPadLeft, setCreditsContentPadLeft] = useState<number>(28);
  const [creditsContentPadRight, setCreditsContentPadRight] = useState<number>(28);
  const [creditsContentPadTop, setCreditsContentPadTop] = useState<number>(28);
  const [creditsContentPadBottom, setCreditsContentPadBottom] = useState<number>(28);
  const [creditsMaxWidthPx, setCreditsMaxWidthPx] = useState<number>(920);
  const [creditsMaxHeightVh, setCreditsMaxHeightVh] = useState<number>(88);
  const [creditsTextAlign, setCreditsTextAlign] = useState<'left' | 'center' | 'right'>('center');
  const [creditsIndentPx, setCreditsIndentPx] = useState<number>(0);

  const [creditsLineHeight, setCreditsLineHeight] = useState<number>(1.15);
  const [creditsLetterSpacing, setCreditsLetterSpacing] = useState<number>(0);
  const [creditsTitleEnabled, setCreditsTitleEnabled] = useState<boolean>(true);
  const [creditsTitleSize, setCreditsTitleSize] = useState<number>(22);
  const [creditsTitleWeight, setCreditsTitleWeight] = useState<number>(800);
  const [creditsTitleColor, setCreditsTitleColor] = useState<string>('#ffffff');
  const [creditsTitleTransform, setCreditsTitleTransform] = useState<'none' | 'uppercase' | 'lowercase'>('none');

  // Text effects (main)
  const [creditsTextShadowBlur, setCreditsTextShadowBlur] = useState<number>(16);
  const [creditsTextShadowOpacity, setCreditsTextShadowOpacity] = useState<number>(0.6);
  const [creditsTextShadowColor, setCreditsTextShadowColor] = useState<string>('#000000');
  const [creditsTextStrokeWidth, setCreditsTextStrokeWidth] = useState<number>(0);
  const [creditsTextStrokeOpacity, setCreditsTextStrokeOpacity] = useState<number>(0.85);
  const [creditsTextStrokeColor, setCreditsTextStrokeColor] = useState<string>('#000000');

  // Text effects (title)
  const [creditsTitleShadowBlur, setCreditsTitleShadowBlur] = useState<number>(18);
  const [creditsTitleShadowOpacity, setCreditsTitleShadowOpacity] = useState<number>(0.7);
  const [creditsTitleShadowColor, setCreditsTitleShadowColor] = useState<string>('#000000');
  const [creditsTitleStrokeWidth, setCreditsTitleStrokeWidth] = useState<number>(0);
  const [creditsTitleStrokeOpacity, setCreditsTitleStrokeOpacity] = useState<number>(0.9);
  const [creditsTitleStrokeColor, setCreditsTitleStrokeColor] = useState<string>('#000000');

  // Credits session state (viewers/chatters, reconnect window, ignore list)
  const [creditsChannelSlug, setCreditsChannelSlug] = useState<string>('');
  const [creditsChatters, setCreditsChatters] = useState<Array<{ name: string; messageCount?: number }>>([]);
  const [loadingCreditsState, setLoadingCreditsState] = useState(false);
  const [resettingCredits, setResettingCredits] = useState(false);

  const [creditsReconnectWindowMinutes, setCreditsReconnectWindowMinutes] = useState<number | null>(null);
  const [creditsReconnectWindowInput, setCreditsReconnectWindowInput] = useState<string>('');
  const [savingReconnectWindow, setSavingReconnectWindow] = useState(false);

  const [creditsIgnoredChatters, setCreditsIgnoredChatters] = useState<string[]>([]);
  const [creditsIgnoredChattersText, setCreditsIgnoredChattersText] = useState<string>('');
  const [loadingIgnoredChatters, setLoadingIgnoredChatters] = useState(false);
  const [savingIgnoredChatters, setSavingIgnoredChatters] = useState(false);

  const [creditsScrollSpeed, setCreditsScrollSpeed] = useState<number>(48);
  const [creditsSectionGapPx, setCreditsSectionGapPx] = useState<number>(24);
  const [creditsLineGapPx, setCreditsLineGapPx] = useState<number>(8);
  const [creditsFadeInMs, setCreditsFadeInMs] = useState<number>(600);
  const [creditsScrollDirection, setCreditsScrollDirection] = useState<'up' | 'down'>('up');
  const [creditsLoop, setCreditsLoop] = useState<boolean>(true);
  const [creditsStartDelayMs, setCreditsStartDelayMs] = useState<number>(0);
  const [creditsEndFadeMs, setCreditsEndFadeMs] = useState<number>(0);

  const [creditsUiMode, setCreditsUiMode] = useState<'quick' | 'advanced'>('quick');
  const [creditsTab, setCreditsTab] = useState<'layout' | 'typography' | 'sections' | 'visual' | 'motion'>('layout');

  // Custom presets are stored locally (per browser) to avoid extra backend complexity.
  const [presetName, setPresetName] = useState('');
  const [customPresets, setCustomPresets] = useState<Array<{ id: string; name: string; createdAt: number; payload: OverlaySharePayload }>>([]);

  useEffect(() => {
    // If sender settings tab is not applicable, fall back to a safe tab.
    if (advancedTab === 'sender' && !overlayShowSender) setAdvancedTab('layout');
  }, [advancedTab, overlayShowSender]);

  // Advanced overlay style (saved server-side; OBS link stays constant).
  const [urlPosition, setUrlPosition] = useState<'random' | 'center' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>(
    'random'
  );
  const [urlVolume, setUrlVolume] = useState<number>(1);
  const [scaleMode, setScaleMode] = useState<'fixed' | 'range'>('fixed');
  const [scaleFixed, setScaleFixed] = useState<number>(1);
  const [scaleMin, setScaleMin] = useState<number>(0.7);
  const [scaleMax, setScaleMax] = useState<number>(1);
  const [urlRadius, setUrlRadius] = useState<number>(20);
  const [urlBlur, setUrlBlur] = useState<number>(6);
  const [urlBorder, setUrlBorder] = useState<number>(2);
  const [safePad, setSafePad] = useState<number>(80);
  // Glass (foreground overlay in the overlay itself)
  const [glassEnabled, setGlassEnabled] = useState<boolean>(false);
  const [glassPreset, setGlassPreset] = useState<'ios' | 'clear' | 'prism'>('ios');
  const [glassTintColor, setGlassTintColor] = useState<string>('#7dd3fc');
  const [glassTintStrength, setGlassTintStrength] = useState<number>(0.22);
  // Border
  const [borderPreset, setBorderPreset] = useState<'custom' | 'glass' | 'glow' | 'frosted'>('custom');
  const [borderTintColor, setBorderTintColor] = useState<string>('#7dd3fc');
  const [borderTintStrength, setBorderTintStrength] = useState<number>(0.35);
  const [borderMode, setBorderMode] = useState<'solid' | 'gradient'>('solid');
  const [urlBorderColor, setUrlBorderColor] = useState<string>('#ffffff');
  const [urlBorderColor2, setUrlBorderColor2] = useState<string>('#00e5ff');
  const [urlBorderGradientAngle, setUrlBorderGradientAngle] = useState<number>(135);
  // Shadow (back-compat: previous "Shadow" slider maps to shadowBlur)
  const [shadowBlur, setShadowBlur] = useState<number>(70);
  const [shadowSpread, setShadowSpread] = useState<number>(0);
  const [shadowDistance, setShadowDistance] = useState<number>(22);
  const [shadowAngle, setShadowAngle] = useState<number>(90);
  const [shadowOpacity, setShadowOpacity] = useState<number>(0.6);
  const [shadowColor, setShadowColor] = useState<string>('#000000');
  const [urlBgOpacity, setUrlBgOpacity] = useState<number>(0.18);
  const [urlAnim, setUrlAnim] = useState<'fade' | 'zoom' | 'slide-up' | 'pop' | 'lift' | 'none'>('fade');
  const [animEasingPreset, setAnimEasingPreset] = useState<'ios' | 'smooth' | 'snappy' | 'linear' | 'custom'>('ios');
  const [animEasingX1, setAnimEasingX1] = useState<number>(0.22);
  const [animEasingY1, setAnimEasingY1] = useState<number>(1);
  const [animEasingX2, setAnimEasingX2] = useState<number>(0.36);
  const [animEasingY2, setAnimEasingY2] = useState<number>(1);
  // Slightly slower "Apple-ish" defaults (less snappy, more premium).
  const [urlEnterMs, setUrlEnterMs] = useState<number>(420);
  const [urlExitMs, setUrlExitMs] = useState<number>(320);
  const [senderFontSize, setSenderFontSize] = useState<number>(13);
  const [senderFontWeight, setSenderFontWeight] = useState<number>(600);
  const [senderFontFamily, setSenderFontFamily] = useState<
    'system' | 'inter' | 'roboto' | 'montserrat' | 'poppins' | 'oswald' | 'raleway' | 'nunito' | 'playfair' | 'jetbrains-mono' | 'mono' | 'serif'
  >('system');
  const [senderFontColor, setSenderFontColor] = useState<string>('#ffffff');
  const [senderHoldMs, setSenderHoldMs] = useState<number>(1200);
  const [senderBgColor, setSenderBgColor] = useState<string>('#000000');
  const [senderBgOpacity, setSenderBgOpacity] = useState<number>(0.62);
  const [senderBgRadius, setSenderBgRadius] = useState<number>(999);
  const [senderStroke, setSenderStroke] = useState<'none' | 'glass' | 'solid'>('glass');
  const [senderStrokeWidth, setSenderStrokeWidth] = useState<number>(1);
  const [senderStrokeOpacity, setSenderStrokeOpacity] = useState<number>(0.22);
  const [senderStrokeColor, setSenderStrokeColor] = useState<string>('#ffffff');

  // Import / Export overlay settings (share codes): extracted to ./obs/lib/shareCode
  const clampIntLocal = clampInt;
  const clampFloatLocal = clampFloat;

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
      setBorderTintStrength(clampFloatLocal(s.borderTintStrength, 0, 1, borderTintStrength));

      const nextBorderMode: BorderMode = s.borderMode === 'gradient' ? 'gradient' : 'solid';
      setBorderMode(nextBorderMode);
      if (isHexColor(s.borderColor)) setUrlBorderColor(String(s.borderColor).toLowerCase());
      if (isHexColor(s.borderColor2)) setUrlBorderColor2(String(s.borderColor2).toLowerCase());
      setUrlBorderGradientAngle(clampIntLocal(s.borderGradientAngle, 0, 360, urlBorderGradientAngle));

      setUrlBorder(clampIntLocal(s.border, 0, 12, urlBorder));
      setUrlRadius(clampIntLocal(s.radius, 0, 80, urlRadius));

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

      setUrlVolume(clampFloatLocal(s.volume, 0, 1, urlVolume));
      const sm = s.scaleMode === 'range' ? 'range' : 'fixed';
      setScaleMode(sm);
      setScaleFixed(clampFloatLocal(s.scaleFixed, 0.25, 2.5, scaleFixed));
      setScaleMin(clampFloatLocal(s.scaleMin, 0.25, 2.5, scaleMin));
      setScaleMax(clampFloatLocal(s.scaleMax, 0.25, 2.5, scaleMax));
      setSafePad(clampIntLocal(s.safePad, 0, 240, safePad));

      const anim = typeof s.anim === 'string' ? s.anim : urlAnim;
      if (anim === 'fade' || anim === 'zoom' || anim === 'slide-up' || anim === 'pop' || anim === 'lift' || anim === 'none') setUrlAnim(anim);
      setUrlEnterMs(clampIntLocal(s.enterMs, 0, 1200, urlEnterMs));
      setUrlExitMs(clampIntLocal(s.exitMs, 0, 1200, urlExitMs));
      const easing = typeof s.easing === 'string' ? s.easing : animEasingPreset;
      if (easing === 'ios' || easing === 'smooth' || easing === 'snappy' || easing === 'linear' || easing === 'custom') setAnimEasingPreset(easing);
      setAnimEasingX1(clampFloatLocal(s.easingX1, -1, 2, animEasingX1));
      setAnimEasingY1(clampFloatLocal(s.easingY1, -1, 2, animEasingY1));
      setAnimEasingX2(clampFloatLocal(s.easingX2, -1, 2, animEasingX2));
      setAnimEasingY2(clampFloatLocal(s.easingY2, -1, 2, animEasingY2));

      setShadowBlur(clampIntLocal(s.shadowBlur, 0, 200, shadowBlur));
      setShadowSpread(clampIntLocal(s.shadowSpread, 0, 120, shadowSpread));
      setShadowDistance(clampIntLocal(s.shadowDistance, 0, 120, shadowDistance));
      setShadowAngle(clampFloatLocal(s.shadowAngle, 0, 360, shadowAngle));
      setShadowOpacity(clampFloatLocal(s.shadowOpacity, 0, 1, shadowOpacity));
      if (isHexColor(s.shadowColor)) setShadowColor(String(s.shadowColor).toLowerCase());

      if (typeof s.glass === 'boolean') setGlassEnabled(s.glass);
      const gp = typeof s.glassPreset === 'string' ? s.glassPreset : glassPreset;
      if (gp === 'ios' || gp === 'clear' || gp === 'prism') setGlassPreset(gp);
      if (isHexColor(s.glassTintColor)) setGlassTintColor(String(s.glassTintColor).toLowerCase());
      setGlassTintStrength(clampFloatLocal(s.glassTintStrength, 0, 1, glassTintStrength));
      setUrlBlur(clampIntLocal(s.blur, 0, 40, urlBlur));
      setUrlBgOpacity(clampFloatLocal(s.bgOpacity, 0, 0.65, urlBgOpacity));

      setSenderHoldMs(clampIntLocal(s.senderHoldMs, 0, 8000, senderHoldMs));
      if (isHexColor(s.senderBgColor)) setSenderBgColor(String(s.senderBgColor).toLowerCase());
      setSenderBgOpacity(clampFloatLocal(s.senderBgOpacity, 0, 1, senderBgOpacity));
      setSenderBgRadius(clampIntLocal(s.senderBgRadius, 0, 999, senderBgRadius));

      const st = typeof s.senderStroke === 'string' ? s.senderStroke : senderStroke;
      if (st === 'none' || st === 'glass' || st === 'solid') setSenderStroke(st);
      setSenderStrokeWidth(clampIntLocal(s.senderStrokeWidth, 0, 6, senderStrokeWidth));
      setSenderStrokeOpacity(clampFloatLocal(s.senderStrokeOpacity, 0, 1, senderStrokeOpacity));
      if (isHexColor(s.senderStrokeColor)) setSenderStrokeColor(String(s.senderStrokeColor).toLowerCase());

      setSenderFontSize(clampIntLocal(s.senderFontSize, 10, 28, senderFontSize));
      setSenderFontWeight(clampIntLocal(s.senderFontWeight, 400, 800, senderFontWeight));
      const ff = typeof s.senderFontFamily === 'string' ? s.senderFontFamily : senderFontFamily;
      if (isSenderFontFamily(ff)) setSenderFontFamily(ff);
      if (isHexColor(s.senderFontColor)) setSenderFontColor(String(s.senderFontColor).toLowerCase());
    },
    [
      clampFloatLocal,
      clampIntLocal,
      animEasingPreset,
      animEasingX1,
      animEasingX2,
      animEasingY1,
      animEasingY2,
      borderTintStrength,
      glassPreset,
      glassTintStrength,
      scaleFixed,
      scaleMax,
      scaleMin,
      safePad,
      senderBgOpacity,
      senderBgRadius,
      senderFontFamily,
      senderFontSize,
      senderFontWeight,
      senderHoldMs,
      senderStroke,
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
        lastChangeRef.current = null;
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

  useEffect(() => {
    if (!channelSlug) return;
    let mounted = true;
    (async () => {
      try {
        setLoadingCreditsToken(true);
        setLoadingCreditsSettings(true);
        const resp = await getCreditsToken();
        if (!mounted) return;
        setCreditsToken(resp?.token || '');
        setCreditsUrl(resp?.url || '');

        let styleFromServer: Record<string, unknown> | null = null;
        const rawStyleJson =
          typeof (resp as { styleJson?: unknown })?.styleJson === 'string'
            ? String((resp as { styleJson?: string }).styleJson)
            : typeof (resp as { creditsStyleJson?: unknown })?.creditsStyleJson === 'string'
              ? String((resp as { creditsStyleJson?: string }).creditsStyleJson)
              : '';
        if (rawStyleJson) {
          try {
            const j: unknown = JSON.parse(rawStyleJson);
            styleFromServer = toRecord(j);
          } catch {
            styleFromServer = null;
          }
        }

        const nextOrder: Array<'donors' | 'chatters'> = Array.isArray(styleFromServer?.sectionsOrder)
          ? styleFromServer.sectionsOrder
              .map((v: unknown) => String(v || '').trim().toLowerCase())
              .filter((v: string) => v === 'donors' || v === 'chatters')
          : creditsSectionsOrder;
        const nextShowDonors = typeof styleFromServer?.showDonors === 'boolean' ? styleFromServer.showDonors : creditsShowDonors;
        const nextShowChatters = typeof styleFromServer?.showChatters === 'boolean' ? styleFromServer.showChatters : creditsShowChatters;

        const nextTitleText = typeof styleFromServer?.titleText === 'string' ? styleFromServer.titleText : creditsTitleText;
        const nextDonorsTitleText = typeof styleFromServer?.donorsTitleText === 'string' ? styleFromServer.donorsTitleText : creditsDonorsTitleText;
        const nextChattersTitleText =
          typeof styleFromServer?.chattersTitleText === 'string' ? styleFromServer.chattersTitleText : creditsChattersTitleText;

        const nextShowNumbers = typeof styleFromServer?.showNumbers === 'boolean' ? styleFromServer.showNumbers : creditsShowNumbers;
        const nextShowAvatars = typeof styleFromServer?.showAvatars === 'boolean' ? styleFromServer.showAvatars : creditsShowAvatars;
        const nextAvatarSize = typeof styleFromServer?.avatarSize === 'number' ? styleFromServer.avatarSize : creditsAvatarSize;
        const nextAvatarRadius = typeof styleFromServer?.avatarRadius === 'number' ? styleFromServer.avatarRadius : creditsAvatarRadius;

        const nextFontFamily = typeof styleFromServer?.fontFamily === 'string' ? styleFromServer.fontFamily : creditsFontFamily;
        const nextFontSize = typeof styleFromServer?.fontSize === 'number' ? styleFromServer.fontSize : creditsFontSize;
        const nextFontWeight = typeof styleFromServer?.fontWeight === 'number' ? styleFromServer.fontWeight : creditsFontWeight;
        const nextFontColor = typeof styleFromServer?.fontColor === 'string' ? styleFromServer.fontColor : creditsFontColor;

        const nextBgOpacity = typeof styleFromServer?.bgOpacity === 'number' ? styleFromServer.bgOpacity : creditsBgOpacity;
        const nextBlur = typeof styleFromServer?.blur === 'number' ? styleFromServer.blur : creditsBlur;
        const nextRadius = typeof styleFromServer?.radius === 'number' ? styleFromServer.radius : creditsRadius;
        const nextShadowBlur = typeof styleFromServer?.shadowBlur === 'number' ? styleFromServer.shadowBlur : creditsShadowBlur;
        const nextShadowOpacity = typeof styleFromServer?.shadowOpacity === 'number' ? styleFromServer.shadowOpacity : creditsShadowOpacity;
        const nextBgColor = typeof styleFromServer?.bgColor === 'string' ? styleFromServer.bgColor : creditsBgColor;
        const nextBackgroundMode: 'transparent' | 'card' | 'full' =
          styleFromServer?.backgroundMode === 'transparent'
            ? 'transparent'
            : styleFromServer?.backgroundMode === 'full'
              ? 'full'
              : 'card';
        const nextBorderEnabled = typeof styleFromServer?.borderEnabled === 'boolean' ? styleFromServer.borderEnabled : creditsBorderEnabled;
        const nextBorderWidth = typeof styleFromServer?.borderWidth === 'number' ? styleFromServer.borderWidth : creditsBorderWidth;
        const nextBorderColor = typeof styleFromServer?.borderColor === 'string' ? styleFromServer.borderColor : creditsBorderColor;

        const nextAnchorX: 'left' | 'center' | 'right' =
          styleFromServer?.anchorX === 'left' ? 'left' : styleFromServer?.anchorX === 'right' ? 'right' : 'center';
        const nextAnchorY: 'top' | 'center' | 'bottom' =
          styleFromServer?.anchorY === 'top' ? 'top' : styleFromServer?.anchorY === 'bottom' ? 'bottom' : 'center';
        // Back-compat: old padX/padY -> use as bg inset defaults if new fields are missing
        const padXLegacy = typeof styleFromServer?.padX === 'number' ? styleFromServer.padX : 24;
        const padYLegacy = typeof styleFromServer?.padY === 'number' ? styleFromServer.padY : 24;

        const nextBgInsetLeft = typeof styleFromServer?.bgInsetLeft === 'number' ? styleFromServer.bgInsetLeft : creditsBgInsetLeft ?? padXLegacy;
        const nextBgInsetRight = typeof styleFromServer?.bgInsetRight === 'number' ? styleFromServer.bgInsetRight : creditsBgInsetRight ?? padXLegacy;
        const nextBgInsetTop = typeof styleFromServer?.bgInsetTop === 'number' ? styleFromServer.bgInsetTop : creditsBgInsetTop ?? padYLegacy;
        const nextBgInsetBottom = typeof styleFromServer?.bgInsetBottom === 'number' ? styleFromServer.bgInsetBottom : creditsBgInsetBottom ?? padYLegacy;

        const nextContentPadLeft =
          typeof styleFromServer?.contentPadLeft === 'number' ? styleFromServer.contentPadLeft : creditsContentPadLeft;
        const nextContentPadRight =
          typeof styleFromServer?.contentPadRight === 'number' ? styleFromServer.contentPadRight : creditsContentPadRight;
        const nextContentPadTop =
          typeof styleFromServer?.contentPadTop === 'number' ? styleFromServer.contentPadTop : creditsContentPadTop;
        const nextContentPadBottom =
          typeof styleFromServer?.contentPadBottom === 'number' ? styleFromServer.contentPadBottom : creditsContentPadBottom;
        const nextMaxWidthPx = typeof styleFromServer?.maxWidthPx === 'number' ? styleFromServer.maxWidthPx : creditsMaxWidthPx;
        const nextMaxHeightVh = typeof styleFromServer?.maxHeightVh === 'number' ? styleFromServer.maxHeightVh : creditsMaxHeightVh;
        const nextTextAlign: 'left' | 'center' | 'right' =
          styleFromServer?.textAlign === 'left' ? 'left' : styleFromServer?.textAlign === 'right' ? 'right' : 'center';
        const nextIndentPx = typeof styleFromServer?.indentPx === 'number' ? styleFromServer.indentPx : creditsIndentPx;

        const nextLineHeight = typeof styleFromServer?.lineHeight === 'number' ? styleFromServer.lineHeight : creditsLineHeight;
        const nextLetterSpacing =
          typeof styleFromServer?.letterSpacing === 'number' ? styleFromServer.letterSpacing : creditsLetterSpacing;
        const nextTitleEnabled = typeof styleFromServer?.titleEnabled === 'boolean' ? styleFromServer.titleEnabled : creditsTitleEnabled;
        const nextTitleSize =
          typeof styleFromServer?.titleSize === 'number' ? styleFromServer.titleSize : Math.round((typeof nextFontSize === 'number' ? nextFontSize : creditsFontSize) * 0.85);
        const nextTitleWeight =
          typeof styleFromServer?.titleWeight === 'number' ? styleFromServer.titleWeight : typeof nextFontWeight === 'number' ? nextFontWeight : creditsFontWeight;
        const nextTitleColor = typeof styleFromServer?.titleColor === 'string' ? styleFromServer.titleColor : nextFontColor;
        const nextTitleTransform: 'none' | 'uppercase' | 'lowercase' =
          styleFromServer?.titleTransform === 'uppercase'
            ? 'uppercase'
            : styleFromServer?.titleTransform === 'lowercase'
              ? 'lowercase'
              : 'none';

        const nextTextShadowBlur =
          typeof styleFromServer?.textShadowBlur === 'number' ? styleFromServer.textShadowBlur : creditsTextShadowBlur;
        const nextTextShadowOpacity =
          typeof styleFromServer?.textShadowOpacity === 'number' ? styleFromServer.textShadowOpacity : creditsTextShadowOpacity;
        const nextTextShadowColor =
          typeof styleFromServer?.textShadowColor === 'string' ? styleFromServer.textShadowColor : creditsTextShadowColor;
        const nextTextStrokeWidth =
          typeof styleFromServer?.textStrokeWidth === 'number' ? styleFromServer.textStrokeWidth : creditsTextStrokeWidth;
        const nextTextStrokeOpacity =
          typeof styleFromServer?.textStrokeOpacity === 'number' ? styleFromServer.textStrokeOpacity : creditsTextStrokeOpacity;
        const nextTextStrokeColor =
          typeof styleFromServer?.textStrokeColor === 'string' ? styleFromServer.textStrokeColor : creditsTextStrokeColor;

        const nextTitleShadowBlur =
          typeof styleFromServer?.titleShadowBlur === 'number' ? styleFromServer.titleShadowBlur : creditsTitleShadowBlur;
        const nextTitleShadowOpacity =
          typeof styleFromServer?.titleShadowOpacity === 'number' ? styleFromServer.titleShadowOpacity : creditsTitleShadowOpacity;
        const nextTitleShadowColor =
          typeof styleFromServer?.titleShadowColor === 'string' ? styleFromServer.titleShadowColor : creditsTitleShadowColor;
        const nextTitleStrokeWidth =
          typeof styleFromServer?.titleStrokeWidth === 'number' ? styleFromServer.titleStrokeWidth : creditsTitleStrokeWidth;
        const nextTitleStrokeOpacity =
          typeof styleFromServer?.titleStrokeOpacity === 'number' ? styleFromServer.titleStrokeOpacity : creditsTitleStrokeOpacity;
        const nextTitleStrokeColor =
          typeof styleFromServer?.titleStrokeColor === 'string' ? styleFromServer.titleStrokeColor : creditsTitleStrokeColor;

        const nextScrollSpeed = typeof styleFromServer?.scrollSpeed === 'number' ? styleFromServer.scrollSpeed : creditsScrollSpeed;
        const nextSectionGapPx = typeof styleFromServer?.sectionGapPx === 'number' ? styleFromServer.sectionGapPx : creditsSectionGapPx;
        const nextLineGapPx = typeof styleFromServer?.lineGapPx === 'number' ? styleFromServer.lineGapPx : creditsLineGapPx;
        const nextFadeInMs = typeof styleFromServer?.fadeInMs === 'number' ? styleFromServer.fadeInMs : creditsFadeInMs;
        const nextScrollDirection: 'up' | 'down' = styleFromServer?.scrollDirection === 'down' ? 'down' : 'up';
        const nextLoop = typeof styleFromServer?.loop === 'boolean' ? styleFromServer.loop : creditsLoop;
        const nextStartDelayMs = typeof styleFromServer?.startDelayMs === 'number' ? styleFromServer.startDelayMs : creditsStartDelayMs;
        const nextEndFadeMs = typeof styleFromServer?.endFadeMs === 'number' ? styleFromServer.endFadeMs : creditsEndFadeMs;

        setCreditsSectionsOrder(nextOrder.length ? nextOrder : ['donors', 'chatters']);
        setCreditsShowDonors(Boolean(nextShowDonors));
        setCreditsShowChatters(Boolean(nextShowChatters));

        setCreditsTitleText(String(nextTitleText || 'Credits'));
        setCreditsDonorsTitleText(String(nextDonorsTitleText || 'Donors'));
        setCreditsChattersTitleText(String(nextChattersTitleText || 'Chatters'));

        setCreditsShowNumbers(Boolean(nextShowNumbers));
        setCreditsShowAvatars(Boolean(nextShowAvatars));
        setCreditsAvatarSize(Math.max(12, Math.min(96, Math.round(nextAvatarSize))));
        setCreditsAvatarRadius(Math.max(0, Math.min(999, Math.round(nextAvatarRadius))));

        setCreditsFontFamily(String(nextFontFamily || 'system'));
        setCreditsFontSize(Math.max(10, Math.min(64, Math.round(nextFontSize))));
        setCreditsFontWeight(Math.max(300, Math.min(900, Math.round(nextFontWeight))));
        setCreditsFontColor(String(nextFontColor || '#ffffff').toLowerCase());

        setCreditsBgOpacity(Math.max(0, Math.min(0.85, Number(nextBgOpacity) || 0)));
        setCreditsBlur(Math.max(0, Math.min(40, Math.round(nextBlur))));
        setCreditsRadius(Math.max(0, Math.min(80, Math.round(nextRadius))));
        setCreditsShadowBlur(Math.max(0, Math.min(240, Math.round(nextShadowBlur))));
        setCreditsShadowOpacity(Math.max(0, Math.min(1, Number(nextShadowOpacity) || 0)));
        setCreditsBgColor(String(nextBgColor || '#000000').toLowerCase());
        setCreditsBackgroundMode(nextBackgroundMode);
        setCreditsBorderEnabled(Boolean(nextBorderEnabled));
        setCreditsBorderWidth(Math.max(0, Math.min(16, Math.round(nextBorderWidth))));
        setCreditsBorderColor(String(nextBorderColor || '#ffffff').toLowerCase());

        setCreditsAnchorX(nextAnchorX);
        setCreditsAnchorY(nextAnchorY);
        setCreditsBgInsetLeft(Math.max(0, Math.min(600, Math.round(nextBgInsetLeft))));
        setCreditsBgInsetRight(Math.max(0, Math.min(600, Math.round(nextBgInsetRight))));
        setCreditsBgInsetTop(Math.max(0, Math.min(600, Math.round(nextBgInsetTop))));
        setCreditsBgInsetBottom(Math.max(0, Math.min(600, Math.round(nextBgInsetBottom))));

        setCreditsContentPadLeft(Math.max(0, Math.min(240, Math.round(nextContentPadLeft))));
        setCreditsContentPadRight(Math.max(0, Math.min(240, Math.round(nextContentPadRight))));
        setCreditsContentPadTop(Math.max(0, Math.min(240, Math.round(nextContentPadTop))));
        setCreditsContentPadBottom(Math.max(0, Math.min(240, Math.round(nextContentPadBottom))));
        setCreditsMaxWidthPx(Math.max(240, Math.min(2400, Math.round(nextMaxWidthPx))));
        setCreditsMaxHeightVh(Math.max(20, Math.min(100, Math.round(nextMaxHeightVh))));
        setCreditsTextAlign(nextTextAlign);
        setCreditsIndentPx(Math.max(0, Math.min(240, Math.round(nextIndentPx))));

        setCreditsLineHeight(Math.max(0.9, Math.min(2.2, Number(nextLineHeight) || 1.15)));
        setCreditsLetterSpacing(Math.max(-2, Math.min(8, Number(nextLetterSpacing) || 0)));
        setCreditsTitleEnabled(Boolean(nextTitleEnabled));
        setCreditsTitleSize(Math.max(10, Math.min(64, Math.round(nextTitleSize))));
        setCreditsTitleWeight(Math.max(300, Math.min(900, Math.round(nextTitleWeight))));
        setCreditsTitleColor(String(nextTitleColor || '#ffffff').toLowerCase());
        setCreditsTitleTransform(nextTitleTransform);

        setCreditsTextShadowBlur(Math.max(0, Math.min(120, Math.round(nextTextShadowBlur))));
        setCreditsTextShadowOpacity(Math.max(0, Math.min(1, Number(nextTextShadowOpacity) || 0)));
        setCreditsTextShadowColor(String(nextTextShadowColor || '#000000').toLowerCase());
        setCreditsTextStrokeWidth(Math.max(0, Math.min(6, Number(nextTextStrokeWidth) || 0)));
        setCreditsTextStrokeOpacity(Math.max(0, Math.min(1, Number(nextTextStrokeOpacity) || 0)));
        setCreditsTextStrokeColor(String(nextTextStrokeColor || '#000000').toLowerCase());

        setCreditsTitleShadowBlur(Math.max(0, Math.min(120, Math.round(nextTitleShadowBlur))));
        setCreditsTitleShadowOpacity(Math.max(0, Math.min(1, Number(nextTitleShadowOpacity) || 0)));
        setCreditsTitleShadowColor(String(nextTitleShadowColor || '#000000').toLowerCase());
        setCreditsTitleStrokeWidth(Math.max(0, Math.min(6, Number(nextTitleStrokeWidth) || 0)));
        setCreditsTitleStrokeOpacity(Math.max(0, Math.min(1, Number(nextTitleStrokeOpacity) || 0)));
        setCreditsTitleStrokeColor(String(nextTitleStrokeColor || '#000000').toLowerCase());

        setCreditsScrollSpeed(Math.max(8, Math.min(600, Number(nextScrollSpeed) || 48)));
        setCreditsSectionGapPx(Math.max(0, Math.min(120, Math.round(nextSectionGapPx))));
        setCreditsLineGapPx(Math.max(0, Math.min(80, Math.round(nextLineGapPx))));
        setCreditsFadeInMs(Math.max(0, Math.min(5000, Math.round(nextFadeInMs))));
        setCreditsScrollDirection(nextScrollDirection);
        setCreditsLoop(Boolean(nextLoop));
        setCreditsStartDelayMs(Math.max(0, Math.min(60000, Math.round(nextStartDelayMs))));
        setCreditsEndFadeMs(Math.max(0, Math.min(60000, Math.round(nextEndFadeMs))));

        const baselineStyleJson = JSON.stringify({
          anchorX: nextAnchorX,
          anchorY: nextAnchorY,
          bgInsetLeft: nextBgInsetLeft,
          bgInsetRight: nextBgInsetRight,
          bgInsetTop: nextBgInsetTop,
          bgInsetBottom: nextBgInsetBottom,
          maxWidthPx: nextMaxWidthPx,
          maxHeightVh: nextMaxHeightVh,
          textAlign: nextTextAlign,
          contentPadLeft: nextContentPadLeft,
          contentPadRight: nextContentPadRight,
          contentPadTop: nextContentPadTop,
          contentPadBottom: nextContentPadBottom,
          sectionsOrder: nextOrder.length ? nextOrder : ['donors', 'chatters'],
          showDonors: Boolean(nextShowDonors),
          showChatters: Boolean(nextShowChatters),
          titleText: nextTitleText,
          donorsTitleText: nextDonorsTitleText,
          chattersTitleText: nextChattersTitleText,
          showNumbers: Boolean(nextShowNumbers),
          showAvatars: Boolean(nextShowAvatars),
          avatarSize: nextAvatarSize,
          avatarRadius: nextAvatarRadius,
          fontFamily: nextFontFamily,
          fontSize: nextFontSize,
          fontWeight: nextFontWeight,
          fontColor: nextFontColor,
          lineHeight: nextLineHeight,
          letterSpacing: nextLetterSpacing,
          titleEnabled: Boolean(nextTitleEnabled),
          titleSize: nextTitleSize,
          titleWeight: nextTitleWeight,
          titleColor: nextTitleColor,
          titleTransform: nextTitleTransform,
          textShadowBlur: nextTextShadowBlur,
          textShadowOpacity: nextTextShadowOpacity,
          textShadowColor: nextTextShadowColor,
          textStrokeWidth: nextTextStrokeWidth,
          textStrokeOpacity: nextTextStrokeOpacity,
          textStrokeColor: nextTextStrokeColor,
          titleShadowBlur: nextTitleShadowBlur,
          titleShadowOpacity: nextTitleShadowOpacity,
          titleShadowColor: nextTitleShadowColor,
          titleStrokeWidth: nextTitleStrokeWidth,
          titleStrokeOpacity: nextTitleStrokeOpacity,
          titleStrokeColor: nextTitleStrokeColor,
          backgroundMode: nextBackgroundMode,
          bgColor: nextBgColor,
          bgOpacity: nextBgOpacity,
          blur: nextBlur,
          radius: nextRadius,
          shadowBlur: nextShadowBlur,
          shadowOpacity: nextShadowOpacity,
          borderEnabled: Boolean(nextBorderEnabled),
          borderWidth: nextBorderWidth,
          borderColor: nextBorderColor,
          scrollSpeed: nextScrollSpeed,
          scrollDirection: nextScrollDirection,
          loop: Boolean(nextLoop),
          startDelayMs: nextStartDelayMs,
          endFadeMs: nextEndFadeMs,
          sectionGapPx: nextSectionGapPx,
          lineGapPx: nextLineGapPx,
          indentPx: nextIndentPx,
          fadeInMs: nextFadeInMs,
        });
        setLastSavedCreditsSettingsPayload(baselineStyleJson);
        creditsSettingsLoadedRef.current = channelSlug;
      } catch {
        if (mounted) {
          setCreditsToken('');
          setCreditsUrl('');
        }
      } finally {
        if (mounted) setLoadingCreditsToken(false);
        if (mounted) setLoadingCreditsSettings(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelSlug]);

  const loadCreditsState = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!channelSlug) return;
      if (!opts?.silent) setLoadingCreditsState(true);
      try {
        const resp = await getCreditsState();
        const slug =
          typeof (resp as { channelSlug?: unknown })?.channelSlug === 'string'
            ? String((resp as { channelSlug?: string }).channelSlug || '').trim()
            : String(channelSlug || '').trim();
        if (slug) setCreditsChannelSlug(slug);
        const chattersRaw = Array.isArray(resp?.chatters) ? resp.chatters : [];
        const normalizedChatters = chattersRaw
          .map((c) => {
            const name = String(
              (c as { displayName?: unknown })?.displayName ?? (c as { name?: unknown })?.name ?? ''
            )
              .trim();
            if (!name) return null;
            const messageCount =
              typeof (c as { messageCount?: unknown })?.messageCount === 'number'
                ? (c as { messageCount: number }).messageCount
                : undefined;
            return { name, messageCount };
          })
          .filter((c): c is { name: string; messageCount?: number } => !!c);
        setCreditsChatters(normalizedChatters);

        // Back-compat: if backend also includes reconnect window in state, use it.
        const reconnectSeconds =
          typeof (resp as { reconnectWindowSeconds?: unknown })?.reconnectWindowSeconds === 'number'
            ? (resp as { reconnectWindowSeconds: number }).reconnectWindowSeconds
            : typeof (resp as { creditsReconnectWindowMinutes?: unknown })?.creditsReconnectWindowMinutes === 'number'
              ? Math.max(0, Math.round((resp as { creditsReconnectWindowMinutes: number }).creditsReconnectWindowMinutes * 60))
              : null;
        if (typeof reconnectSeconds === 'number' && Number.isFinite(reconnectSeconds)) {
          const minutes = Math.max(0, Math.round(reconnectSeconds / 60));
          setCreditsReconnectWindowMinutes(minutes);
          setCreditsReconnectWindowInput(String(minutes));
        }
      } catch (error: unknown) {
        if (!opts?.silent) {
          const apiError = error as { response?: { data?: { error?: string } } };
          toast.error(apiError.response?.data?.error || t('admin.failedToLoad', { defaultValue: 'Failed to load' }));
        }
      } finally {
        if (!opts?.silent) setLoadingCreditsState(false);
      }
    },
    [channelSlug, t]
  );

  const loadCreditsIgnoredChatters = useCallback(async () => {
    if (!channelSlug) return;
    setLoadingIgnoredChatters(true);
    try {
      const resp = await getIgnoredChatters();
      const list = Array.isArray(resp?.chatters) ? resp.chatters : [];
      const cleaned = list.map((v) => String(v || '').trim()).filter(Boolean);
      setCreditsIgnoredChatters(cleaned);
      setCreditsIgnoredChattersText(cleaned.join('\n'));
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: { error?: string } } };
      if (err?.response?.status !== 404) {
        toast.error(err.response?.data?.error || t('admin.failedToLoad', { defaultValue: 'Failed to load' }));
      }
    } finally {
      setLoadingIgnoredChatters(false);
    }
  }, [channelSlug, t]);

  const loadCreditsReconnectWindow = useCallback(async () => {
    if (!channelSlug) return;
    try {
      const resp = await getReconnectWindow();
      const seconds =
        typeof resp?.seconds === 'number'
          ? resp.seconds
          : typeof (resp as { creditsReconnectWindowMinutes?: unknown })?.creditsReconnectWindowMinutes === 'number'
            ? Math.round((resp as { creditsReconnectWindowMinutes: number }).creditsReconnectWindowMinutes * 60)
            : null;
      if (typeof seconds === 'number' && Number.isFinite(seconds)) {
        const minutes = Math.max(0, Math.round(seconds / 60));
        setCreditsReconnectWindowMinutes(minutes);
        setCreditsReconnectWindowInput(String(minutes));
      }
    } catch {
      // ignore (back-compat)
    }
  }, [channelSlug]);

  const saveCreditsReconnectWindow = useCallback(async () => {
    const raw = String(creditsReconnectWindowInput || '').trim();
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < 0) {
      toast.error(t('admin.invalidValue', { defaultValue: 'Invalid value' }));
      return;
    }

    const startedAt = Date.now();
    setSavingReconnectWindow(true);
    try {
      const seconds = Math.max(0, Math.round(minutes * 60));
      await setReconnectWindow(seconds);
      setCreditsReconnectWindowMinutes(minutes);
      setCreditsReconnectWindowInput(String(minutes));
      toast.success(t('admin.settingsSaved', { defaultValue: 'Saved' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save' }));
    } finally {
      await ensureMinDuration(startedAt, 450);
      setSavingReconnectWindow(false);
    }
  }, [creditsReconnectWindowInput, t]);

  const resetCreditsSession = useCallback(async () => {
    const confirmed = window.confirm(
      t('admin.creditsResetConfirm', {
        defaultValue: 'Сбросить список зрителей? После этого начнётся новый список для следующей трансляции.',
      })
    );
    if (!confirmed) return;

    const startedAt = Date.now();
    setResettingCredits(true);
    try {
      await resetCreditsSessionApi();
      await loadCreditsState({ silent: true });
      toast.success(t('admin.done', { defaultValue: 'Done' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save' }));
    } finally {
      await ensureMinDuration(startedAt, 450);
      setResettingCredits(false);
    }
  }, [loadCreditsState, t]);

  const saveCreditsIgnoredChatters = useCallback(async () => {
    const lines = String(creditsIgnoredChattersText || '')
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean);

    const startedAt = Date.now();
    setSavingIgnoredChatters(true);
    try {
      await setIgnoredChatters(lines);
      const cleaned = lines.map((v) => String(v || '').trim()).filter(Boolean);
      setCreditsIgnoredChatters(cleaned);
      setCreditsIgnoredChattersText(cleaned.join('\n'));
      toast.success(t('admin.settingsSaved', { defaultValue: 'Saved' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save' }));
    } finally {
      await ensureMinDuration(startedAt, 450);
      setSavingIgnoredChatters(false);
    }
  }, [creditsIgnoredChattersText, t]);

  // Initial credits loads when switching to "Credits" tab.
  useEffect(() => {
    if (!channelSlug) return;
    if (overlayKind !== 'credits') return;
    void loadCreditsState();
    void loadCreditsIgnoredChatters();
    void loadCreditsReconnectWindow();
  }, [channelSlug, loadCreditsIgnoredChatters, loadCreditsReconnectWindow, loadCreditsState, overlayKind]);

  // Live updates via Socket.IO (uses auth cookie).
  useEffect(() => {
    if (!socket || !isConnected) return;
    if (overlayKind !== 'credits') return;
    const slug = String(creditsChannelSlug || channelSlug || '').trim();
    if (!slug) return;

    socket.emit('join:channel', slug);

    const onCreditsState = (
      incoming: { chatters?: Array<{ displayName?: string; name?: string; messageCount?: number }> } | null | undefined
    ) => {
      const next = Array.isArray(incoming?.chatters) ? incoming!.chatters! : [];
      const normalized = next
        .map((c) => {
          const name = String(c?.displayName ?? c?.name ?? '').trim();
          if (!name) return null;
          const messageCount = typeof c?.messageCount === 'number' ? c.messageCount : undefined;
          return { name, messageCount };
        })
        .filter((c): c is { name: string; messageCount?: number } => !!c);
      setCreditsChatters(normalized);
    };

    socket.on('credits:state', onCreditsState);
    return () => {
      socket.off('credits:state', onCreditsState);
    };
  }, [channelSlug, creditsChannelSlug, isConnected, overlayKind, socket]);

  const previewCount = useMemo(
    () => (overlayMode === 'queue' ? 1 : Math.min(5, Math.max(1, overlayMaxConcurrent))),
    [overlayMaxConcurrent, overlayMode]
  );

  useEffect(() => {
    previewSeedRef.current = previewSeed;
  }, [previewSeed]);

  useEffect(() => {
    // Keep position seed bounded.
    if (previewPosSeed < 0 || previewPosSeed > 1000000000) setPreviewPosSeed(1);
  }, [previewPosSeed]);

  const fetchPreviewMemes = useCallback(async (count?: number, seed?: number, opts?: { commitSeed?: boolean }) => {
    const n = Math.min(5, Math.max(1, Number.isFinite(count) ? Number(count) : previewCount));
    const PREVIEW_TTL_MS = 5_000;
    try {
      const { api } = await import('@/lib/api');
      const effectiveSeed = Number.isFinite(seed) ? String(seed) : String(previewSeedRef.current || 1);
      const cacheKey = `${n}:${effectiveSeed}`;

      // TTL cache (best-effort). Avoids repeated hits while user tweaks unrelated settings.
      const now = Date.now();
      const mem = previewCacheRef.current.get(cacheKey);
      if (mem && now - mem.at < PREVIEW_TTL_MS) {
        setPreviewMemes(mem.memes);
        if (opts?.commitSeed && Number.isFinite(seed)) {
          previewSeedRef.current = seed!;
          setPreviewSeed(seed!);
        }
        return;
      }
      try {
        const raw = sessionStorage.getItem(`memalerts:obsLinks:previewMemes:${cacheKey}`);
        if (raw) {
          const parsed = JSON.parse(raw) as { at?: unknown; memes?: unknown };
          const at = typeof parsed?.at === 'number' ? parsed.at : 0;
          const cached = Array.isArray(parsed?.memes) ? (parsed.memes as Array<{ fileUrl: string; type: string; title?: string }>) : null;
          if (at > 0 && cached && now - at < PREVIEW_TTL_MS) {
            previewCacheRef.current.set(cacheKey, { at, memes: cached });
            setPreviewMemes(cached);
            if (opts?.commitSeed && Number.isFinite(seed)) {
              previewSeedRef.current = seed!;
              setPreviewSeed(seed!);
            }
            return;
          }
        }
      } catch {
        // ignore cache
      }

      setLoadingPreview(true);

      const existing = previewInFlightRef.current.get(cacheKey);
      if (existing) {
        const memes = await existing;
        setPreviewMemes(memes);
        if (opts?.commitSeed && Number.isFinite(seed)) {
          previewSeedRef.current = seed!;
          setPreviewSeed(seed!);
        }
        return;
      }

      const req = (async () => {
        const resp = await api.get<{ memes: Array<null | { fileUrl: string; type: string; title?: string }> }>(
          '/streamer/overlay/preview-memes',
          {
            params: { count: n, seed: effectiveSeed, _ts: Date.now() },
            headers: { 'Cache-Control': 'no-store' },
          }
        );

        const list = Array.isArray(resp?.memes) ? resp.memes : [];
        const cleaned: Array<{ fileUrl: string; type: string; title?: string }> = [];
        const seen = new Set<string>();
        for (const m of list) {
          if (!m?.fileUrl) continue;
          if (seen.has(m.fileUrl)) continue;
          seen.add(m.fileUrl);
          cleaned.push({ fileUrl: m.fileUrl, type: m.type, title: m.title });
        }
        return cleaned;
      })();

      previewInFlightRef.current.set(cacheKey, req);
      const cleaned = await req;
      previewInFlightRef.current.delete(cacheKey);

      previewCacheRef.current.set(cacheKey, { at: now, memes: cleaned });
      try {
        sessionStorage.setItem(`memalerts:obsLinks:previewMemes:${cacheKey}`, JSON.stringify({ at: now, memes: cleaned }));
      } catch {
        // ignore cache write
      }

      setPreviewMemes(cleaned);

      // Optional: commit the seed atomically together with the new preview set.
      // This prevents a two-step UI update (seed first, urls later) that can cause overlay reseed twice.
      if (opts?.commitSeed && Number.isFinite(seed)) {
        previewSeedRef.current = seed!;
        setPreviewSeed(seed!);
      }
    } catch {
      previewInFlightRef.current.clear();
      setPreviewMemes([]);
    } finally {
      setLoadingPreview(false);
    }
  }, [previewCount]);

  useEffect(() => {
    if (!channelSlug) return;
    void fetchPreviewMemes(previewCount, previewSeedRef.current).finally(() => setPreviewInitialized(true));
  }, [channelSlug, fetchPreviewMemes, previewCount]);

  // Overlay is deployed under /overlay/ and expects /overlay/t/:token
  const overlayUrl = overlayToken ? `${origin}/overlay/t/${overlayToken}` : '';
  const creditsUrlResolved = creditsUrl || (creditsToken ? `${apiOrigin || origin}/overlay/credits/t/${creditsToken}` : '');

  // OBS URL should stay constant.
  const overlayUrlWithDefaults = overlayUrl;
  const creditsUrlWithDefaults = creditsUrlResolved;

  // Preview iframe URL should be stable while tweaking sliders (avoid network reloads).
  // Preview media + seed are pushed via postMessage; iframe src should stay stable.
  const overlayPreviewBaseUrl = useMemo(() => {
    if (!overlayUrl) return '';
    const u = new URL(overlayUrl);
    u.searchParams.set('demo', '1');
    return u.toString();
  }, [overlayUrl]);

  const creditsPreviewBaseUrl = useMemo(() => {
    if (!creditsUrlResolved) return '';
    const u = new URL(creditsUrlResolved);
    u.searchParams.set('demo', '1');
    return u.toString();
  }, [creditsUrlResolved]);

  const overlayPreviewParams = useMemo(() => {
    // These values are pushed into the iframe via postMessage to avoid reloading.
    const target = Math.min(5, Math.max(1, previewCount));
    const pool = previewMemes.length > 0 ? previewMemes : [];
    const urls: string[] = [];
    const types: string[] = [];
    for (let i = 0; i < target; i++) {
      const m = pool[i % Math.max(1, pool.length)];
      if (m?.fileUrl) urls.push(m.fileUrl);
      if (m?.type) types.push(m.type);
    }

    const p: Record<string, string> = {
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
      p.scaleFixed = String(scaleFixed);
      p.scale = String(scaleFixed);
    } else {
      p.scaleMin = String(scaleMin);
      p.scaleMax = String(scaleMax);
    }
    return p;
  }, [
    borderPreset,
    borderTintColor,
    borderTintStrength,
    borderMode,
    safePad,
    glassEnabled,
    glassPreset,
    glassTintColor,
    glassTintStrength,
    overlayMode,
    previewCount,
    previewLoopEnabled,
    previewMemes,
    previewSeed,
    previewPosSeed,
    scaleFixed,
    scaleMax,
    scaleMin,
    scaleMode,
    senderBgColor,
    senderBgOpacity,
    senderBgRadius,
    senderStroke,
    senderStrokeWidth,
    senderStrokeOpacity,
    senderStrokeColor,
    overlayShowSender,
    senderFontFamily,
    senderFontColor,
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
    previewBg,
    previewLockPositions,
    previewShowSafeGuide,
    animEasingPreset,
    animEasingX1,
    animEasingX2,
    animEasingY1,
    animEasingY2,
  ]);

  const creditsStyleJson = useMemo(() => {
    return JSON.stringify({
      anchorX: creditsAnchorX,
      anchorY: creditsAnchorY,
      bgInsetLeft: creditsBgInsetLeft,
      bgInsetRight: creditsBgInsetRight,
      bgInsetTop: creditsBgInsetTop,
      bgInsetBottom: creditsBgInsetBottom,
      maxWidthPx: creditsMaxWidthPx,
      maxHeightVh: creditsMaxHeightVh,
      textAlign: creditsTextAlign,
      contentPadLeft: creditsContentPadLeft,
      contentPadRight: creditsContentPadRight,
      contentPadTop: creditsContentPadTop,
      contentPadBottom: creditsContentPadBottom,
      sectionsOrder: creditsSectionsOrder,
      showDonors: creditsShowDonors,
      showChatters: creditsShowChatters,
      titleText: creditsTitleText,
      donorsTitleText: creditsDonorsTitleText,
      chattersTitleText: creditsChattersTitleText,
      showNumbers: creditsShowNumbers,
      showAvatars: creditsShowAvatars,
      avatarSize: creditsAvatarSize,
      avatarRadius: creditsAvatarRadius,
      fontFamily: creditsFontFamily,
      fontSize: creditsFontSize,
      fontWeight: creditsFontWeight,
      fontColor: creditsFontColor,
      lineHeight: creditsLineHeight,
      letterSpacing: creditsLetterSpacing,
      titleEnabled: creditsTitleEnabled,
      titleSize: creditsTitleSize,
      titleWeight: creditsTitleWeight,
      titleColor: creditsTitleColor,
      titleTransform: creditsTitleTransform,
      textShadowBlur: creditsTextShadowBlur,
      textShadowOpacity: creditsTextShadowOpacity,
      textShadowColor: creditsTextShadowColor,
      textStrokeWidth: creditsTextStrokeWidth,
      textStrokeOpacity: creditsTextStrokeOpacity,
      textStrokeColor: creditsTextStrokeColor,
      titleShadowBlur: creditsTitleShadowBlur,
      titleShadowOpacity: creditsTitleShadowOpacity,
      titleShadowColor: creditsTitleShadowColor,
      titleStrokeWidth: creditsTitleStrokeWidth,
      titleStrokeOpacity: creditsTitleStrokeOpacity,
      titleStrokeColor: creditsTitleStrokeColor,
      backgroundMode: creditsBackgroundMode,
      bgColor: creditsBgColor,
      bgOpacity: creditsBgOpacity,
      blur: creditsBlur,
      radius: creditsRadius,
      shadowBlur: creditsShadowBlur,
      shadowOpacity: creditsShadowOpacity,
      borderEnabled: creditsBorderEnabled,
      borderWidth: creditsBorderWidth,
      borderColor: creditsBorderColor,
      scrollSpeed: creditsScrollSpeed,
      scrollDirection: creditsScrollDirection,
      loop: creditsLoop,
      startDelayMs: creditsStartDelayMs,
      endFadeMs: creditsEndFadeMs,
      sectionGapPx: creditsSectionGapPx,
      lineGapPx: creditsLineGapPx,
      indentPx: creditsIndentPx,
      fadeInMs: creditsFadeInMs,
    });
  }, [
    creditsAnchorX,
    creditsAnchorY,
    creditsBgInsetLeft,
    creditsBgInsetRight,
    creditsBgInsetTop,
    creditsBgInsetBottom,
    creditsContentPadLeft,
    creditsContentPadRight,
    creditsContentPadTop,
    creditsContentPadBottom,
    creditsMaxWidthPx,
    creditsMaxHeightVh,
    creditsTextAlign,
    creditsBgOpacity,
    creditsBgColor,
    creditsBackgroundMode,
    creditsBlur,
    creditsBorderColor,
    creditsBorderEnabled,
    creditsBorderWidth,
    creditsEndFadeMs,
    creditsFadeInMs,
    creditsFontColor,
    creditsFontFamily,
    creditsFontSize,
    creditsFontWeight,
    creditsIndentPx,
    creditsLetterSpacing,
    creditsLineHeight,
    creditsLineGapPx,
    creditsRadius,
    creditsLoop,
    creditsScrollDirection,
    creditsScrollSpeed,
    creditsStartDelayMs,
    creditsSectionGapPx,
    creditsSectionsOrder,
    creditsShadowBlur,
    creditsShadowOpacity,
    creditsShowChatters,
    creditsShowDonors,
    creditsTitleText,
    creditsDonorsTitleText,
    creditsChattersTitleText,
    creditsShowNumbers,
    creditsShowAvatars,
    creditsAvatarSize,
    creditsAvatarRadius,
    creditsTitleColor,
    creditsTitleEnabled,
    creditsTitleSize,
    creditsTitleTransform,
    creditsTitleWeight,
    creditsTextShadowBlur,
    creditsTextShadowOpacity,
    creditsTextShadowColor,
    creditsTextStrokeWidth,
    creditsTextStrokeOpacity,
    creditsTextStrokeColor,
    creditsTitleShadowBlur,
    creditsTitleShadowOpacity,
    creditsTitleShadowColor,
    creditsTitleStrokeWidth,
    creditsTitleStrokeOpacity,
    creditsTitleStrokeColor,
  ]);

  const creditsPreviewParams = useMemo(() => {
    const lang = String(i18n.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
    return {
      demo: '1',
      lang,
      previewBg,
      anchorX: creditsAnchorX,
      anchorY: creditsAnchorY,
      bgInsetLeft: String(creditsBgInsetLeft),
      bgInsetRight: String(creditsBgInsetRight),
      bgInsetTop: String(creditsBgInsetTop),
      bgInsetBottom: String(creditsBgInsetBottom),
      maxWidthPx: String(creditsMaxWidthPx),
      maxHeightVh: String(creditsMaxHeightVh),
      textAlign: creditsTextAlign,
      contentPadLeft: String(creditsContentPadLeft),
      contentPadRight: String(creditsContentPadRight),
      contentPadTop: String(creditsContentPadTop),
      contentPadBottom: String(creditsContentPadBottom),
      sectionsOrder: JSON.stringify(creditsSectionsOrder),
      showDonors: creditsShowDonors ? '1' : '0',
      showChatters: creditsShowChatters ? '1' : '0',
      titleText: String(creditsTitleText),
      donorsTitleText: String(creditsDonorsTitleText),
      chattersTitleText: String(creditsChattersTitleText),
      showNumbers: creditsShowNumbers ? '1' : '0',
      showAvatars: creditsShowAvatars ? '1' : '0',
      avatarSize: String(creditsAvatarSize),
      avatarRadius: String(creditsAvatarRadius),
      fontFamily: String(creditsFontFamily),
      fontSize: String(creditsFontSize),
      fontWeight: String(creditsFontWeight),
      fontColor: String(creditsFontColor),
      lineHeight: String(creditsLineHeight),
      letterSpacing: String(creditsLetterSpacing),
      titleEnabled: creditsTitleEnabled ? '1' : '0',
      titleSize: String(creditsTitleSize),
      titleWeight: String(creditsTitleWeight),
      titleColor: String(creditsTitleColor),
      titleTransform: creditsTitleTransform,
      textShadowBlur: String(creditsTextShadowBlur),
      textShadowOpacity: String(creditsTextShadowOpacity),
      textShadowColor: String(creditsTextShadowColor),
      textStrokeWidth: String(creditsTextStrokeWidth),
      textStrokeOpacity: String(creditsTextStrokeOpacity),
      textStrokeColor: String(creditsTextStrokeColor),
      titleShadowBlur: String(creditsTitleShadowBlur),
      titleShadowOpacity: String(creditsTitleShadowOpacity),
      titleShadowColor: String(creditsTitleShadowColor),
      titleStrokeWidth: String(creditsTitleStrokeWidth),
      titleStrokeOpacity: String(creditsTitleStrokeOpacity),
      titleStrokeColor: String(creditsTitleStrokeColor),
      backgroundMode: creditsBackgroundMode,
      bgColor: String(creditsBgColor),
      bgOpacity: String(creditsBgOpacity),
      blur: String(creditsBlur),
      radius: String(creditsRadius),
      shadowBlur: String(creditsShadowBlur),
      shadowOpacity: String(creditsShadowOpacity),
      borderEnabled: creditsBorderEnabled ? '1' : '0',
      borderWidth: String(creditsBorderWidth),
      borderColor: String(creditsBorderColor),
      scrollSpeed: String(creditsScrollSpeed),
      scrollDirection: creditsScrollDirection,
      loop: creditsLoop ? '1' : '0',
      startDelayMs: String(creditsStartDelayMs),
      endFadeMs: String(creditsEndFadeMs),
      sectionGapPx: String(creditsSectionGapPx),
      lineGapPx: String(creditsLineGapPx),
      indentPx: String(creditsIndentPx),
      fadeInMs: String(creditsFadeInMs),
      // demo list sizes (overlay reads from query, but keeping here is harmless and consistent)
      demoChatters: '24',
      demoDonors: '12',
    } satisfies Record<string, string>;
  }, [
    creditsAvatarRadius,
    creditsAvatarSize,
    creditsAnchorX,
    creditsAnchorY,
    creditsBgOpacity,
    creditsBgColor,
    creditsBackgroundMode,
    creditsBlur,
    creditsBorderColor,
    creditsBorderEnabled,
    creditsBorderWidth,
    creditsEndFadeMs,
    creditsFadeInMs,
    creditsFontColor,
    creditsFontFamily,
    creditsFontSize,
    creditsFontWeight,
    creditsIndentPx,
    creditsLetterSpacing,
    creditsLineHeight,
    creditsLineGapPx,
    creditsLoop,
    creditsRadius,
    creditsScrollDirection,
    creditsScrollSpeed,
    creditsStartDelayMs,
    creditsMaxHeightVh,
    creditsMaxWidthPx,
    creditsBgInsetLeft,
    creditsBgInsetRight,
    creditsBgInsetTop,
    creditsBgInsetBottom,
    creditsContentPadLeft,
    creditsContentPadRight,
    creditsContentPadTop,
    creditsContentPadBottom,
    creditsTextAlign,
    creditsSectionGapPx,
    creditsSectionsOrder,
    creditsShadowBlur,
    creditsShadowOpacity,
    creditsShowAvatars,
    creditsShowChatters,
    creditsShowDonors,
    creditsShowNumbers,
    creditsChattersTitleText,
    creditsDonorsTitleText,
    creditsTitleText,
    creditsTitleColor,
    creditsTitleEnabled,
    creditsTitleSize,
    creditsTitleTransform,
    creditsTitleWeight,
    creditsTextShadowBlur,
    creditsTextShadowOpacity,
    creditsTextShadowColor,
    creditsTextStrokeWidth,
    creditsTextStrokeOpacity,
    creditsTextStrokeColor,
    creditsTitleShadowBlur,
    creditsTitleShadowOpacity,
    creditsTitleShadowColor,
    creditsTitleStrokeWidth,
    creditsTitleStrokeOpacity,
    creditsTitleStrokeColor,
    i18n.language,
    previewBg,
  ]);

  const activePreviewBaseUrl = overlayKind === 'credits' ? creditsPreviewBaseUrl : overlayPreviewBaseUrl;
  const activePreviewParams = overlayKind === 'credits' ? creditsPreviewParams : overlayPreviewParams;

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
  const schedulePostPreviewParams = useCallback((opts?: { immediate?: boolean }) => {
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

    // Throttle to reduce expensive reflows/repaints inside the iframe while dragging sliders.
    const now = Date.now();
    const minIntervalMs = 60;
    const wait = Math.max(0, minIntervalMs - (now - previewPostLastAtRef.current));
    previewPostTimerRef.current = window.setTimeout(() => {
      previewPostTimerRef.current = null;
      previewPostLastAtRef.current = Date.now();
      postPreviewParamsNow();
    }, wait);
  }, [postPreviewParamsNow]);

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

  const togglePerformanceMode = useCallback(() => {
    setPerformanceMode((prev) => {
      const next = !prev;
      if (next) {
        perfRestoreRef.current = {
          glassEnabled,
          urlBlur,
          urlBgOpacity,
          shadowBlur,
          shadowSpread,
          shadowDistance,
        };
        // Safe low-load defaults for OBS:
        // - no blur/backdrop-filter
        // - keep subtle shadow
        setGlassEnabled(false);
        setUrlBlur(0);
        setUrlBgOpacity(0);
        setShadowBlur(Math.min(shadowBlur, 36));
        setShadowSpread(Math.min(shadowSpread, 0));
        setShadowDistance(Math.min(shadowDistance, 12));
        toast.success(t('admin.obsPerformanceModeOn', { defaultValue: 'Performance mode enabled (lighter for OBS).' }));
      } else {
        const r = perfRestoreRef.current;
        if (r) {
          setGlassEnabled(r.glassEnabled);
          setUrlBlur(r.urlBlur);
          setUrlBgOpacity(r.urlBgOpacity);
          setShadowBlur(r.shadowBlur);
          setShadowSpread(r.shadowSpread);
          setShadowDistance(r.shadowDistance);
        }
        perfRestoreRef.current = null;
        toast.success(t('admin.obsPerformanceModeOff', { defaultValue: 'Performance mode disabled.' }));
      }
      return next;
    });
  }, [glassEnabled, shadowBlur, shadowDistance, shadowSpread, t, urlBgOpacity, urlBlur]);

  // Receive "ready" handshake from iframe so the first params post is never lost.
  const onPreviewMessageRef = useRef<(event: MessageEvent) => void>(() => undefined);
  useEffect(() => {
    onPreviewMessageRef.current = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== previewIframeRef.current?.contentWindow) return;
      const data = toRecord(event.data);
      if (!data) return;
      if (data.type !== 'memalerts:overlayReady') return;
      overlayReadyRef.current = true;
      // Send current params immediately when overlay confirms readiness.
      schedulePostPreviewParams({ immediate: true });
    };
  }, [schedulePostPreviewParams]);

  useEffect(() => {
    const handler = (event: MessageEvent) => onPreviewMessageRef.current(event);
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const animSpeedPct = useMemo(() => {
    const slow = 800;
    const fast = 180;
    const v = Math.max(0, Math.min(1200, urlEnterMs));
    const pct = Math.round(((slow - v) / (slow - fast)) * 100);
    return Math.max(0, Math.min(100, pct));
  }, [urlEnterMs]);

  const setAnimSpeedPct = (pct: number) => {
    const slow = 800;
    const fast = 180;
    const p = Math.max(0, Math.min(100, pct));
    const enter = Math.round(slow - (p / 100) * (slow - fast));
    const exit = Math.round(enter * 0.75);
    setUrlEnterMs(enter);
    setUrlExitMs(exit);
  };

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
    urlPosition,
    urlVolume,
    scaleMode,
    scaleFixed,
    scaleMin,
    scaleMax,
    safePad,
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
    urlAnim,
    urlEnterMs,
    urlExitMs,
    animEasingPreset,
    animEasingX1,
    animEasingY1,
    animEasingX2,
    animEasingY2,
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
  ]);

  const overlaySettingsPayload = useMemo(() => {
    return JSON.stringify({ overlayMode, overlayShowSender, overlayMaxConcurrent, overlayStyleJson });
  }, [overlayMaxConcurrent, overlayMode, overlayShowSender, overlayStyleJson]);

  const overlaySettingsDirty = useMemo(() => {
    if (!overlaySettingsLoadedRef.current) return false;
    if (lastSavedOverlaySettingsPayload === null) return false;
    return overlaySettingsPayload !== lastSavedOverlaySettingsPayload;
  }, [lastSavedOverlaySettingsPayload, overlaySettingsPayload]);

  const presetsStorageKey = useMemo(() => {
    const slug = String(channelSlug || '').trim() || '__no_channel__';
    return `memalerts:obsCustomPresets:v1:${slug}`;
  }, [channelSlug]);

  useEffect(() => {
    let cancelled = false;

    const loadFromLocalStorage = () => {
      try {
        const raw = typeof window !== 'undefined' ? window.localStorage.getItem(presetsStorageKey) : null;
        if (!raw) {
          setCustomPresets([]);
          return;
        }
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
          setCustomPresets([]);
          return;
        }
        const cleaned = parsed
          .map((p: unknown) => {
            const r = toRecord(p);
            const payload = r?.payload;
            return {
              id: String(r?.id || ''),
              name: String(r?.name || '').trim(),
              createdAt: Number(r?.createdAt || 0),
              payload: payload && typeof payload === 'object' ? (payload as OverlaySharePayload) : null,
            };
          })
          .filter((p): p is { id: string; name: string; createdAt: number; payload: OverlaySharePayload } => {
            return Boolean(p.id && p.name && p.payload);
          })
          .slice(0, 30);
        setCustomPresets(cleaned);
      } catch {
        setCustomPresets([]);
      }
    };

    (async () => {
      try {
        const { api } = await import('@/lib/api');
        const res = await api.get<{ presets?: Array<{ id: string; name: string; createdAt: number; payload: OverlaySharePayload }> }>(
          '/streamer/overlay/presets',
          { timeout: 8000 }
        );
        if (cancelled) return;
        const list = Array.isArray(res?.presets) ? res.presets : [];
        const cleaned = list
          .map((p) => ({
            id: String(p?.id || ''),
            name: String(p?.name || '').trim(),
            createdAt: Number(p?.createdAt || 0),
            payload: p?.payload && typeof p.payload === 'object' ? p.payload : null,
          }))
          .filter((p): p is { id: string; name: string; createdAt: number; payload: OverlaySharePayload } => {
            return Boolean(p.id && p.name && p.payload);
          })
          .slice(0, 30);
        setCustomPresets(cleaned);
        return;
      } catch (e: unknown) {
        const err = e as { response?: { status?: number } };
        // Backend may not support it yet -> fallback to localStorage so UX remains the same.
        if (err?.response?.status === 404) {
          if (!cancelled) loadFromLocalStorage();
          return;
        }
        if (!cancelled) loadFromLocalStorage();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [presetsStorageKey]);

  const persistCustomPresets = useCallback(
    (next: Array<{ id: string; name: string; createdAt: number; payload: OverlaySharePayload }>) => {
      setCustomPresets(next);
      // Backend-first persistence (fallback to localStorage if backend doesn't support it yet).
      (async () => {
        try {
          const { api } = await import('@/lib/api');
          await api.put('/streamer/overlay/presets', { presets: next }, { timeout: 12000 });
          return;
        } catch (e: unknown) {
          const err = e as { response?: { status?: number } };
          if (err?.response?.status !== 404) {
            // non-404 failures: still keep local fallback, but don't spam UI with errors here
          }
          try {
            if (typeof window !== 'undefined') {
              window.localStorage.setItem(presetsStorageKey, JSON.stringify(next));
            }
          } catch {
            // ignore storage errors
          }
        }
      })();
    },
    [presetsStorageKey]
  );

  const saveCurrentAsCustomPreset = useCallback(() => {
    const name = String(presetName || '').trim();
    if (!name) {
      toast.error(t('admin.obsPresetNameRequired', { defaultValue: 'Enter a preset name.' }));
      return;
    }
    const payload = makeSharePayload();
    const existingIdx = customPresets.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    const now = Date.now();
    const id = existingIdx >= 0 ? customPresets[existingIdx].id : `p_${now}_${Math.random().toString(16).slice(2, 8)}`;
    const next = [
      { id, name, createdAt: now, payload },
      ...customPresets.filter((p) => p.id !== id),
    ].slice(0, 30);
    persistCustomPresets(next);
    setPresetName('');
    toast.success(t('admin.obsPresetSaved', { defaultValue: 'Preset saved.' }));
  }, [customPresets, makeSharePayload, persistCustomPresets, presetName, t]);

  const deleteCustomPreset = useCallback(
    (id: string) => {
      const next = customPresets.filter((p) => p.id !== id);
      persistCustomPresets(next);
    },
    [customPresets, persistCustomPresets]
  );

  const resetOverlayToDefaults = useCallback(() => {
    // Default, streamer-friendly settings (reset).
    // NOTE: This only updates local state. User still clicks "Save".
    setOverlayMode('queue');
    setOverlayMaxConcurrent(3);
    setOverlayShowSender(true);

    setUrlPosition('random');

    setScaleMode('range');
    setScaleMin(0.72);
    setScaleMax(1.0);
    setScaleFixed(0.92);
    setSafePad(80);

    setUrlAnim('slide-up');
    setUrlEnterMs(280);
    setUrlExitMs(220);
    setAnimEasingPreset('ios');
    setAnimEasingX1(0.22);
    setAnimEasingY1(1);
    setAnimEasingX2(0.36);
    setAnimEasingY2(1);

    setUrlRadius(26);

    setShadowBlur(86);
    setShadowSpread(10);
    setShadowDistance(16);
    setShadowAngle(120);
    setShadowOpacity(0.55);
    setShadowColor('#000000');

    setGlassEnabled(true);
    setGlassPreset('ios');
    setGlassTintColor('#7dd3fc');
    setGlassTintStrength(0.18);
    setUrlBlur(10);
    setUrlBgOpacity(0.22);

    setBorderPreset('glass');
    setBorderTintColor('#7dd3fc');
    setBorderTintStrength(0.38);
    setUrlBorder(2);
    setBorderMode('solid');
    setUrlBorderColor('#ffffff');
    setUrlBorderColor2('#7dd3fc');
    setUrlBorderGradientAngle(135);

    setSenderHoldMs(2600);
    setSenderBgColor('#000000');
    setSenderBgOpacity(0.55);
    setSenderBgRadius(14);
    setSenderStroke('glass');
    setSenderStrokeWidth(1);
    setSenderStrokeOpacity(0.24);
    setSenderStrokeColor('#ffffff');

    setSenderFontSize(14);
    setSenderFontWeight(600);
    setSenderFontFamily('system');
    setSenderFontColor('#ffffff');

    setAdvancedTab('border');
    toast.success(t('admin.overlayDefaultsApplied'));
  }, [t]);

  const applyPreset = useCallback(
    (preset: 'default' | 'minimal' | 'neon') => {
      if (preset === 'default') {
        resetOverlayToDefaults();
        return;
      }

      if (preset === 'minimal') {
        setOverlayMode('queue');
        setOverlayMaxConcurrent(1);
        setOverlayShowSender(false);
        setUrlPosition('center');
        setScaleMode('fixed');
        setScaleFixed(1);
        setScaleMin(0.9);
        setScaleMax(1);
        setSafePad(24);
        setUrlAnim('fade');
        setUrlEnterMs(180);
        setUrlExitMs(180);
        setUrlRadius(18);
        setShadowBlur(22);
        setShadowSpread(0);
        setShadowDistance(10);
        setShadowAngle(90);
        setShadowOpacity(0.35);
        setShadowColor('#000000');
        setGlassEnabled(false);
        setUrlBlur(0);
        setUrlBgOpacity(0);
        setBorderPreset('custom');
        setUrlBorder(0);
        setBorderMode('solid');
        setUrlBorderColor('#ffffff');
        setUrlBorderColor2('#00e5ff');
        setUrlBorderGradientAngle(135);
        setAdvancedTab('layout');
        return;
      }

      // neon
      setOverlayMode('simultaneous');
      setOverlayMaxConcurrent(3);
      setOverlayShowSender(true);
      setUrlPosition('random');
      setScaleMode('range');
      setScaleMin(0.7);
      setScaleMax(1.05);
      setScaleFixed(0.9);
      setSafePad(80);
      setUrlAnim('pop');
      setUrlEnterMs(260);
      setUrlExitMs(220);
      setUrlRadius(26);
      setShadowBlur(110);
      setShadowSpread(18);
      setShadowDistance(18);
      setShadowAngle(120);
      setShadowOpacity(0.55);
      setShadowColor('#000000');
      setGlassEnabled(true);
      setGlassPreset('prism');
      setGlassTintStrength(0.22);
      setUrlBlur(12);
      setUrlBgOpacity(0.24);
      setBorderPreset('glow');
      setBorderTintColor('#00E5FF');
      setBorderTintStrength(0.55);
      setUrlBorder(3);
      setBorderMode('gradient');
      setUrlBorderColor('#00E5FF');
      setUrlBorderColor2('#A78BFA');
      setUrlBorderGradientAngle(135);
      setAdvancedTab('border');
    },
    [resetOverlayToDefaults]
  );

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
      lastChangeRef.current = null;
      // No extra GET here: saving should be a single request for better UX / lower load.
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

  const creditsSettingsDirty = useMemo(() => {
    if (!creditsSettingsLoadedRef.current) return false;
    return creditsStyleJson !== lastSavedCreditsSettingsPayload;
  }, [creditsStyleJson, lastSavedCreditsSettingsPayload]);

  const handleSaveCreditsSettings = useCallback(async (): Promise<void> => {
    if (!channelSlug) return;
    if (loadingCreditsSettings) return;
    if (!creditsSettingsLoadedRef.current) return;
    if (!creditsSettingsDirty) return;
    const startedAt = Date.now();
    try {
      setSavingCreditsSettings(true);
      await saveCreditsSettings({ styleJson: creditsStyleJson });
      setLastSavedCreditsSettingsPayload(creditsStyleJson);
      toast.success(t('admin.settingsSaved'));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave'));
    } finally {
      await ensureMinDuration(startedAt, 650);
      setSavingCreditsSettings(false);
      setCreditsSettingsSavedPulse(true);
      window.setTimeout(() => setCreditsSettingsSavedPulse(false), 700);
    }
  }, [channelSlug, creditsSettingsDirty, creditsStyleJson, loadingCreditsSettings, t]);

  const handleRotateOverlayToken = async (): Promise<void> => {
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
  };

  const handleRotateCreditsToken = async (): Promise<void> => {
    if (!channelSlug) return;
    try {
      setRotatingCreditsToken(true);
      const resp = await rotateCreditsToken();
      setCreditsToken(resp?.token || '');
      setCreditsUrl(resp?.url || '');
      toast.success(t('admin.obsOverlayTokenRotated', { defaultValue: 'Overlay link updated. Paste the new URL into OBS.' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save' }));
    } finally {
      setRotatingCreditsToken(false);
    }
  };

  const applyCreditsPreset = useCallback(
    (preset: 'minimal' | 'classic' | 'neon' | 'fullscreen') => {
      // These are local-only changes; user still clicks Save.
      if (preset === 'minimal') {
        setCreditsShowDonors(true);
        setCreditsShowChatters(true);
        setCreditsSectionsOrder(['donors', 'chatters']);
        setCreditsTitleText('Credits');
        setCreditsDonorsTitleText('Donors');
        setCreditsChattersTitleText('Chatters');
        setCreditsShowNumbers(true);
        setCreditsShowAvatars(true);
        setCreditsAvatarSize(32);
        setCreditsAvatarRadius(10);
        setCreditsFontFamily('Inter');
        setCreditsFontSize(28);
        setCreditsFontWeight(800);
        setCreditsFontColor('#ffffff');
        setCreditsLineHeight(1.14);
        setCreditsLetterSpacing(0);
        setCreditsTitleEnabled(true);
        setCreditsTitleSize(20);
        setCreditsTitleWeight(800);
        setCreditsTitleColor('#ffffff');
        setCreditsTitleTransform('uppercase');
        setCreditsAnchorX('center');
        setCreditsAnchorY('center');
        // Keep a safe readable area, but stay visually minimal.
        setCreditsBgInsetLeft(48);
        setCreditsBgInsetRight(48);
        setCreditsBgInsetTop(48);
        setCreditsBgInsetBottom(48);
        setCreditsContentPadLeft(0);
        setCreditsContentPadRight(0);
        setCreditsContentPadTop(0);
        setCreditsContentPadBottom(0);
        setCreditsMaxWidthPx(920);
        setCreditsMaxHeightVh(88);
        setCreditsTextAlign('center');
        setCreditsIndentPx(0);
        setCreditsBackgroundMode('transparent');
        setCreditsBgColor('#000000');
        setCreditsBgOpacity(0);
        setCreditsBlur(0);
        setCreditsRadius(0);
        setCreditsBorderEnabled(false);
        setCreditsBorderWidth(1);
        setCreditsBorderColor('#ffffff');
        setCreditsShadowBlur(0);
        setCreditsShadowOpacity(0);
        setCreditsScrollSpeed(48);
        setCreditsScrollDirection('up');
        setCreditsLoop(true);
        setCreditsStartDelayMs(0);
        setCreditsEndFadeMs(0);
        setCreditsSectionGapPx(22);
        setCreditsLineGapPx(8);
        setCreditsFadeInMs(450);
        // Strong readability without any card/background.
        setCreditsTextShadowBlur(22);
        setCreditsTextShadowOpacity(0.75);
        setCreditsTextShadowColor('#000000');
        setCreditsTextStrokeWidth(0.5);
        setCreditsTextStrokeOpacity(0.9);
        setCreditsTextStrokeColor('#000000');
        setCreditsTitleShadowBlur(24);
        setCreditsTitleShadowOpacity(0.8);
        setCreditsTitleShadowColor('#000000');
        setCreditsTitleStrokeWidth(0.5);
        setCreditsTitleStrokeOpacity(0.92);
        setCreditsTitleStrokeColor('#000000');
        return;
      }

      if (preset === 'neon') {
        setCreditsShowDonors(true);
        setCreditsShowChatters(true);
        setCreditsSectionsOrder(['donors', 'chatters']);
        setCreditsFontFamily('JetBrains Mono');
        setCreditsFontSize(24);
        setCreditsFontWeight(700);
        setCreditsFontColor('#ffffff');
        setCreditsLineHeight(1.1);
        setCreditsLetterSpacing(0.2);
        setCreditsTitleEnabled(true);
        setCreditsTitleSize(18);
        setCreditsTitleWeight(800);
        setCreditsTitleColor('#7dd3fc');
        setCreditsTitleTransform('uppercase');
        setCreditsAnchorX('center');
        setCreditsAnchorY('center');
        setCreditsBgInsetLeft(28);
        setCreditsBgInsetRight(28);
        setCreditsBgInsetTop(28);
        setCreditsBgInsetBottom(28);
        setCreditsContentPadLeft(30);
        setCreditsContentPadRight(30);
        setCreditsContentPadTop(28);
        setCreditsContentPadBottom(28);
        setCreditsMaxWidthPx(980);
        setCreditsMaxHeightVh(90);
        setCreditsTextAlign('center');
        setCreditsIndentPx(0);
        setCreditsBackgroundMode('card');
        setCreditsBgColor('#000000');
        setCreditsBgOpacity(0.22);
        setCreditsBlur(10);
        setCreditsRadius(26);
        setCreditsBorderEnabled(true);
        setCreditsBorderWidth(2);
        setCreditsBorderColor('#00e5ff');
        setCreditsShadowBlur(110);
        setCreditsShadowOpacity(0.55);
        setCreditsScrollSpeed(56);
        setCreditsScrollDirection('up');
        setCreditsLoop(true);
        setCreditsStartDelayMs(0);
        setCreditsEndFadeMs(0);
        setCreditsSectionGapPx(26);
        setCreditsLineGapPx(8);
        setCreditsFadeInMs(420);
        setCreditsTextShadowBlur(26);
        setCreditsTextShadowOpacity(0.7);
        setCreditsTextShadowColor('#000000');
        setCreditsTextStrokeWidth(0.75);
        setCreditsTextStrokeOpacity(0.9);
        setCreditsTextStrokeColor('#000000');
        setCreditsTitleShadowBlur(30);
        setCreditsTitleShadowOpacity(0.8);
        setCreditsTitleShadowColor('#000000');
        setCreditsTitleStrokeWidth(0.75);
        setCreditsTitleStrokeOpacity(0.95);
        setCreditsTitleStrokeColor('#000000');
        return;
      }

      if (preset === 'fullscreen') {
        setCreditsShowDonors(true);
        setCreditsShowChatters(true);
        setCreditsSectionsOrder(['donors', 'chatters']);
        setCreditsFontFamily('Montserrat');
        setCreditsFontSize(32);
        setCreditsFontWeight(800);
        setCreditsFontColor('#ffffff');
        setCreditsLineHeight(1.08);
        setCreditsLetterSpacing(0);
        setCreditsTitleEnabled(true);
        setCreditsTitleSize(22);
        setCreditsTitleWeight(900);
        setCreditsTitleColor('#ffffff');
        setCreditsTitleTransform('uppercase');
        setCreditsAnchorX('center');
        setCreditsAnchorY('center');
        setCreditsBgInsetLeft(0);
        setCreditsBgInsetRight(0);
        setCreditsBgInsetTop(0);
        setCreditsBgInsetBottom(0);
        setCreditsContentPadLeft(48);
        setCreditsContentPadRight(48);
        setCreditsContentPadTop(36);
        setCreditsContentPadBottom(36);
        setCreditsMaxWidthPx(2400);
        setCreditsMaxHeightVh(100);
        setCreditsTextAlign('center');
        setCreditsIndentPx(0);
        setCreditsBackgroundMode('full');
        setCreditsBgColor('#000000');
        setCreditsBgOpacity(0.2);
        setCreditsBlur(0);
        setCreditsRadius(0);
        setCreditsBorderEnabled(false);
        setCreditsBorderWidth(1);
        setCreditsBorderColor('#ffffff');
        setCreditsShadowBlur(90);
        setCreditsShadowOpacity(0.55);
        setCreditsScrollSpeed(58);
        setCreditsScrollDirection('up');
        setCreditsLoop(false);
        setCreditsStartDelayMs(1200);
        setCreditsEndFadeMs(2000);
        setCreditsSectionGapPx(32);
        setCreditsLineGapPx(10);
        setCreditsFadeInMs(600);
        setCreditsTextShadowBlur(26);
        setCreditsTextShadowOpacity(0.72);
        setCreditsTextShadowColor('#000000');
        setCreditsTextStrokeWidth(0.5);
        setCreditsTextStrokeOpacity(0.9);
        setCreditsTextStrokeColor('#000000');
        setCreditsTitleShadowBlur(30);
        setCreditsTitleShadowOpacity(0.8);
        setCreditsTitleShadowColor('#000000');
        setCreditsTitleStrokeWidth(0.5);
        setCreditsTitleStrokeOpacity(0.95);
        setCreditsTitleStrokeColor('#000000');
        return;
      }

      // classic (default)
      setCreditsShowDonors(true);
      setCreditsShowChatters(true);
      setCreditsSectionsOrder(['donors', 'chatters']);
      setCreditsFontFamily('Inter');
      setCreditsFontSize(26);
      setCreditsFontWeight(800);
      setCreditsFontColor('#ffffff');
      setCreditsLineHeight(1.15);
      setCreditsLetterSpacing(0);
      setCreditsTitleEnabled(true);
      setCreditsTitleSize(20);
      setCreditsTitleWeight(900);
      setCreditsTitleColor('#ffffff');
      setCreditsTitleTransform('uppercase');
      setCreditsAnchorX('center');
      setCreditsAnchorY('center');
      setCreditsBgInsetLeft(24);
      setCreditsBgInsetRight(24);
      setCreditsBgInsetTop(24);
      setCreditsBgInsetBottom(24);
      setCreditsContentPadLeft(28);
      setCreditsContentPadRight(28);
      setCreditsContentPadTop(28);
      setCreditsContentPadBottom(28);
      setCreditsMaxWidthPx(920);
      setCreditsMaxHeightVh(88);
      setCreditsTextAlign('center');
      setCreditsIndentPx(0);
      setCreditsBackgroundMode('card');
      setCreditsBgColor('#000000');
      setCreditsBgOpacity(0.22);
      setCreditsBlur(8);
      setCreditsRadius(22);
      setCreditsBorderEnabled(false);
      setCreditsBorderWidth(1);
      setCreditsBorderColor('#ffffff');
      setCreditsShadowBlur(90);
      setCreditsShadowOpacity(0.6);
      setCreditsScrollSpeed(48);
      setCreditsScrollDirection('up');
      setCreditsLoop(true);
      setCreditsStartDelayMs(0);
      setCreditsEndFadeMs(0);
      setCreditsSectionGapPx(24);
      setCreditsLineGapPx(8);
      setCreditsFadeInMs(600);
      setCreditsTextShadowBlur(18);
      setCreditsTextShadowOpacity(0.62);
      setCreditsTextShadowColor('#000000');
      setCreditsTextStrokeWidth(0.4);
      setCreditsTextStrokeOpacity(0.88);
      setCreditsTextStrokeColor('#000000');
      setCreditsTitleShadowBlur(20);
      setCreditsTitleShadowOpacity(0.7);
      setCreditsTitleShadowColor('#000000');
      setCreditsTitleStrokeWidth(0.4);
      setCreditsTitleStrokeOpacity(0.92);
      setCreditsTitleStrokeColor('#000000');
    },
    [],
  );

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.obsLinksTitle', { defaultValue: 'OBS links' })}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        {t('admin.obsLinksDescription', { defaultValue: 'Copy the overlay link and paste it into OBS as a Browser Source. The overlay will show activated memes in real time.' })}
      </p>

      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={overlayKind === 'memes' ? 'primary' : 'secondary'}
            className={overlayKind === 'memes' ? '' : 'glass-btn'}
            onClick={() => setOverlayKind('memes')}
          >
            {t('admin.obsOverlayKindMemes', { defaultValue: 'Мемы' })}
          </Button>
          {creditsEnabled ? (
            <Button
              type="button"
              size="sm"
              variant={overlayKind === 'credits' ? 'primary' : 'secondary'}
              className={overlayKind === 'credits' ? '' : 'glass-btn'}
              onClick={() => setOverlayKind('credits')}
            >
              {t('admin.obsOverlayKindCredits', { defaultValue: 'Титры' })}
            </Button>
          ) : null}
        </div>

        {overlayKind === 'memes' ? (
          <SecretCopyField
            label={t('admin.obsOverlayUrl', { defaultValue: 'Overlay URL (Browser Source)' })}
            value={overlayUrlWithDefaults}
            masked={true}
            emptyText={t('common.notAvailable', { defaultValue: 'Not available' })}
            description={loadingToken ? t('common.loading', { defaultValue: 'Loading…' }) : t('admin.obsOverlayUrlHint', { defaultValue: 'Click to copy. You can reveal the URL with the eye icon.' })}
            rightActions={
              <HelpTooltip content={t('help.settings.obs.rotateLink', { defaultValue: 'Generate a new overlay link. Use this if the link was leaked — the old one will stop working.' })}>
                <IconButton
                  type="button"
                  variant="ghost"
                  className="rounded-xl text-gray-700 dark:text-gray-200"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRotateOverlayToken();
                  }}
                  disabled={rotatingOverlayToken || loadingToken || !overlayToken}
                  aria-label={t('admin.obsOverlayRotateLink', { defaultValue: 'Update overlay link' })}
                  icon={<RotateIcon />}
                />
              </HelpTooltip>
            }
          />
        ) : (
          <SecretCopyField
            label={t('admin.obsCreditsUrl', { defaultValue: 'Credits URL (Browser Source)' })}
            value={creditsUrlWithDefaults}
            masked={true}
            emptyText={t('common.notAvailable', { defaultValue: 'Not available' })}
            description={
              loadingCreditsToken
                ? t('common.loading', { defaultValue: 'Loading…' })
                : t('admin.obsOverlayUrlHint', { defaultValue: 'Click to copy. You can reveal the URL with the eye icon.' })
            }
            rightActions={
              <HelpTooltip content={t('help.settings.obs.rotateLink', { defaultValue: 'Generate a new overlay link. Use this if the link was leaked — the old one will stop working.' })}>
                <IconButton
                  type="button"
                  variant="ghost"
                  className="rounded-xl text-gray-700 dark:text-gray-200"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRotateCreditsToken();
                  }}
                  disabled={rotatingCreditsToken || loadingCreditsToken || !creditsToken}
                  aria-label={t('admin.obsOverlayRotateLink', { defaultValue: 'Update overlay link' })}
                  icon={<RotateIcon />}
                />
              </HelpTooltip>
            }
          />
        )}

        {overlayKind === 'memes' ? (
          <>
            <div className="glass p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <input
                  id="overlayShowSender"
                  type="checkbox"
                  checked={overlayShowSender}
                  onChange={(e) => {
                    lastChangeRef.current = 'sender';
                    setOverlayShowSender(e.target.checked);
                  }}
                  className="mt-1 h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                  disabled={loadingOverlaySettings || savingOverlaySettings}
                />
                <label htmlFor="overlayShowSender" className="text-sm text-gray-800 dark:text-gray-100">
                  <div className="font-medium">{t('admin.obsOverlayShowSender', { defaultValue: 'Show sender name' })}</div>
                </label>
              </div>
            </div>

            <details className="glass p-5 sm:p-6">
              <summary className="cursor-pointer font-semibold text-gray-900 dark:text-white flex items-center justify-between gap-3 [-webkit-details-marker]:hidden">
                <span>{t('admin.obsAdvancedOverlayUrl', { defaultValue: 'Advanced overlay URL (customize)' })}</span>
                <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="mt-3 space-y-4">
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {t('admin.obsOverlayAdvancedHintShort', {
                defaultValue: 'Change the look here вЂ” then copy the single overlay URL above into OBS.',
              })}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex rounded-xl overflow-hidden border border-white/20 dark:border-white/10">
                <button
                  type="button"
                  className={`px-3 py-2 text-sm font-semibold ${
                    obsUiMode === 'basic'
                      ? 'bg-primary text-white'
                      : 'bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white'
                  }`}
                  onClick={() => setObsUiMode('basic')}
                >
                  {t('admin.obsUiBasic', { defaultValue: 'Basic' })}
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-sm font-semibold border-l border-white/20 dark:border-white/10 ${
                    obsUiMode === 'pro'
                      ? 'bg-primary text-white'
                      : 'bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white'
                  }`}
                  onClick={() => setObsUiMode('pro')}
                >
                  {t('admin.obsUiPro', { defaultValue: 'Pro' })}
                </button>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {obsUiMode === 'basic'
                  ? t('admin.obsUiBasicHint', { defaultValue: 'Simple controls for quick setup.' })
                  : t('admin.obsUiProHint', { defaultValue: 'Full control for designers.' })}
              </div>
            </div>

            <div className="relative">
              {(loadingOverlaySettings || savingOverlaySettings) && <SavingOverlay label={t('admin.saving')} />}
              {overlaySettingsSavedPulse && !savingOverlaySettings && !loadingOverlaySettings && <SavedOverlay label={t('admin.saved')} />}

              <div
                className={`space-y-4 transition-opacity ${
                  loadingOverlaySettings || savingOverlaySettings ? 'pointer-events-none opacity-60' : ''
                }`}
              >
                <div className="rounded-xl bg-white/50 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
                  <div
                    className={`grid grid-cols-1 md:grid-cols-2 gap-4`}
                  >
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    {t('admin.obsOverlayMode')}
                  </label>
                  <div className="inline-flex rounded-lg overflow-hidden glass-btn bg-white/40 dark:bg-white/5">
                    <button
                      type="button"
                      onClick={() => {
                        lastChangeRef.current = 'mode';
                        setOverlayMode('queue');
                      }}
                      disabled={loadingOverlaySettings || savingOverlaySettings}
                      className={`px-3 py-2 text-sm font-medium ${
                        overlayMode === 'queue'
                          ? 'bg-primary text-white'
                          : 'bg-transparent text-gray-900 dark:text-white'
                      }`}
                    >
                      {t('admin.obsOverlayModeQueueShort', { defaultValue: 'Queue' })}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        lastChangeRef.current = 'mode';
                        setOverlayMode('simultaneous');
                      }}
                      disabled={loadingOverlaySettings || savingOverlaySettings}
                      className={`px-3 py-2 text-sm font-medium border-l border-white/20 dark:border-white/10 ${
                        overlayMode === 'simultaneous'
                          ? 'bg-primary text-white'
                          : 'bg-transparent text-gray-900 dark:text-white'
                      }`}
                    >
                      {t('admin.obsOverlayModeUnlimited', { defaultValue: 'Unlimited' })}
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    {overlayMode === 'queue'
                      ? t('admin.obsOverlayModeQueueHint', { defaultValue: 'Shows one meme at a time.' })
                      : t('admin.obsOverlayModeUnlimitedHint', { defaultValue: 'Shows all incoming memes at once (no limit).' })}
                  </div>
                </div>

                {overlayMode === 'simultaneous' && (
                  <div className="pt-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlayMaxConcurrent', { defaultValue: 'Max simultaneous memes' })}:{' '}
                      <span className="font-mono">{overlayMaxConcurrent}</span>
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={overlayMaxConcurrent}
                      onChange={(e) => setOverlayMaxConcurrent(parseInt(e.target.value, 10))}
                      className="w-full"
                    />
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {t('admin.obsOverlayMaxConcurrentHint', { defaultValue: 'Safety limit for unlimited mode (prevents OBS from lagging).' })}
                    </div>
                  </div>
                )}
              </div>
                  </div>
                </div>

                <div className="pt-2">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {t('admin.obsOverlayLivePreview')}
                    </div>
                    <HelpTooltip content={t('help.settings.obs.previewNext', { defaultValue: 'Load a new random meme for preview (does not affect your real overlay).' })}>
                      <button
                        type="button"
                        className="glass-btn p-2 shrink-0"
                        disabled={loadingPreview || !overlayToken}
                        onClick={() => {
                          const next = previewSeedRef.current >= 1000000000 ? 1 : previewSeedRef.current + 1;
                          // IMPORTANT: do not update previewSeed before the new preview set arrives.
                          // We fetch using next seed and then commit seed+urls in the same render.
                          void fetchPreviewMemes(previewCount, next, { commitSeed: true });
                        }}
                        aria-label={t('admin.obsPreviewNextMeme')}
                      >
                        {/* Next arrow icon */}
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
                        {/* Loop icon */}
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
                        {/* Shuffle icon */}
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
                        {/* Photo / background icon */}
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
                      <div
                        className="w-full flex items-center justify-center text-sm text-white/70"
                        style={{ aspectRatio: '16 / 9' }}
                      >
                        {t('common.loading', { defaultValue: 'Loading…' })}
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
                          // Best-effort post on load (also shortly after) to avoid races with overlay boot.
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

                <div className="glass p-3">
                  <div className="flex items-center justify-between gap-3">
                    {obsUiMode === 'pro' ? (
                    <div className="flex-1 overflow-x-auto no-scrollbar">
                      <div className="flex items-center gap-2 min-w-max pr-1">
                      {(
                        [
                          ['layout', t('admin.obsAdvancedTabLayout', { defaultValue: 'Layout' })],
                          ['animation', t('admin.obsAdvancedTabAnimation', { defaultValue: 'Animation' })],
                          ['shadow', t('admin.obsAdvancedTabShadow', { defaultValue: 'Shadow' })],
                          ['border', t('admin.obsAdvancedTabBorder', { defaultValue: 'Border' })],
                          ['glass', t('admin.obsAdvancedTabGlass', { defaultValue: 'Glass' })],
                          ['sender', t('admin.obsAdvancedTabSender', { defaultValue: 'Sender' })],
                        ] as const
                      )
                        .filter(([k]) => (k === 'sender' ? overlayShowSender : true))
                        .map(([k, label]) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setAdvancedTab(k)}
                            className={`h-11 px-4 shrink-0 rounded-xl border text-xs sm:text-sm font-semibold transition-colors ${
                              advancedTab === k
                                ? 'bg-primary text-white border-primary/30 shadow-sm'
                                : 'bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white border-white/30 dark:border-white/10 hover:bg-white/80 dark:hover:bg-white/15'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    ) : (
                      <div className="flex-1 text-sm text-gray-700 dark:text-gray-200 font-semibold">
                        {t('admin.obsUiBasicTitle', { defaultValue: 'Quick controls' })}
                      </div>
                    )}

                    <div className="flex items-center gap-2 shrink-0">
                      {overlaySettingsDirty && (
                        <div className="hidden sm:flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                          <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                          {t('admin.unsavedChanges', { defaultValue: 'Р•СЃС‚СЊ РЅРµСЃРѕС…СЂР°РЅС‘РЅРЅС‹Рµ РёР·РјРµРЅРµРЅРёСЏ' })}
                        </div>
                      )}
                      <HelpTooltip content={t('help.settings.obs.resetDefaults', { defaultValue: 'Reset all overlay appearance settings back to defaults.' })}>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="glass-btn"
                          onClick={resetOverlayToDefaults}
                          disabled={savingOverlaySettings || loadingOverlaySettings}
                          leftIcon={
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12a9 9 0 101.8-5.4" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4v6h6" />
                            </svg>
                          }
                        >
                          <span className="hidden sm:inline">{t('admin.overlayResetDefaults')}</span>
                        </Button>
                      </HelpTooltip>
                      {/* Import/Export removed: users can save custom presets locally instead */}
                      <button
                        type="button"
                        className={`glass-btn px-4 py-2 text-sm font-semibold ${overlaySettingsDirty ? '' : 'opacity-60'}`}
                        disabled={!overlaySettingsDirty || savingOverlaySettings || loadingOverlaySettings}
                        onClick={() => void handleSaveOverlaySettings()}
                      >
                        {savingOverlaySettings ? t('admin.saving') : t('common.save')}
                      </button>
                    </div>
                  </div>
                </div>

                {obsUiMode === 'basic' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="glass p-4 space-y-3">
                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {t('admin.obsPresets', { defaultValue: 'Presets' })}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyPreset('default')}>
                          {t('admin.obsPresetDefault', { defaultValue: 'Default' })}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyPreset('minimal')}>
                          {t('admin.obsPresetMinimal', { defaultValue: 'Minimal' })}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyPreset('neon')}>
                          {t('admin.obsPresetNeon', { defaultValue: 'Neon' })}
                        </Button>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        {t('admin.obsPresetsHint', { defaultValue: 'Start from a preset, then tweak below.' })}
                      </div>

                      <div className="pt-2 border-t border-white/15 dark:border-white/10">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                          {t('admin.obsCustomPresets', { defaultValue: 'Your presets' })}
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            value={presetName}
                            onChange={(e) => setPresetName(e.target.value)}
                            placeholder={t('admin.obsPresetNamePlaceholder', { defaultValue: 'Preset name…' })}
                            className="flex-1"
                          />
                          <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={saveCurrentAsCustomPreset}>
                            {t('admin.obsPresetSave', { defaultValue: 'Save' })}
                          </Button>
                        </div>

                        {customPresets.length > 0 ? (
                          <div className="mt-2 space-y-2">
                            {customPresets.map((p) => (
                              <div key={p.id} className="flex items-center gap-2">
                                <HelpTooltip content={t('help.settings.obs.presetApply', { defaultValue: 'Apply this saved preset to your overlay settings.' })}>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="glass-btn flex-1 justify-start"
                                    onClick={() => applySharePayload(p.payload)}
                                  >
                                    {p.name}
                                  </Button>
                                </HelpTooltip>
                                <HelpTooltip content={t('help.settings.obs.presetDelete', { defaultValue: 'Delete this saved preset.' })}>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="glass-btn"
                                    onClick={() => deleteCustomPreset(p.id)}
                                  >
                                    {t('common.delete', { defaultValue: 'Delete' })}
                                  </Button>
                                </HelpTooltip>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                            {t('admin.obsCustomPresetsEmpty', { defaultValue: 'Save your first preset to reuse it later.' })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="glass p-4 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                            {t('admin.obsOverlayPosition', { defaultValue: 'Position' })}
                          </label>
                          <select
                            value={urlPosition}
                            onChange={(e) => setUrlPosition(e.target.value as UrlPosition)}
                            className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            <option value="random">{t('admin.obsOverlayPositionRandom', { defaultValue: 'Random' })}</option>
                            <option value="center">{t('admin.obsOverlayPositionCenter', { defaultValue: 'Center' })}</option>
                            <option value="top">{t('admin.obsOverlayPositionTop', { defaultValue: 'Top' })}</option>
                            <option value="bottom">{t('admin.obsOverlayPositionBottom', { defaultValue: 'Bottom' })}</option>
                            <option value="top-left">{t('admin.obsOverlayPositionTopLeft', { defaultValue: 'Top-left' })}</option>
                            <option value="top-right">{t('admin.obsOverlayPositionTopRight', { defaultValue: 'Top-right' })}</option>
                            <option value="bottom-left">{t('admin.obsOverlayPositionBottomLeft', { defaultValue: 'Bottom-left' })}</option>
                            <option value="bottom-right">{t('admin.obsOverlayPositionBottomRight', { defaultValue: 'Bottom-right' })}</option>
                          </select>
                        </div>

                        {/* mediaFit removed: always cover to avoid black bars */}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                            {t('admin.obsOverlaySize', { defaultValue: 'Size' })}:{' '}
                            <span className="font-mono">{Math.round(scaleFixed * 100)}%</span>
                          </label>
                          <input
                            type="range"
                            min={0.4}
                            max={1.6}
                            step={0.05}
                            value={scaleMode === 'fixed' ? scaleFixed : Math.min(1.6, Math.max(0.4, (scaleMin + scaleMax) / 2))}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              setScaleMode('fixed');
                              setScaleFixed(v);
                            }}
                            onPointerDown={() => setPreviewLockPositions(true)}
                            onPointerUp={() => setPreviewLockPositions(false)}
                            className="w-full"
                          />
                          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            {t('admin.obsOverlaySizeHint', { defaultValue: 'Controls the overall meme size.' })}
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                            {t('admin.obsOverlaySafeArea', { defaultValue: 'Safe area (px)' })}:{' '}
                            <span className="font-mono">{safePad}</span>
                          </label>
                          <input
                            type="range"
                            min={0}
                            max={160}
                            step={4}
                            value={safePad}
                            onChange={(e) => {
                              setSafePad(parseInt(e.target.value, 10));
                              flashSafeGuide();
                            }}
                            onPointerDown={() => {
                              setPreviewLockPositions(true);
                              flashSafeGuide();
                            }}
                            onPointerUp={() => setPreviewLockPositions(false)}
                            className="w-full"
                          />
                          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            {t('admin.obsOverlaySafeAreaHint', { defaultValue: 'Keeps memes away from the edges to avoid clipping.' })}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                            {t('admin.obsOverlayMode', { defaultValue: 'Mode' })}
                          </label>
                          <div className="inline-flex rounded-lg overflow-hidden glass-btn bg-white/40 dark:bg-white/5">
                            <button
                              type="button"
                              onClick={() => setOverlayMode('queue')}
                              disabled={loadingOverlaySettings || savingOverlaySettings}
                              className={`px-3 py-2 text-sm font-medium ${
                                overlayMode === 'queue'
                                  ? 'bg-primary text-white'
                                  : 'bg-transparent text-gray-900 dark:text-white'
                              }`}
                            >
                              {t('admin.obsOverlayModeQueueShort', { defaultValue: 'Queue' })}
                            </button>
                            <button
                              type="button"
                              onClick={() => setOverlayMode('simultaneous')}
                              disabled={loadingOverlaySettings || savingOverlaySettings}
                              className={`px-3 py-2 text-sm font-medium border-l border-white/20 dark:border-white/10 ${
                                overlayMode === 'simultaneous'
                                  ? 'bg-primary text-white'
                                  : 'bg-transparent text-gray-900 dark:text-white'
                              }`}
                            >
                              {t('admin.obsOverlayModeUnlimited', { defaultValue: 'Unlimited' })}
                            </button>
                          </div>
                          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            {overlayMode === 'queue'
                              ? t('admin.obsOverlayModeQueueHint', { defaultValue: 'Shows one meme at a time.' })
                              : t('admin.obsOverlayModeUnlimitedHint', { defaultValue: 'Shows all incoming memes at once (no limit).' })}
                          </div>
                        </div>

                        <div className="pt-1">
                          {overlayMode === 'simultaneous' ? (
                            <>
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                                {t('admin.obsOverlayMaxConcurrent', { defaultValue: 'Max simultaneous memes' })}:{' '}
                                <span className="font-mono">{overlayMaxConcurrent}</span>
                              </label>
                              <input
                                type="range"
                                min={1}
                                max={5}
                                step={1}
                                value={overlayMaxConcurrent}
                                onChange={(e) => setOverlayMaxConcurrent(parseInt(e.target.value, 10))}
                                className="w-full"
                                disabled={loadingOverlaySettings || savingOverlaySettings}
                              />
                              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                {t('admin.obsOverlayMaxConcurrentHint', {
                                  defaultValue: 'Safety limit for unlimited mode (prevents OBS from lagging).',
                                })}
                              </div>
                            </>
                          ) : (
                            <div className="flex items-start gap-3 pt-7">
                              <input
                                id="overlayShowSenderBasic"
                                type="checkbox"
                                checked={overlayShowSender}
                                onChange={(e) => setOverlayShowSender(e.target.checked)}
                                className="mt-1 h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                                disabled={loadingOverlaySettings || savingOverlaySettings}
                              />
                              <label htmlFor="overlayShowSenderBasic" className="text-sm text-gray-800 dark:text-gray-100">
                                <div className="font-medium">{t('admin.obsOverlayShowSender', { defaultValue: 'Show sender name' })}</div>
                                <div className="text-xs text-gray-600 dark:text-gray-300">
                                  {t('admin.obsOverlayShowSenderHint', { defaultValue: 'Displayed on top of the meme.' })}
                                </div>
                              </label>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                            {t('admin.obsOverlayAnim', { defaultValue: 'Animation' })}
                          </label>
                          <select
                            value={urlAnim}
                            onChange={(e) => setUrlAnim(e.target.value as UrlAnim)}
                            className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            <option value="fade">{t('admin.obsOverlayAnimFade', { defaultValue: 'Fade' })}</option>
                            <option value="slide-up">{t('admin.obsOverlayAnimSlideUp', { defaultValue: 'Slide up' })}</option>
                            <option value="pop">{t('admin.obsOverlayAnimPop', { defaultValue: 'Pop' })}</option>
                            <option value="none">{t('admin.obsOverlayAnimNone', { defaultValue: 'None' })}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                            {t('admin.obsOverlayVolume', { defaultValue: 'Volume' })}:{' '}
                            <span className="font-mono">{Math.round(urlVolume * 100)}%</span>
                          </label>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={urlVolume}
                            onChange={(e) => setUrlVolume(parseFloat(e.target.value))}
                            className="w-full"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                            {t('admin.obsOverlayEasing', { defaultValue: 'Easing' })}
                          </label>
                          <select
                            value={animEasingPreset === 'custom' ? 'ios' : animEasingPreset}
                            onChange={(e) => setAnimEasingPreset(e.target.value as AnimEasingPreset)}
                            className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            <option value="ios">{t('admin.obsOverlayEasingIos', { defaultValue: 'iOS (default)' })}</option>
                            <option value="smooth">{t('admin.obsOverlayEasingSmooth', { defaultValue: 'Smooth' })}</option>
                            <option value="snappy">{t('admin.obsOverlayEasingSnappy', { defaultValue: 'Snappy' })}</option>
                            <option value="linear">{t('admin.obsOverlayEasingLinear', { defaultValue: 'Linear' })}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                            {t('admin.obsOverlayAnimSpeed', { defaultValue: 'Animation speed' })}:{' '}
                            <span className="font-mono">{animSpeedPct}%</span>
                          </label>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={animSpeedPct}
                            onChange={(e) => setAnimSpeedPct(parseInt(e.target.value, 10))}
                            className="w-full"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <input
                          id="glassEnabledBasic"
                          type="checkbox"
                          checked={glassEnabled}
                          onChange={(e) => setGlassEnabled(e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                        />
                        <label htmlFor="glassEnabledBasic" className="text-sm text-gray-800 dark:text-gray-100">
                          <div className="font-medium">{t('admin.obsGlassEnabled', { defaultValue: 'Glass effect' })}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-300">
                            {t('admin.obsGlassEnabledHint', { defaultValue: 'Can look great, but may cost performance in OBS.' })}
                          </div>
                        </label>
                      </div>

                      <div className="flex items-start gap-3 pt-2 border-t border-white/15 dark:border-white/10">
                        <input
                          id="performanceMode"
                          type="checkbox"
                          checked={performanceMode}
                          onChange={() => togglePerformanceMode()}
                          className="mt-1 h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                        />
                        <label htmlFor="performanceMode" className="text-sm text-gray-800 dark:text-gray-100">
                          <div className="font-medium">{t('admin.obsPerformanceMode', { defaultValue: 'Performance mode' })}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-300">
                            {t('admin.obsPerformanceModeHint', { defaultValue: 'Disables blur/glass and reduces heavy effects to keep OBS smooth.' })}
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                <div className={obsUiMode === 'pro' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'hidden'}>
              <div className={advancedTab === 'layout' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayPosition', { defaultValue: 'РџРѕР·РёС†РёСЏ' })}
                </label>
                <select
                  value={urlPosition}
                  onChange={(e) => setUrlPosition(e.target.value as UrlPosition)}
                  className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="random">{t('admin.obsOverlayPositionRandom')}</option>
                  <option value="center">{t('admin.obsOverlayPositionCenter')}</option>
                  <option value="top">{t('admin.obsOverlayPositionTop')}</option>
                  <option value="bottom">{t('admin.obsOverlayPositionBottom')}</option>
                  <option value="top-left">{t('admin.obsOverlayPositionTopLeft')}</option>
                  <option value="top-right">{t('admin.obsOverlayPositionTopRight')}</option>
                  <option value="bottom-left">{t('admin.obsOverlayPositionBottomLeft')}</option>
                  <option value="bottom-right">{t('admin.obsOverlayPositionBottomRight')}</option>
                </select>
              </div>

              <div className={advancedTab === 'layout' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlaySafeArea', { defaultValue: 'Safe area (px)' })}:{' '}
                  <span className="font-mono">{safePad}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={240}
                  step={4}
                  value={safePad}
                  onChange={(e) => {
                    setSafePad(parseInt(e.target.value, 10));
                    flashSafeGuide();
                  }}
                  onPointerDown={() => {
                    setPreviewLockPositions(true);
                    flashSafeGuide();
                  }}
                  onPointerUp={() => setPreviewLockPositions(false)}
                  className="w-full"
                />
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  {t('admin.obsOverlaySafeAreaHint', { defaultValue: 'Keeps memes away from the edges to avoid clipping.' })}
                </div>
              </div>

              <div className={`md:col-span-2 ${advancedTab === 'layout' ? '' : 'hidden'}`}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  {t('admin.obsOverlayScaleMode', { defaultValue: 'Size' })}
                </label>
                <div className="flex items-center gap-3">
                  <select
                    value={scaleMode}
                    onChange={(e) => setScaleMode(e.target.value as ScaleMode)}
                    className="rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="fixed">{t('admin.obsOverlayScaleFixed', { defaultValue: 'Fixed' })}</option>
                    <option value="range">{t('admin.obsOverlayScaleRange', { defaultValue: 'Range' })}</option>
                  </select>

                  {scaleMode === 'fixed' ? (
                    <div className="flex-1">
                      <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">
                        {t('admin.obsOverlayScaleFixedValue', { defaultValue: 'Scale' })}:{' '}
                        <span className="font-mono">{scaleFixed.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={0.25}
                        max={2.5}
                        step={0.05}
                        value={scaleFixed}
                        onChange={(e) => setScaleFixed(parseFloat(e.target.value))}
                        onPointerDown={() => setPreviewLockPositions(true)}
                        onPointerUp={() => setPreviewLockPositions(false)}
                        className="w-full"
                      />
                    </div>
                  ) : (
                    <div className="flex-1 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">
                          {t('admin.obsOverlayScaleMin', { defaultValue: 'Min' })}:{' '}
                          <span className="font-mono">{scaleMin.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={0.25}
                          max={2.5}
                          step={0.05}
                          value={scaleMin}
                          onChange={(e) => setScaleMin(parseFloat(e.target.value))}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">
                          {t('admin.obsOverlayScaleMax', { defaultValue: 'Max' })}:{' '}
                          <span className="font-mono">{scaleMax.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={0.25}
                          max={2.5}
                          step={0.05}
                          value={scaleMax}
                          onChange={(e) => setScaleMax(parseFloat(e.target.value))}
                          className="w-full"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className={advancedTab === 'layout' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayVolume', { defaultValue: 'Volume' })}: <span className="font-mono">{Math.round(urlVolume * 100)}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={urlVolume}
                  onChange={(e) => setUrlVolume(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'animation' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayAnim', { defaultValue: 'Animation' })}
                </label>
                <select
                  value={urlAnim}
                  onChange={(e) => setUrlAnim(e.target.value as UrlAnim)}
                  className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="fade">{t('admin.obsOverlayAnimFade', { defaultValue: 'Fade' })}</option>
                  <option value="zoom">{t('admin.obsOverlayAnimZoom', { defaultValue: 'Zoom' })}</option>
                  <option value="slide-up">{t('admin.obsOverlayAnimSlideUp', { defaultValue: 'Slide up' })}</option>
                  <option value="pop">{t('admin.obsOverlayAnimPop', { defaultValue: 'Pop (premium)' })}</option>
                  <option value="lift">{t('admin.obsOverlayAnimLift', { defaultValue: 'Lift (premium)' })}</option>
                  <option value="none">{t('admin.obsOverlayAnimNone', { defaultValue: 'None' })}</option>
                </select>
              </div>

              <div className={advancedTab === 'animation' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayAnimEasing', { defaultValue: 'Easing' })}
                </label>
                <select
                  value={animEasingPreset}
                  onChange={(e) => setAnimEasingPreset(e.target.value as AnimEasingPreset)}
                  className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="ios">{t('admin.obsOverlayAnimEasingIos', { defaultValue: 'iOS' })}</option>
                  <option value="smooth">{t('admin.obsOverlayAnimEasingSmooth', { defaultValue: 'Smooth' })}</option>
                  <option value="snappy">{t('admin.obsOverlayAnimEasingSnappy', { defaultValue: 'Snappy' })}</option>
                  <option value="linear">{t('admin.obsOverlayAnimEasingLinear', { defaultValue: 'Linear' })}</option>
                  <option value="custom">{t('admin.obsOverlayAnimEasingCustom', { defaultValue: 'Custom cubic-bezier' })}</option>
                </select>
                <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                  {t('admin.obsOverlayAnimEasingHint', { defaultValue: 'Controls the feel of enter/exit. iOS is the recommended default.' })}
                </div>
              </div>

              {animEasingPreset === 'custom' && (
                <div className={`md:col-span-2 ${advancedTab === 'animation' ? '' : 'hidden'}`}>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">x1</label>
                      <input
                        type="number"
                        value={animEasingX1}
                        step={0.01}
                        min={-1}
                        max={2}
                        onChange={(e) => setAnimEasingX1(parseFloat(e.target.value))}
                        className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">y1</label>
                      <input
                        type="number"
                        value={animEasingY1}
                        step={0.01}
                        min={-1}
                        max={2}
                        onChange={(e) => setAnimEasingY1(parseFloat(e.target.value))}
                        className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">x2</label>
                      <input
                        type="number"
                        value={animEasingX2}
                        step={0.01}
                        min={-1}
                        max={2}
                        onChange={(e) => setAnimEasingX2(parseFloat(e.target.value))}
                        className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">y2</label>
                      <input
                        type="number"
                        value={animEasingY2}
                        step={0.01}
                        min={-1}
                        max={2}
                        onChange={(e) => setAnimEasingY2(parseFloat(e.target.value))}
                        className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className={advancedTab === 'animation' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayAnimSpeed', { defaultValue: 'Animation speed' })}:{' '}
                  <span className="font-mono">{animSpeedPct}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={animSpeedPct}
                  onChange={(e) => setAnimSpeedPct(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={`text-xs text-gray-600 dark:text-gray-300 -mt-2 ${advancedTab === 'animation' ? '' : 'hidden'}`}>
                {t('admin.obsOverlayAnimSpeedHint', { defaultValue: 'Slower looks more premium; faster feels snappier.' })}
              </div>

              <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayShadow', { defaultValue: 'Shadow' })}: <span className="font-mono">{shadowBlur}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={2}
                  value={shadowBlur}
                  onChange={(e) => setShadowBlur(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayShadowAngle', { defaultValue: 'Shadow direction' })}:{' '}
                  <span className="font-mono">{Math.round(shadowAngle)}В°</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={1}
                  value={shadowAngle}
                  onChange={(e) => setShadowAngle(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayShadowDistance', { defaultValue: 'Shadow distance' })}:{' '}
                  <span className="font-mono">{shadowDistance}px</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={120}
                  step={1}
                  value={shadowDistance}
                  onChange={(e) => setShadowDistance(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayShadowSpread', { defaultValue: 'Shadow spread' })}:{' '}
                  <span className="font-mono">{shadowSpread}px</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={120}
                  step={1}
                  value={shadowSpread}
                  onChange={(e) => setShadowSpread(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayShadowOpacity', { defaultValue: 'Shadow opacity' })}:{' '}
                  <span className="font-mono">{Math.round(shadowOpacity * 100)}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={shadowOpacity}
                  onChange={(e) => setShadowOpacity(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'shadow' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayShadowColor', { defaultValue: 'Shadow color' })}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={shadowColor}
                    onChange={(e) => setShadowColor(String(e.target.value || '').toLowerCase())}
                    className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                    aria-label={t('admin.obsOverlayShadowColor', { defaultValue: 'Shadow color' })}
                  />
                  <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{shadowColor}</div>
                </div>
              </div>

              <div className={advancedTab === 'glass' ? '' : 'hidden'}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    {t('admin.obsOverlayGlassEnabled', { defaultValue: 'Glass' })}
                  </label>
                  <button
                    type="button"
                    onClick={() => setGlassEnabled((v) => !v)}
                    className={`glass-btn px-3 py-1.5 text-sm font-semibold ${glassEnabled ? 'ring-2 ring-primary/40' : 'opacity-70'}`}
                  >
                    {glassEnabled ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })}
                  </button>
                </div>

                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayGlassStyle', { defaultValue: 'Glass style' })}
                </label>
                <select
                  value={glassPreset}
                  onChange={(e) => setGlassPreset(e.target.value as GlassPreset)}
                  disabled={!glassEnabled}
                  className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                >
                  <option value="ios">{t('admin.obsOverlayGlassPresetIos', { defaultValue: 'iOS (shine)' })}</option>
                  <option value="clear">{t('admin.obsOverlayGlassPresetClear', { defaultValue: 'Clear' })}</option>
                  <option value="prism">{t('admin.obsOverlayGlassPresetPrism', { defaultValue: 'Prism' })}</option>
                </select>
              </div>

              <div className={advancedTab === 'glass' ? '' : 'hidden'}>
                <div className="glass p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                    {t('admin.obsOverlayGlassPresetControls', { defaultValue: 'Preset controls' })}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                        {t('admin.obsOverlayGlassTintColor', { defaultValue: 'Tint color' })}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={glassTintColor}
                          onChange={(e) => setGlassTintColor(String(e.target.value || '').toLowerCase())}
                          disabled={!glassEnabled}
                          className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent disabled:opacity-50"
                        />
                        <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{glassTintColor}</div>
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                        {t('admin.obsOverlayGlassTintStrength', { defaultValue: 'Tint strength' })}:{' '}
                        <span className="font-mono">{Math.round(glassTintStrength * 100)}%</span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.02}
                        value={glassTintStrength}
                        onChange={(e) => setGlassTintStrength(parseFloat(e.target.value))}
                        disabled={!glassEnabled}
                        className="w-full disabled:opacity-50"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className={advancedTab === 'glass' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayBlur', { defaultValue: 'Glass blur' })}: <span className="font-mono">{urlBlur}px</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={urlBlur}
                  onChange={(e) => setUrlBlur(parseInt(e.target.value, 10))}
                  disabled={!glassEnabled}
                  className="w-full disabled:opacity-50"
                />
              </div>

              <div className={advancedTab === 'border' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayBorderPreset', { defaultValue: 'Frame style' })}
                </label>
                <select
                  value={borderPreset}
                  onChange={(e) => setBorderPreset(e.target.value as BorderPreset)}
                  className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="custom">{t('admin.obsOverlayBorderPresetCustom', { defaultValue: 'Custom' })}</option>
                  <option value="glass">{t('admin.obsOverlayBorderPresetGlass', { defaultValue: 'Glass frame' })}</option>
                  <option value="glow">{t('admin.obsOverlayBorderPresetGlow', { defaultValue: 'Glow' })}</option>
                  <option value="frosted">{t('admin.obsOverlayBorderPresetFrosted', { defaultValue: 'Frosted edge' })}</option>
                </select>
                <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                  {t('admin.obsOverlayBorderPresetHint', { defaultValue: 'Presets override the visual style of the frame (still uses your thickness/radius).' })}
                </div>
              </div>

              <div className={advancedTab === 'border' ? '' : 'hidden'}>
                {borderPreset !== 'custom' && (
                  <div className="glass p-3 mb-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                      {t('admin.obsOverlayBorderPresetControls', { defaultValue: 'Preset controls' })}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.obsOverlayBorderTintColor', { defaultValue: 'Tint color' })}
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={borderTintColor}
                            onChange={(e) => setBorderTintColor(String(e.target.value || '').toLowerCase())}
                            className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                          />
                          <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{borderTintColor}</div>
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.obsOverlayBorderTintStrength', { defaultValue: 'Tint strength' })}:{' '}
                          <span className="font-mono">{Math.round(borderTintStrength * 100)}%</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.02}
                          value={borderTintStrength}
                          onChange={(e) => setBorderTintStrength(parseFloat(e.target.value))}
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>
                )}
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayBorder', { defaultValue: 'Border' })}: <span className="font-mono">{urlBorder}px</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={12}
                  step={1}
                  value={urlBorder}
                  onChange={(e) => setUrlBorder(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'border' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayRadius', { defaultValue: 'Corner radius' })}: <span className="font-mono">{urlRadius}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={80}
                  step={1}
                  value={urlRadius}
                  onChange={(e) => setUrlRadius(parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>

              <div className={advancedTab === 'border' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayBorderColor', { defaultValue: 'Border color' })}
                </label>
                <div className="flex items-center justify-between gap-3">
                  <select
                    value={borderMode}
                    onChange={(e) => setBorderMode(e.target.value as BorderMode)}
                    disabled={borderPreset !== 'custom'}
                    className="rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                    aria-label={t('admin.obsOverlayBorderMode', { defaultValue: 'Border mode' })}
                  >
                    <option value="solid">{t('admin.obsOverlayBorderModeSolid', { defaultValue: 'Solid' })}</option>
                    <option value="gradient">{t('admin.obsOverlayBorderModeGradient', { defaultValue: 'Gradient' })}</option>
                  </select>
                  <input
                    type="color"
                    value={urlBorderColor}
                    onChange={(e) => setUrlBorderColor(String(e.target.value || '').toLowerCase())}
                    disabled={borderPreset !== 'custom'}
                    className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent disabled:opacity-50"
                    aria-label={t('admin.obsOverlayBorderColor', { defaultValue: 'Border color' })}
                  />
                  <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{urlBorderColor}</div>
                </div>
              </div>

              {borderPreset === 'custom' && borderMode === 'gradient' && (
                <div className={`md:col-span-2 ${advancedTab === 'border' ? '' : 'hidden'}`}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                        {t('admin.obsOverlayBorderColor2', { defaultValue: 'Gradient color 2' })}
                      </label>
                      <input
                        type="color"
                        value={urlBorderColor2}
                        onChange={(e) => setUrlBorderColor2(String(e.target.value || '').toLowerCase())}
                        className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                        aria-label={t('admin.obsOverlayBorderColor2', { defaultValue: 'Gradient color 2' })}
                      />
                      <div className="text-xs text-gray-600 dark:text-gray-300 font-mono mt-1">{urlBorderColor2}</div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                        {t('admin.obsOverlayBorderGradientAngle', { defaultValue: 'Gradient angle' })}:{' '}
                        <span className="font-mono">{Math.round(urlBorderGradientAngle)}В°</span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        step={1}
                        value={urlBorderGradientAngle}
                        onChange={(e) => setUrlBorderGradientAngle(parseInt(e.target.value, 10))}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className={advancedTab === 'glass' ? '' : 'hidden'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.obsOverlayBgOpacity', { defaultValue: 'Glass opacity' })}:{' '}
                  <span className="font-mono">{Math.round(urlBgOpacity * 100)}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={0.65}
                  step={0.01}
                  value={urlBgOpacity}
                  onChange={(e) => setUrlBgOpacity(parseFloat(e.target.value))}
                  disabled={!glassEnabled}
                  className="w-full disabled:opacity-50"
                />
              </div>

              {overlayShowSender && (
              <div className={`md:col-span-2 ${advancedTab === 'sender' ? '' : 'hidden'}`}>
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  {t('admin.obsOverlaySenderTypography', { defaultValue: 'Sender label' })}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-3">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderHold', { defaultValue: 'Show duration' })}:{' '}
                      <span className="font-mono">{Math.round(senderHoldMs / 100) / 10}s</span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={8000}
                      step={100}
                      value={senderHoldMs}
                      onChange={(e) => setSenderHoldMs(parseInt(e.target.value, 10))}
                      className="w-full"
                    />
                    <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                      {t('admin.obsOverlaySenderHoldHint', { defaultValue: '0s = stay visible the whole meme.' })}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderFontSize', { defaultValue: 'Font size' })}:{' '}
                      <span className="font-mono">{senderFontSize}px</span>
                    </label>
                    <input
                      type="range"
                      min={10}
                      max={28}
                      step={1}
                      value={senderFontSize}
                      onChange={(e) => setSenderFontSize(parseInt(e.target.value, 10))}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderFontWeight', { defaultValue: 'Weight' })}
                    </label>
                    <select
                      value={senderFontWeight}
                      onChange={(e) => setSenderFontWeight(parseInt(e.target.value, 10))}
                      className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <option value={400}>400</option>
                      <option value={500}>500</option>
                      <option value={600}>600</option>
                      <option value={700}>700</option>
                      <option value={800}>800</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderFontFamily', { defaultValue: 'Font' })}
                    </label>
                    <select
                      value={senderFontFamily}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (isSenderFontFamily(v)) setSenderFontFamily(v);
                      }}
                      className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <option value="system">{t('admin.obsOverlaySenderFontSystem', { defaultValue: 'System' })}</option>
                      <option value="inter">Inter</option>
                      <option value="roboto">Roboto</option>
                      <option value="montserrat">Montserrat</option>
                      <option value="poppins">Poppins</option>
                      <option value="raleway">Raleway</option>
                      <option value="nunito">Nunito</option>
                      <option value="oswald">Oswald</option>
                      <option value="playfair">Playfair Display</option>
                      <option value="jetbrains-mono">JetBrains Mono</option>
                      <option value="mono">{t('admin.obsOverlaySenderFontMono', { defaultValue: 'Monospace' })}</option>
                      <option value="serif">{t('admin.obsOverlaySenderFontSerif', { defaultValue: 'Serif' })}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderFontColor', { defaultValue: 'Text color' })}
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={senderFontColor}
                        onChange={(e) => setSenderFontColor(String(e.target.value || '').toLowerCase())}
                        className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                      />
                      <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{senderFontColor}</div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderBgColor', { defaultValue: 'Background color' })}
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={senderBgColor}
                        onChange={(e) => setSenderBgColor(String(e.target.value || '').toLowerCase())}
                        className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                      />
                      <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{senderBgColor}</div>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderBgOpacity', { defaultValue: 'Background opacity' })}:{' '}
                      <span className="font-mono">{Math.round(senderBgOpacity * 100)}%</span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={senderBgOpacity}
                      onChange={(e) => setSenderBgOpacity(parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      {t('admin.obsOverlaySenderBgRadius', { defaultValue: 'Background radius' })}:{' '}
                      <span className="font-mono">{senderBgRadius}</span>
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={60}
                        step={1}
                        value={senderBgRadius}
                        onChange={(e) => setSenderBgRadius(parseInt(e.target.value, 10))}
                        className="w-full"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="glass-btn shrink-0"
                        onClick={() => setSenderBgRadius(999)}
                      >
                        {t('admin.obsOverlaySenderBgPill', { defaultValue: 'Pill' })}
                      </Button>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                      {t('admin.obsOverlaySenderBgRadiusHint', { defaultValue: 'Tip: try 8вЂ“16 for a modern rounded rectangle.' })}
                    </div>
                  </div>

                  <div className="md:col-span-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                      {t('admin.obsOverlaySenderStrokeTitle', { defaultValue: 'Label border' })}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.obsOverlaySenderStrokeStyle', { defaultValue: 'Style' })}
                        </label>
                        <select
                          value={senderStroke}
                          onChange={(e) => setSenderStroke(e.target.value as SenderStroke)}
                          className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          <option value="glass">{t('admin.obsOverlaySenderStrokeGlass', { defaultValue: 'Glass' })}</option>
                          <option value="solid">{t('admin.obsOverlaySenderStrokeSolid', { defaultValue: 'Solid' })}</option>
                          <option value="none">{t('admin.obsOverlaySenderStrokeNone', { defaultValue: 'None' })}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.obsOverlaySenderStrokeWidth', { defaultValue: 'Width' })}:{' '}
                          <span className="font-mono">{senderStrokeWidth}px</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={6}
                          step={1}
                          value={senderStrokeWidth}
                          onChange={(e) => setSenderStrokeWidth(parseInt(e.target.value, 10))}
                          className="w-full"
                          disabled={senderStroke === 'none'}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.obsOverlaySenderStrokeOpacity', { defaultValue: 'Opacity' })}:{' '}
                          <span className="font-mono">{Math.round(senderStrokeOpacity * 100)}%</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.02}
                          value={senderStrokeOpacity}
                          onChange={(e) => setSenderStrokeOpacity(parseFloat(e.target.value))}
                          className="w-full"
                          disabled={senderStroke === 'none'}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                          {t('admin.obsOverlaySenderStrokeColor', { defaultValue: 'Color' })}
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={senderStrokeColor}
                            onChange={(e) => setSenderStrokeColor(String(e.target.value || '').toLowerCase())}
                            className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent"
                            disabled={senderStroke !== 'solid'}
                          />
                          <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{senderStrokeColor}</div>
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                          {t('admin.obsOverlaySenderStrokeHint', { defaultValue: 'Glass uses automatic highlights; Solid uses your color.' })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </div>
          </div>
          </div>
            </details>
          </>
        ) : (
          <div className="glass p-4 space-y-4">
            {(loadingCreditsSettings || savingCreditsSettings) && <SavingOverlay label={t('admin.saving')} />}
            {creditsSettingsSavedPulse && !savingCreditsSettings && !loadingCreditsSettings && <SavedOverlay label={t('admin.saved')} />}

            {/* Credits session: collapseable to keep UX clean as more sections appear (donors/raiders/...) */}
            <details className="glass p-3">
              <summary className="cursor-pointer">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {t('admin.creditsSessionTitle', { defaultValue: 'Сессия титров' })}
                    </div>
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {t('admin.creditsSessionHint', { defaultValue: 'Списки зрителей/донатеров и настройки сессии. Разворачивается по секциям.' })}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-xs text-gray-600 dark:text-gray-300">
                      {t('admin.creditsViewersTitle', { defaultValue: 'Зрители' })}:{' '}
                      <span className="font-mono">{creditsChatters.length}</span>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-300">
                      {t('admin.creditsIgnoredChattersShort', { defaultValue: 'Игнор' })}:{' '}
                      <span className="font-mono">{creditsIgnoredChatters.length}</span>
                    </div>
                  </div>
                </div>
              </summary>

              <div className="mt-3 space-y-3">
                {/* Viewers (chatters) */}
                <details className="glass p-3">
                  <summary className="cursor-pointer">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t('admin.creditsViewersTitle', { defaultValue: 'Зрители трансляции' })}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        {t('admin.count', { defaultValue: 'count' })}: <span className="font-mono">{creditsChatters.length}</span>
                      </div>
                    </div>
                  </summary>
                  <div className="mt-2">
                    <div className="text-xs text-gray-600 dark:text-gray-300">
                      {t('admin.creditsViewersHint', {
                        defaultValue:
                          'Список формируется по сообщениям в чате во время стрима. Аккаунты между платформами склеиваются на бэке; боты MemAlerts игнорируются автоматически.',
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white disabled:opacity-60"
                        onClick={() => void loadCreditsState()}
                        disabled={loadingCreditsState}
                      >
                        {loadingCreditsState ? t('common.loading', { defaultValue: 'Loading…' }) : t('common.refresh', { defaultValue: 'Обновить' })}
                      </button>
                    </div>
                    <div className="mt-3 max-h-40 overflow-auto rounded-lg bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-2">
                      {creditsChatters.length === 0 ? (
                        <div className="text-xs text-gray-600 dark:text-gray-300">
                          {t('admin.creditsNoViewers', { defaultValue: 'Пока пусто. Зрители появятся, когда кто-то напишет в чат во время стрима.' })}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {creditsChatters.map((c, idx) => (
                            <span
                              key={`${String(c?.name || '').toLowerCase()}_${idx}`}
                              className="px-2 py-1 text-xs rounded-md bg-accent/15 text-accent ring-1 ring-accent/20"
                            >
                              {String(c?.name || '').trim()}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </details>

                {/* Reconnect window */}
                <details className="glass p-3">
                  <summary className="cursor-pointer">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t('admin.creditsReconnectWindowTitle', { defaultValue: 'Мёртвая зона (окно переподключения)' })}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        <span className="font-mono">{creditsReconnectWindowMinutes ?? '—'}</span> min
                      </div>
                    </div>
                  </summary>
                  <div className="mt-2">
                    <div className="text-xs text-gray-600 dark:text-gray-300">
                      {t('admin.creditsReconnectWindowHint', {
                        defaultValue:
                          'Сессия зрителей сохраняется X минут после офлайна, чтобы стрим можно было перезапустить без потери списка.',
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={creditsReconnectWindowInput}
                        onChange={(e) => setCreditsReconnectWindowInput(e.target.value)}
                        placeholder={creditsReconnectWindowMinutes === null ? 'min' : String(creditsReconnectWindowMinutes)}
                        className="w-32 px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                        disabled={savingReconnectWindow}
                      />
                      <button
                        type="button"
                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-60"
                        onClick={() => void saveCreditsReconnectWindow()}
                        disabled={savingReconnectWindow}
                      >
                        {savingReconnectWindow ? t('common.loading', { defaultValue: 'Loading…' }) : t('common.save', { defaultValue: 'Сохранить' })}
                      </button>
                    </div>
                  </div>
                </details>

                {/* Reset viewers list */}
                <details className="glass p-3">
                  <summary className="cursor-pointer">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t('admin.creditsResetTitle', { defaultValue: 'Сбросить список зрителей' })}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        {t('admin.action', { defaultValue: 'action' })}
                      </div>
                    </div>
                  </summary>
                  <div className="mt-2">
                    <div className="text-xs text-gray-600 dark:text-gray-300">
                      {t('admin.creditsResetHint', {
                        defaultValue: 'Начать новую сессию зрителей (новая трансляция → новый список).',
                      })}
                    </div>
                    <div className="mt-3">
                      <button
                        type="button"
                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white disabled:opacity-60"
                        onClick={() => void resetCreditsSession()}
                        disabled={resettingCredits}
                      >
                        {resettingCredits ? t('common.loading', { defaultValue: 'Loading…' }) : t('admin.reset', { defaultValue: 'Сбросить' })}
                      </button>
                    </div>
                  </div>
                </details>

                {/* Ignore list */}
                <details className="glass p-3">
                  <summary className="cursor-pointer">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t('admin.creditsIgnoredChattersTitle', { defaultValue: 'Игнорируемые имена (боты)' })}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        {t('admin.count', { defaultValue: 'count' })}: <span className="font-mono">{creditsIgnoredChatters.length}</span>
                      </div>
                    </div>
                  </summary>
                  <div className="mt-2">
                    <div className="text-xs text-gray-600 dark:text-gray-300">
                      {t('admin.creditsIgnoredChattersHint', {
                        defaultValue:
                          'По одному нику на строку. Сравнение без учёта регистра. Авто-боты MemAlerts игнорируются сами.',
                      })}
                    </div>
                    <div className="mt-3 space-y-2">
                      <Textarea
                        value={creditsIgnoredChattersText}
                        onChange={(e) => setCreditsIgnoredChattersText(e.target.value)}
                        rows={4}
                        className="font-mono text-xs"
                        placeholder="nightbot\nstreamelements\n..."
                        disabled={loadingIgnoredChatters || savingIgnoredChatters}
                      />
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          className="px-3 py-2 rounded-lg text-sm font-semibold bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white disabled:opacity-60"
                          onClick={() => void loadCreditsIgnoredChatters()}
                          disabled={loadingIgnoredChatters}
                        >
                          {loadingIgnoredChatters ? t('common.loading', { defaultValue: 'Loading…' }) : t('common.refresh', { defaultValue: 'Обновить' })}
                        </button>
                        <button
                          type="button"
                          className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-60"
                          onClick={() => void saveCreditsIgnoredChatters()}
                          disabled={savingIgnoredChatters}
                        >
                          {savingIgnoredChatters ? t('common.loading', { defaultValue: 'Loading…' }) : t('common.save', { defaultValue: 'Сохранить' })}
                        </button>
                      </div>
                    </div>
                  </div>
                </details>

                {/* Future sections placeholders */}
                <details className="glass p-3 opacity-70">
                  <summary className="cursor-pointer">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t('admin.creditsFutureSectionsTitle', { defaultValue: 'Ещё секции (в будущем)' })}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        {t('subscription.availableOnlyWithSubscription', { defaultValue: 'скоро' })}
                      </div>
                    </div>
                  </summary>
                  <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                    {t('admin.creditsFutureSectionsHint', { defaultValue: 'Здесь появятся донатеры, рейдеры и другие списки.' })}
                  </div>
                </details>
              </div>
            </details>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-xl overflow-hidden border border-white/20 dark:border-white/10">
                <button
                  type="button"
                  className={`px-3 py-2 text-sm font-semibold ${creditsUiMode === 'quick' ? 'bg-primary text-white' : 'bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white'}`}
                  onClick={() => setCreditsUiMode('quick')}
                >
                  {t('admin.obsUiBasic', { defaultValue: 'Basic' })}
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-sm font-semibold border-l border-white/20 dark:border-white/10 ${creditsUiMode === 'advanced' ? 'bg-primary text-white' : 'bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white'}`}
                  onClick={() => setCreditsUiMode('advanced')}
                >
                  {t('admin.obsUiPro', { defaultValue: 'Pro' })}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyCreditsPreset('minimal')}>
                  {t('admin.creditsPresetMinimal', { defaultValue: 'Minimal' })}
                </Button>
                <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyCreditsPreset('classic')}>
                  {t('admin.creditsPresetClassic', { defaultValue: 'Classic' })}
                </Button>
                <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyCreditsPreset('neon')}>
                  {t('admin.creditsPresetNeon', { defaultValue: 'Neon' })}
                </Button>
                <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyCreditsPreset('fullscreen')}>
                  {t('admin.creditsPresetFullscreen', { defaultValue: 'Fullscreen' })}
                </Button>
              </div>
            </div>

            {/* Quick controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="glass p-3">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">
                    {t('admin.creditsQuickTitles', { defaultValue: 'Заголовки' })}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsTitleText', { defaultValue: 'Верхний заголовок' })}</label>
                      <input
                        value={creditsTitleText}
                        onChange={(e) => setCreditsTitleText(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                        placeholder="Credits"
                        disabled={loadingCreditsSettings || savingCreditsSettings}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsDonorsTitleText', { defaultValue: 'Заголовок донатов' })}</label>
                        <input
                          value={creditsDonorsTitleText}
                          onChange={(e) => setCreditsDonorsTitleText(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                          placeholder="Donors"
                          disabled={loadingCreditsSettings || savingCreditsSettings}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsChattersTitleText', { defaultValue: 'Заголовок чата' })}</label>
                        <input
                          value={creditsChattersTitleText}
                          onChange={(e) => setCreditsChattersTitleText(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                          placeholder="Chatters"
                          disabled={loadingCreditsSettings || savingCreditsSettings}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="glass p-3">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">
                    {t('admin.creditsQuickList', { defaultValue: 'Список' })}
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                      <input
                        type="checkbox"
                        checked={creditsShowNumbers}
                        onChange={(e) => setCreditsShowNumbers(e.target.checked)}
                        className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                        disabled={loadingCreditsSettings || savingCreditsSettings}
                      />
                      {t('admin.creditsShowNumbers', { defaultValue: 'Нумерация (1. 2. 3.)' })}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                      <input
                        type="checkbox"
                        checked={creditsShowAvatars}
                        onChange={(e) => setCreditsShowAvatars(e.target.checked)}
                        className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                        disabled={loadingCreditsSettings || savingCreditsSettings}
                      />
                      {t('admin.creditsShowAvatars', { defaultValue: 'Аватары (если есть)' })}
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsAvatarSize', { defaultValue: 'Размер аватара' })}</label>
                        <input
                          type="number"
                          min={12}
                          max={96}
                          step={1}
                          value={creditsAvatarSize}
                          onChange={(e) => setCreditsAvatarSize(Number(e.target.value) || 12)}
                          className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                          disabled={loadingCreditsSettings || savingCreditsSettings || !creditsShowAvatars}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsAvatarRadius', { defaultValue: 'Скругление' })}</label>
                        <input
                          type="number"
                          min={0}
                          max={999}
                          step={1}
                          value={creditsAvatarRadius}
                          onChange={(e) => setCreditsAvatarRadius(Number(e.target.value) || 0)}
                          className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                          disabled={loadingCreditsSettings || savingCreditsSettings || !creditsShowAvatars}
                        />
                        <div className="text-[11px] text-gray-600 dark:text-gray-300 mt-1">
                          {t('admin.creditsAvatarRadiusHint', { defaultValue: '999 = круг' })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="glass p-3">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">
                    {t('admin.creditsQuickSections', { defaultValue: 'Секции' })}
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                      <input
                        type="checkbox"
                        checked={creditsShowDonors}
                        onChange={(e) => setCreditsShowDonors(e.target.checked)}
                        className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                        disabled={loadingCreditsSettings || savingCreditsSettings}
                      />
                      {t('admin.creditsShowDonors', { defaultValue: 'Донаты (DonationAlerts)' })}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                      <input
                        type="checkbox"
                        checked={creditsShowChatters}
                        onChange={(e) => setCreditsShowChatters(e.target.checked)}
                        className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                        disabled={loadingCreditsSettings || savingCreditsSettings}
                      />
                      {t('admin.creditsShowChatters', { defaultValue: 'Чат (Twitch)' })}
                    </label>
                    <div>
                      <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                        {t('admin.creditsSectionsOrder', { defaultValue: 'Порядок' })}
                      </label>
                      <select
                        value={creditsSectionsOrder[0] === 'donors' ? 'donors-first' : 'chatters-first'}
                        onChange={(e) => {
                          const v = String(e.target.value || '');
                          setCreditsSectionsOrder(v === 'chatters-first' ? ['chatters', 'donors'] : ['donors', 'chatters']);
                        }}
                        className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                        disabled={loadingCreditsSettings || savingCreditsSettings}
                      >
                        <option value="donors-first">{t('admin.creditsOrderDonorsFirst', { defaultValue: 'Донаты → Чат' })}</option>
                        <option value="chatters-first">{t('admin.creditsOrderChattersFirst', { defaultValue: 'Чат → Донаты' })}</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.fontFamily', { defaultValue: 'Шрифт' })}</label>
                  <select
                    value={creditsFontFamily}
                    onChange={(e) => setCreditsFontFamily(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                    disabled={loadingCreditsSettings || savingCreditsSettings}
                  >
                    <option value="system">System</option>
                    <option value="Inter">Inter (Google)</option>
                    <option value="Roboto">Roboto (Google)</option>
                    <option value="Montserrat">Montserrat (Google)</option>
                    <option value="Poppins">Poppins (Google)</option>
                    <option value="Oswald">Oswald (Google)</option>
                    <option value="Raleway">Raleway (Google)</option>
                    <option value="Nunito">Nunito (Google)</option>
                    <option value="Playfair Display">Playfair Display (Google)</option>
                    <option value="JetBrains Mono">JetBrains Mono (Google)</option>
                  </select>
                  <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                    {t('admin.creditsGoogleFontsHint', { defaultValue: 'Google Fonts подгружаются автоматически в оверлее (без загрузки файлов).' })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.fontSize', { defaultValue: 'Размер' })}</label>
                    <input
                      type="number"
                      min={10}
                      max={96}
                      step={0.5}
                      value={creditsFontSize}
                      onChange={(e) => setCreditsFontSize(Number(e.target.value) || 10)}
                      className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                      disabled={loadingCreditsSettings || savingCreditsSettings}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsTextAlign', { defaultValue: 'Выравнивание' })}</label>
                    <select
                      value={creditsTextAlign}
                      onChange={(e) => setCreditsTextAlign(e.target.value as CreditsTextAlign)}
                      className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                      disabled={loadingCreditsSettings || savingCreditsSettings}
                    >
                      <option value="left">{t('admin.alignLeft', { defaultValue: 'Left' })}</option>
                      <option value="center">{t('admin.alignCenter', { defaultValue: 'Center' })}</option>
                      <option value="right">{t('admin.alignRight', { defaultValue: 'Right' })}</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="glass p-3">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">
                    {t('admin.creditsQuickBackground', { defaultValue: 'Фон' })}
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                        {t('admin.creditsBackgroundMode', { defaultValue: 'Режим фона' })}
                      </label>
                      <select
                        value={creditsBackgroundMode}
                        onChange={(e) => setCreditsBackgroundMode(e.target.value as CreditsBackgroundMode)}
                        className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                        disabled={loadingCreditsSettings || savingCreditsSettings}
                      >
                        <option value="transparent">{t('admin.creditsBackgroundModeTransparent', { defaultValue: 'Прозрачный' })}</option>
                        <option value="card">{t('admin.creditsBackgroundModeCard', { defaultValue: 'Карточка' })}</option>
                        <option value="full">{t('admin.creditsBackgroundModeFull', { defaultValue: 'На весь экран' })}</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                          {t('admin.creditsBgOpacity', { defaultValue: 'Прозрачность' })}
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={0.85}
                          step={0.01}
                          value={creditsBgOpacity}
                          onChange={(e) => setCreditsBgOpacity(parseFloat(e.target.value))}
                          className="w-full"
                          disabled={creditsBackgroundMode === 'transparent' || loadingCreditsSettings || savingCreditsSettings}
                        />
                        <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                          {Math.round(creditsBgOpacity * 100)}%
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                          {t('admin.creditsBlur', { defaultValue: 'Blur' })}
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={40}
                          step={1}
                          value={creditsBlur}
                          onChange={(e) => setCreditsBlur(Number(e.target.value) || 0)}
                          className="w-full"
                          disabled={creditsBackgroundMode === 'transparent' || loadingCreditsSettings || savingCreditsSettings}
                        />
                        <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">{creditsBlur}px</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsScrollSpeed', { defaultValue: 'Скорость прокрутки (px/s)' })}</label>
                  <input
                    type="number"
                    min={8}
                    max={600}
                    value={creditsScrollSpeed}
                    onChange={(e) => setCreditsScrollSpeed(Number(e.target.value) || 8)}
                    className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                    disabled={loadingCreditsSettings || savingCreditsSettings}
                  />
                </div>
                <div className="glass p-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                      <input
                        type="checkbox"
                        checked={creditsLoop}
                        onChange={(e) => setCreditsLoop(e.target.checked)}
                        className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                        disabled={loadingCreditsSettings || savingCreditsSettings}
                      />
                      {t('admin.creditsLoop', { defaultValue: 'Loop' })}
                    </label>
                    <div className="text-xs text-gray-600 dark:text-gray-300">
                      {t('admin.creditsScrollDirection', { defaultValue: 'Направление' })}: {creditsScrollDirection === 'up' ? '↑' : '↓'}
                    </div>
                  </div>
                  <div className="mt-2">
                    <select
                      value={creditsScrollDirection}
                      onChange={(e) => setCreditsScrollDirection(e.target.value as CreditsScrollDirection)}
                      className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                      disabled={loadingCreditsSettings || savingCreditsSettings}
                    >
                      <option value="up">{t('admin.creditsScrollDirectionUp', { defaultValue: 'Вверх' })}</option>
                      <option value="down">{t('admin.creditsScrollDirectionDown', { defaultValue: 'Вниз' })}</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {creditsUiMode === 'advanced' && (
              <>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['layout', t('admin.creditsTabLayout', { defaultValue: 'Layout' })],
                      ['typography', t('admin.creditsTabTypography', { defaultValue: 'Typography' })],
                      ['sections', t('admin.creditsTabSections', { defaultValue: 'Sections' })],
                      ['visual', t('admin.creditsTabVisual', { defaultValue: 'Visual' })],
                      ['motion', t('admin.creditsTabMotion', { defaultValue: 'Motion' })],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        creditsTab === id
                          ? 'bg-primary text-white border-primary'
                          : 'bg-transparent text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                      onClick={() => setCreditsTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {creditsTab === 'layout' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsAnchorX', { defaultValue: 'Anchor X' })}</label>
                          <select
                            value={creditsAnchorX}
                            onChange={(e) => setCreditsAnchorX(e.target.value as CreditsAnchorX)}
                            className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                          >
                            <option value="left">{t('admin.alignLeft', { defaultValue: 'Left' })}</option>
                            <option value="center">{t('admin.alignCenter', { defaultValue: 'Center' })}</option>
                            <option value="right">{t('admin.alignRight', { defaultValue: 'Right' })}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsAnchorY', { defaultValue: 'Anchor Y' })}</label>
                          <select
                            value={creditsAnchorY}
                            onChange={(e) => setCreditsAnchorY(e.target.value as CreditsAnchorY)}
                            className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                          >
                            <option value="top">{t('admin.alignTop', { defaultValue: 'Top' })}</option>
                            <option value="center">{t('admin.alignCenter', { defaultValue: 'Center' })}</option>
                            <option value="bottom">{t('admin.alignBottom', { defaultValue: 'Bottom' })}</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsMaxWidth', { defaultValue: 'Max width (px)' })}</label>
                          <input type="number" min={240} max={2400} value={creditsMaxWidthPx} onChange={(e) => setCreditsMaxWidthPx(Number(e.target.value) || 240)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsMaxHeight', { defaultValue: 'Max height (vh)' })}</label>
                          <input type="number" min={20} max={100} value={creditsMaxHeightVh} onChange={(e) => setCreditsMaxHeightVh(Number(e.target.value) || 20)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsIndent', { defaultValue: 'Indent (px)' })}</label>
                          <input type="number" min={0} max={240} value={creditsIndentPx} onChange={(e) => setCreditsIndentPx(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.lineHeight', { defaultValue: 'Line height' })}</label>
                          <input type="number" min={0.9} max={2.2} step={0.05} value={creditsLineHeight} onChange={(e) => setCreditsLineHeight(Number(e.target.value) || 1.15)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.letterSpacing', { defaultValue: 'Letter spacing (px)' })}</label>
                        <input type="number" min={-2} max={8} step={0.1} value={creditsLetterSpacing} onChange={(e) => setCreditsLetterSpacing(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                      </div>
                    </div>
                  </div>
                )}

                {creditsTab === 'sections' && (
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                      <input type="checkbox" checked={creditsShowDonors} onChange={(e) => setCreditsShowDonors(e.target.checked)} className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10" />
                      {t('admin.creditsShowDonors', { defaultValue: 'Донаты (DonationAlerts)' })}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                      <input type="checkbox" checked={creditsShowChatters} onChange={(e) => setCreditsShowChatters(e.target.checked)} className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10" />
                      {t('admin.creditsShowChatters', { defaultValue: 'Чат (Twitch)' })}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="glass-btn"
                        onClick={() => setCreditsSectionsOrder(['donors', 'chatters'])}
                      >
                        {t('admin.creditsOrderDonorsFirst', { defaultValue: 'Донаты → Чат' })}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="glass-btn"
                        onClick={() => setCreditsSectionsOrder(['chatters', 'donors'])}
                      >
                        {t('admin.creditsOrderChattersFirst', { defaultValue: 'Чат → Донаты' })}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsSectionGap', { defaultValue: 'Отступ между секциями' })}</label>
                        <input type="number" min={0} max={120} value={creditsSectionGapPx} onChange={(e) => setCreditsSectionGapPx(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsLineGap', { defaultValue: 'Отступ между строками' })}</label>
                        <input type="number" min={0} max={80} value={creditsLineGapPx} onChange={(e) => setCreditsLineGapPx(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                      </div>
                    </div>
                  </div>
                )}

                {creditsTab === 'typography' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.fontWeight', { defaultValue: 'Насыщенность' })}</label>
                        <input type="number" min={300} max={900} step={50} value={creditsFontWeight} onChange={(e) => setCreditsFontWeight(Number(e.target.value) || 300)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.color', { defaultValue: 'Цвет' })}</label>
                        <div className="flex items-center gap-3">
                          <input type="color" value={creditsFontColor} onChange={(e) => setCreditsFontColor(String(e.target.value || '').toLowerCase())} className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent" />
                          <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsFontColor}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsTextShadow', { defaultValue: 'Тень текста (blur)' })}</label>
                          <input type="number" min={0} max={120} step={1} value={creditsTextShadowBlur} onChange={(e) => setCreditsTextShadowBlur(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                            {t('admin.creditsTextShadowOpacity', { defaultValue: 'Тень текста (opacity)' })}: {Math.round(creditsTextShadowOpacity * 100)}%
                          </label>
                          <input type="range" min={0} max={1} step={0.02} value={creditsTextShadowOpacity} onChange={(e) => setCreditsTextShadowOpacity(parseFloat(e.target.value))} className="w-full" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsTextShadowColor', { defaultValue: 'Тень текста (color)' })}</label>
                          <div className="flex items-center gap-3">
                            <input type="color" value={creditsTextShadowColor} onChange={(e) => setCreditsTextShadowColor(String(e.target.value || '').toLowerCase())} className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent" />
                            <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsTextShadowColor}</div>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsTextStrokeWidth', { defaultValue: 'Обводка текста (px)' })}</label>
                          <input type="number" min={0} max={6} step={0.25} value={creditsTextStrokeWidth} onChange={(e) => setCreditsTextStrokeWidth(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                            {t('admin.creditsTextStrokeOpacity', { defaultValue: 'Обводка текста (opacity)' })}: {Math.round(creditsTextStrokeOpacity * 100)}%
                          </label>
                          <input type="range" min={0} max={1} step={0.02} value={creditsTextStrokeOpacity} onChange={(e) => setCreditsTextStrokeOpacity(parseFloat(e.target.value))} className="w-full" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsTextStrokeColor', { defaultValue: 'Обводка текста (color)' })}</label>
                          <div className="flex items-center gap-3">
                            <input type="color" value={creditsTextStrokeColor} onChange={(e) => setCreditsTextStrokeColor(String(e.target.value || '').toLowerCase())} className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent" />
                            <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsTextStrokeColor}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                        <input type="checkbox" checked={creditsTitleEnabled} onChange={(e) => setCreditsTitleEnabled(e.target.checked)} className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10" />
                        {t('admin.creditsTitleEnabled', { defaultValue: 'Заголовки секций' })}
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsTitleSize', { defaultValue: 'Размер заголовка' })}</label>
                          <input type="number" min={10} max={64} value={creditsTitleSize} onChange={(e) => setCreditsTitleSize(Number(e.target.value) || 10)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" disabled={!creditsTitleEnabled} />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsTitleTransform', { defaultValue: 'Регистр' })}</label>
                          <select value={creditsTitleTransform} onChange={(e) => setCreditsTitleTransform(e.target.value as CreditsTitleTransform)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" disabled={!creditsTitleEnabled}>
                            <option value="none">{t('admin.none', { defaultValue: 'None' })}</option>
                            <option value="uppercase">{t('admin.uppercase', { defaultValue: 'UPPERCASE' })}</option>
                            <option value="lowercase">{t('admin.lowercase', { defaultValue: 'lowercase' })}</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsTitleColor', { defaultValue: 'Цвет заголовка' })}</label>
                        <div className="flex items-center gap-3">
                          <input type="color" value={creditsTitleColor} onChange={(e) => setCreditsTitleColor(String(e.target.value || '').toLowerCase())} className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent" disabled={!creditsTitleEnabled} />
                          <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsTitleColor}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsTitleShadow', { defaultValue: 'Тень заголовка (blur)' })}</label>
                          <input type="number" min={0} max={120} step={1} value={creditsTitleShadowBlur} onChange={(e) => setCreditsTitleShadowBlur(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" disabled={!creditsTitleEnabled} />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                            {t('admin.creditsTitleShadowOpacity', { defaultValue: 'Тень заголовка (opacity)' })}: {Math.round(creditsTitleShadowOpacity * 100)}%
                          </label>
                          <input type="range" min={0} max={1} step={0.02} value={creditsTitleShadowOpacity} onChange={(e) => setCreditsTitleShadowOpacity(parseFloat(e.target.value))} className="w-full" disabled={!creditsTitleEnabled} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsTitleShadowColor', { defaultValue: 'Тень заголовка (color)' })}</label>
                          <div className="flex items-center gap-3">
                            <input type="color" value={creditsTitleShadowColor} onChange={(e) => setCreditsTitleShadowColor(String(e.target.value || '').toLowerCase())} className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent" disabled={!creditsTitleEnabled} />
                            <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsTitleShadowColor}</div>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsTitleStrokeWidth', { defaultValue: 'Обводка заголовка (px)' })}</label>
                          <input type="number" min={0} max={6} step={0.25} value={creditsTitleStrokeWidth} onChange={(e) => setCreditsTitleStrokeWidth(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" disabled={!creditsTitleEnabled} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                            {t('admin.creditsTitleStrokeOpacity', { defaultValue: 'Обводка заголовка (opacity)' })}: {Math.round(creditsTitleStrokeOpacity * 100)}%
                          </label>
                          <input type="range" min={0} max={1} step={0.02} value={creditsTitleStrokeOpacity} onChange={(e) => setCreditsTitleStrokeOpacity(parseFloat(e.target.value))} className="w-full" disabled={!creditsTitleEnabled} />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsTitleStrokeColor', { defaultValue: 'Обводка заголовка (color)' })}</label>
                          <div className="flex items-center gap-3">
                            <input type="color" value={creditsTitleStrokeColor} onChange={(e) => setCreditsTitleStrokeColor(String(e.target.value || '').toLowerCase())} className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent" disabled={!creditsTitleEnabled} />
                            <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsTitleStrokeColor}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {creditsTab === 'visual' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsBackgroundMode', { defaultValue: 'Режим фона' })}</label>
                        <select value={creditsBackgroundMode} onChange={(e) => setCreditsBackgroundMode(e.target.value as CreditsBackgroundMode)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white">
                          <option value="transparent">{t('admin.transparent', { defaultValue: 'Transparent' })}</option>
                          <option value="card">{t('admin.card', { defaultValue: 'Card' })}</option>
                          <option value="full">{t('admin.fullscreen', { defaultValue: 'Full' })}</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.color', { defaultValue: 'Цвет' })}</label>
                          <div className="flex items-center gap-3">
                            <input type="color" value={creditsBgColor} onChange={(e) => setCreditsBgColor(String(e.target.value || '').toLowerCase())} className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent" />
                            <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsBgColor}</div>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.opacity', { defaultValue: 'Прозрачность' })}: {Math.round(creditsBgOpacity * 100)}%</label>
                          <input type="range" min={0} max={0.85} step={0.01} value={creditsBgOpacity} onChange={(e) => setCreditsBgOpacity(parseFloat(e.target.value))} className="w-full" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.blur', { defaultValue: 'Blur' })}</label>
                          <input type="number" min={0} max={40} value={creditsBlur} onChange={(e) => setCreditsBlur(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.radius', { defaultValue: 'Скругление' })}</label>
                          <input type="number" min={0} max={80} value={creditsRadius} onChange={(e) => setCreditsRadius(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                        <input type="checkbox" checked={creditsBorderEnabled} onChange={(e) => setCreditsBorderEnabled(e.target.checked)} className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10" />
                        {t('admin.border', { defaultValue: 'Border' })}
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.borderWidth', { defaultValue: 'Width' })}</label>
                          <input type="number" min={0} max={16} value={creditsBorderWidth} onChange={(e) => setCreditsBorderWidth(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" disabled={!creditsBorderEnabled} />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.borderColor', { defaultValue: 'Color' })}</label>
                          <div className="flex items-center gap-3">
                            <input type="color" value={creditsBorderColor} onChange={(e) => setCreditsBorderColor(String(e.target.value || '').toLowerCase())} className="h-10 w-14 rounded-lg border border-white/20 dark:border-white/10 bg-transparent" disabled={!creditsBorderEnabled} />
                            <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">{creditsBorderColor}</div>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.shadow', { defaultValue: 'Тень (blur)' })}</label>
                          <input type="number" min={0} max={240} value={creditsShadowBlur} onChange={(e) => setCreditsShadowBlur(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.shadowOpacity', { defaultValue: 'Тень (opacity)' })}: {Math.round(creditsShadowOpacity * 100)}%</label>
                          <input type="range" min={0} max={1} step={0.02} value={creditsShadowOpacity} onChange={(e) => setCreditsShadowOpacity(parseFloat(e.target.value))} className="w-full" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {creditsTab === 'motion' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsScrollDirection', { defaultValue: 'Направление' })}</label>
                        <select value={creditsScrollDirection} onChange={(e) => setCreditsScrollDirection(e.target.value as CreditsScrollDirection)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white">
                          <option value="up">{t('admin.up', { defaultValue: 'Up' })}</option>
                          <option value="down">{t('admin.down', { defaultValue: 'Down' })}</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                        <input type="checkbox" checked={creditsLoop} onChange={(e) => setCreditsLoop(e.target.checked)} className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10" />
                        {t('admin.creditsLoop', { defaultValue: 'Loop' })}
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsStartDelay', { defaultValue: 'Start delay (ms)' })}</label>
                          <input type="number" min={0} max={60000} value={creditsStartDelayMs} onChange={(e) => setCreditsStartDelayMs(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsEndFade', { defaultValue: 'End fade (ms)' })}</label>
                          <input type="number" min={0} max={60000} value={creditsEndFadeMs} onChange={(e) => setCreditsEndFadeMs(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" disabled={creditsLoop} />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.creditsFadeIn', { defaultValue: 'Fade-in (ms)' })}</label>
                        <input type="number" min={0} max={5000} value={creditsFadeInMs} onChange={(e) => setCreditsFadeInMs(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white" />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="rounded-2xl overflow-hidden border border-white/20 dark:border-white/10 bg-black/40">
              {activePreviewBaseUrl ? (
                <iframe
                  ref={previewIframeRef}
                  aria-label={t('help.settings.obs.previewFrame', { defaultValue: 'Preview frame' })}
                  src={activePreviewBaseUrl}
                  className="w-full"
                  style={{ aspectRatio: '16 / 9', border: '0' }}
                  onLoad={() => {
                    schedulePostPreviewParams({ immediate: true });
                    window.setTimeout(() => schedulePostPreviewParams({ immediate: true }), 50);
                    window.setTimeout(() => schedulePostPreviewParams({ immediate: true }), 250);
                  }}
                />
              ) : (
                <div className="w-full flex items-center justify-center text-sm text-white/70" style={{ aspectRatio: '16 / 9' }}>
                  {t('common.notAvailable', { defaultValue: 'Not available' })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {creditsSettingsDirty ? t('admin.unsavedChanges', { defaultValue: 'Есть несохранённые изменения' }) : ''}
              </div>
              <button
                type="button"
                onClick={() => void handleSaveCreditsSettings()}
                disabled={!creditsSettingsDirty || savingCreditsSettings || loadingCreditsSettings}
                className="px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-60"
              >
                {savingCreditsSettings ? t('admin.saving', { defaultValue: 'Saving...' }) : t('admin.save', { defaultValue: 'Save' })}
              </button>
            </div>
          </div>
        )}

        <div className="glass p-4">
          <div className="font-semibold text-gray-900 dark:text-white mb-2">
            {t('admin.obsHowToTitle', { defaultValue: 'How to add in OBS' })}
          </div>
          <ol className="list-decimal list-inside text-sm text-gray-700 dark:text-gray-200 space-y-1">
            <li>{t('admin.obsHowToStep1', { defaultValue: 'Add a new Browser Source.' })}</li>
            <li>{t('admin.obsHowToStep2', { defaultValue: 'Paste the Overlay URL.' })}</li>
            <li>{t('admin.obsHowToStep3', { defaultValue: 'Set Width/Height (e.g. 1920Г—1080) and enable вЂњShutdown source when not visibleвЂќ if you want.' })}</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
