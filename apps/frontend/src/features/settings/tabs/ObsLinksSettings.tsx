import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useAppSelector } from '@/store/hooks';
import SecretCopyField from '@/components/SecretCopyField';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';
import { RotateIcon } from './obs/ui/RotateIcon';
import {
  clampFloat,
  clampInt,
  isHexColor,
  type OverlaySharePayload,
} from './obs/lib/shareCode';
export function ObsLinksSettings() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);

  const channelSlug = user?.channel?.slug || '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const [overlayToken, setOverlayToken] = useState<string>('');
  const [loadingToken, setLoadingToken] = useState(false);
  const [previewMemes, setPreviewMemes] = useState<Array<{ fileUrl: string; type: string; title?: string }>>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewInitialized, setPreviewInitialized] = useState(false);
  const [previewLoopEnabled, setPreviewLoopEnabled] = useState<boolean>(true);
  const [previewBg, setPreviewBg] = useState<'twitch' | 'white'>('twitch');
  const [advancedTab, setAdvancedTab] = useState<'layout' | 'animation' | 'shadow' | 'border' | 'glass' | 'sender'>('layout');
  const [previewSeed, setPreviewSeed] = useState<number>(1);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewSeedRef = useRef<number>(1);
  const overlayReadyRef = useRef(false);
  const [obsUiMode, setObsUiMode] = useState<'basic' | 'pro'>('basic');
  const [previewLockPositions, setPreviewLockPositions] = useState(false);
  const [previewShowSafeGuide, setPreviewShowSafeGuide] = useState(false);
  const safeGuideTimerRef = useRef<number | null>(null);

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

      const nextBorderPreset =
        s.borderPreset === 'glass' ? 'glass' : s.borderPreset === 'glow' ? 'glow' : s.borderPreset === 'frosted' ? 'frosted' : 'custom';
      setBorderPreset(nextBorderPreset as any);
      if (isHexColor(s.borderTintColor)) setBorderTintColor(String(s.borderTintColor).toLowerCase());
      setBorderTintStrength(clampFloatLocal(s.borderTintStrength, 0, 1, borderTintStrength));

      const nextBorderMode = s.borderMode === 'gradient' ? 'gradient' : 'solid';
      setBorderMode(nextBorderMode as any);
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
      if (gp === 'ios' || gp === 'clear' || gp === 'prism') setGlassPreset(gp as any);
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
      setSenderFontFamily(ff as any);
      if (isHexColor(s.senderFontColor)) setSenderFontColor(String(s.senderFontColor).toLowerCase());
    },
    [
      animEasingPreset,
      animEasingX1,
      animEasingX2,
      animEasingY1,
      animEasingY2,
      borderTintStrength,
      glassPreset,
      glassTintStrength,
      overlayMaxConcurrent,
      overlayMode,
      overlayShowSender,
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
      senderStrokeColor,
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
        let styleFromServer: any = null;
        if (resp.overlayStyleJson) {
          try {
            const j = JSON.parse(resp.overlayStyleJson) as any;
            styleFromServer = j && typeof j === 'object' ? j : null;
          } catch {
            styleFromServer = null;
          }
        }

        const nextPosition = styleFromServer?.position ?? urlPosition;
        const nextVolume = typeof styleFromServer?.volume === 'number' ? styleFromServer.volume : urlVolume;
        const nextScaleMode: 'fixed' | 'range' = styleFromServer?.scaleMode === 'range' ? 'range' : 'fixed';
        const nextScaleFixed = typeof styleFromServer?.scaleFixed === 'number' ? styleFromServer.scaleFixed : scaleFixed;
        const nextScaleMin = typeof styleFromServer?.scaleMin === 'number' ? styleFromServer.scaleMin : scaleMin;
        const nextScaleMax = typeof styleFromServer?.scaleMax === 'number' ? styleFromServer.scaleMax : scaleMax;
        const nextSafePad =
          typeof styleFromServer?.safePad === 'number' ? styleFromServer.safePad : typeof (styleFromServer as any)?.safePadPx === 'number' ? (styleFromServer as any).safePadPx : safePad;
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
        const nextAnim = styleFromServer?.anim ?? urlAnim;
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
        const nextSenderFontFamily = typeof styleFromServer?.senderFontFamily === 'string' ? styleFromServer.senderFontFamily : senderFontFamily;
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
  }, [channelSlug]);

  const previewCount = useMemo(
    () => (overlayMode === 'queue' ? 1 : Math.min(5, Math.max(1, overlayMaxConcurrent))),
    [overlayMaxConcurrent, overlayMode]
  );

  useEffect(() => {
    previewSeedRef.current = previewSeed;
  }, [previewSeed]);

  const fetchPreviewMemes = useCallback(async (count?: number, seed?: number, opts?: { commitSeed?: boolean }) => {
    const n = Math.min(5, Math.max(1, Number.isFinite(count) ? Number(count) : previewCount));
    try {
      setLoadingPreview(true);
      const { api } = await import('@/lib/api');
      const effectiveSeed = Number.isFinite(seed) ? String(seed) : String(previewSeedRef.current || 1);

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
      setPreviewMemes(cleaned);

      // Optional: commit the seed atomically together with the new preview set.
      // This prevents a two-step UI update (seed first, urls later) that can cause overlay reseed twice.
      if (opts?.commitSeed && Number.isFinite(seed)) {
        previewSeedRef.current = seed!;
        setPreviewSeed(seed!);
      }
    } catch {
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

  // OBS URL should stay constant.
  const overlayUrlWithDefaults = overlayUrl;

  // Preview iframe URL should be stable while tweaking sliders (avoid network reloads).
  // Preview media + seed are pushed via postMessage; iframe src should stay stable.
  const overlayPreviewBaseUrl = useMemo(() => {
    if (!overlayUrl) return '';
    const u = new URL(overlayUrl);
    u.searchParams.set('demo', '1');
    return u.toString();
  }, [overlayUrl]);

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
  ]);

  const latestPreviewParamsRef = useRef<Record<string, string>>(overlayPreviewParams);
  useEffect(() => {
    latestPreviewParamsRef.current = overlayPreviewParams;
  }, [overlayPreviewParams]);

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
  }, [overlayPreviewParams, schedulePostPreviewParams]);

  const flashSafeGuide = useCallback(() => {
    setPreviewShowSafeGuide(true);
    if (safeGuideTimerRef.current) window.clearTimeout(safeGuideTimerRef.current);
    safeGuideTimerRef.current = window.setTimeout(() => {
      safeGuideTimerRef.current = null;
      setPreviewShowSafeGuide(false);
    }, 900);
  }, []);

  // Receive "ready" handshake from iframe so the first params post is never lost.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== previewIframeRef.current?.contentWindow) return;
      const data = event.data as any;
      if (!data || typeof data !== 'object') return;
      if (data.type !== 'memalerts:overlayReady') return;
      overlayReadyRef.current = true;
      // Send current params immediately when overlay confirms readiness.
      schedulePostPreviewParams({ immediate: true });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [schedulePostPreviewParams]);

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
        .map((p: any) => ({
          id: String(p?.id || ''),
          name: String(p?.name || '').trim(),
          createdAt: Number(p?.createdAt || 0),
          payload: p?.payload as OverlaySharePayload,
        }))
        .filter((p: any) => p.id && p.name && p.payload && typeof p.payload === 'object')
        .slice(0, 30);
      setCustomPresets(cleaned);
    } catch {
      setCustomPresets([]);
    }
  }, [presetsStorageKey]);

  const persistCustomPresets = useCallback(
    (next: Array<{ id: string; name: string; createdAt: number; payload: OverlaySharePayload }>) => {
      setCustomPresets(next);
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(presetsStorageKey, JSON.stringify(next));
        }
      } catch {
        // ignore storage errors
      }
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
    toast.success(t('admin.overlayDefaultsApplied', { defaultValue: 'РќР°СЃС‚СЂРѕР№РєРё СЃР±СЂРѕС€РµРЅС‹ РґРѕ СЃС‚Р°РЅРґР°СЂС‚РЅС‹С… (РЅРµ Р·Р°Р±СѓРґСЊС‚Рµ РЅР°Р¶Р°С‚СЊ В«РЎРѕС…СЂР°РЅРёС‚СЊВ»)' }));
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
      toast.success(t('admin.settingsSaved', { defaultValue: 'РќР°СЃС‚СЂРѕР№РєРё СЃРѕС…СЂР°РЅРµРЅС‹!' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ' }));
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

  return (
    <div className="surface p-6">
      <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.obsLinksTitle', { defaultValue: 'OBS links' })}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        {t('admin.obsLinksDescription', { defaultValue: 'Copy the overlay link and paste it into OBS as a Browser Source. The overlay will show activated memes in real time.' })}
      </p>

      <div className="space-y-6">
        <SecretCopyField
          label={t('admin.obsOverlayUrl', { defaultValue: 'Overlay URL (Browser Source)' })}
          value={overlayUrlWithDefaults}
          masked={true}
          emptyText={t('common.notAvailable', { defaultValue: 'Not available' })}
          description={loadingToken ? t('common.loading', { defaultValue: 'Loading...' }) : t('admin.obsOverlayUrlHint', { defaultValue: 'Click to copy. You can reveal the URL with the eye icon.' })}
          rightActions={
            <button
              type="button"
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-gray-700 dark:text-gray-200 disabled:opacity-60"
              onClick={(e) => {
                e.stopPropagation();
                void handleRotateOverlayToken();
              }}
              disabled={rotatingOverlayToken || loadingToken || !overlayToken}
              title={t('admin.obsOverlayRotateLinkHint', { defaultValue: 'Use this if your overlay URL was leaked. The old link will stop working.' })}
              aria-label={t('admin.obsOverlayRotateLink', { defaultValue: 'Update overlay link' })}
            >
              <RotateIcon />
            </button>
          }
        />

        <div className="glass p-4">
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

        <details className="glass p-4">
          <summary className="cursor-pointer font-semibold text-gray-900 dark:text-white">
            {t('admin.obsAdvancedOverlayUrl', { defaultValue: 'Advanced overlay URL (customize)' })}
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
              {(loadingOverlaySettings || savingOverlaySettings) && (
                <SavingOverlay label={t('admin.saving', { defaultValue: 'РЎРѕС…СЂР°РЅРµРЅРёРµ...' })} />
              )}
              {overlaySettingsSavedPulse && !savingOverlaySettings && !loadingOverlaySettings && (
                <SavedOverlay label={t('admin.saved', { defaultValue: 'РЎРѕС…СЂР°РЅРµРЅРѕ' })} />
              )}

              <div
                className={`space-y-4 transition-opacity ${
                  loadingOverlaySettings || savingOverlaySettings ? 'pointer-events-none opacity-60' : ''
                }`}
              >
                <div className="glass p-4">
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
                      {t('admin.obsOverlayLivePreview', { defaultValue: 'Р”РµРјРѕРЅСЃС‚СЂР°С†РёСЏ' })}
                    </div>
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
                      title={t('admin.obsPreviewNextMeme', { defaultValue: 'РЎР»РµРґСѓСЋС‰РёР№ РјРµРј' })}
                      aria-label={t('admin.obsPreviewNextMeme', { defaultValue: 'РЎР»РµРґСѓСЋС‰РёР№ РјРµРј' })}
                    >
                      {/* Next arrow icon */}
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h11" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5-5 5" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`glass-btn p-2 shrink-0 ${previewLoopEnabled ? 'ring-2 ring-primary/40' : ''}`}
                      title={t('admin.obsPreviewLoop', { defaultValue: 'Р—Р°С†РёРєР»РёС‚СЊ' })}
                      aria-label={t('admin.obsPreviewLoop', { defaultValue: 'Р—Р°С†РёРєР»РёС‚СЊ' })}
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
                    <button
                      type="button"
                      className={`glass-btn p-2 shrink-0 ${previewBg === 'white' ? 'ring-2 ring-primary/40' : ''}`}
                      title={t('admin.obsPreviewBackground', { defaultValue: 'Р¤РѕРЅ РїСЂРµРІСЊСЋ (Р±РµР»С‹Р№/С‚РµРјР°С‚РёС‡РµСЃРєРёР№)' })}
                      aria-label={t('admin.obsPreviewBackground', { defaultValue: 'Р¤РѕРЅ РїСЂРµРІСЊСЋ (Р±РµР»С‹Р№/С‚РµРјР°С‚РёС‡РµСЃРєРёР№)' })}
                      onClick={() => setPreviewBg((b) => (b === 'twitch' ? 'white' : 'twitch'))}
                    >
                      {/* Photo / background icon */}
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11l2 2 4-4 6 6" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.5 9.5h.01" />
                      </svg>
                    </button>
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
                        title="Overlay preview"
                        src={overlayPreviewBaseUrl}
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
                      <button
                        type="button"
                        className="glass-btn px-3 py-2 text-sm font-semibold bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white border border-white/20 dark:border-white/10 flex items-center gap-2"
                        onClick={resetOverlayToDefaults}
                        disabled={savingOverlaySettings || loadingOverlaySettings}
                        title={t('admin.overlayResetDefaults', { defaultValue: 'РЎР±СЂРѕСЃРёС‚СЊ' })}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12a9 9 0 101.8-5.4" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4v6h6" />
                        </svg>
                        <span className="hidden sm:inline">{t('admin.overlayResetDefaults', { defaultValue: 'РЎР±СЂРѕСЃРёС‚СЊ' })}</span>
                      </button>
                      {/* Import/Export removed: users can save custom presets locally instead */}
                      <button
                        type="button"
                        className={`glass-btn px-4 py-2 text-sm font-semibold ${overlaySettingsDirty ? '' : 'opacity-60'}`}
                        disabled={!overlaySettingsDirty || savingOverlaySettings || loadingOverlaySettings}
                        onClick={() => void handleSaveOverlaySettings()}
                      >
                        {savingOverlaySettings
                          ? t('admin.saving', { defaultValue: 'РЎРѕС…СЂР°РЅРµРЅРёРµ...' })
                          : t('common.save', { defaultValue: 'РЎРѕС…СЂР°РЅРёС‚СЊ' })}
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
                        <button type="button" className="glass-btn px-3 py-2 text-sm font-semibold" onClick={() => applyPreset('default')}>
                          {t('admin.obsPresetDefault', { defaultValue: 'Default' })}
                        </button>
                        <button type="button" className="glass-btn px-3 py-2 text-sm font-semibold" onClick={() => applyPreset('minimal')}>
                          {t('admin.obsPresetMinimal', { defaultValue: 'Minimal' })}
                        </button>
                        <button type="button" className="glass-btn px-3 py-2 text-sm font-semibold" onClick={() => applyPreset('neon')}>
                          {t('admin.obsPresetNeon', { defaultValue: 'Neon' })}
                        </button>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        {t('admin.obsPresetsHint', { defaultValue: 'Start from a preset, then tweak below.' })}
                      </div>

                      <div className="pt-2 border-t border-white/15 dark:border-white/10">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                          {t('admin.obsCustomPresets', { defaultValue: 'Your presets' })}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            value={presetName}
                            onChange={(e) => setPresetName(e.target.value)}
                            placeholder={t('admin.obsPresetNamePlaceholder', { defaultValue: 'Preset name…' })}
                            className="flex-1 rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                          <button
                            type="button"
                            className="glass-btn px-3 py-2 text-sm font-semibold"
                            onClick={saveCurrentAsCustomPreset}
                          >
                            {t('admin.obsPresetSave', { defaultValue: 'Save' })}
                          </button>
                        </div>

                        {customPresets.length > 0 ? (
                          <div className="mt-2 space-y-2">
                            {customPresets.map((p) => (
                              <div key={p.id} className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="glass-btn px-3 py-2 text-sm font-semibold flex-1 text-left"
                                  onClick={() => applySharePayload(p.payload)}
                                  title={t('admin.obsPresetApply', { defaultValue: 'Apply preset' })}
                                >
                                  {p.name}
                                </button>
                                <button
                                  type="button"
                                  className="glass-btn px-3 py-2 text-sm font-semibold"
                                  onClick={() => deleteCustomPreset(p.id)}
                                  title={t('admin.obsPresetDelete', { defaultValue: 'Delete' })}
                                >
                                  {t('common.delete', { defaultValue: 'Delete' })}
                                </button>
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
                            onChange={(e) => setUrlPosition(e.target.value as any)}
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
                            onChange={(e) => setUrlAnim(e.target.value as any)}
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
                            onChange={(e) => setAnimEasingPreset(e.target.value as any)}
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
                  onChange={(e) => setUrlPosition(e.target.value as any)}
                  className="w-full rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="random">{t('admin.obsOverlayPositionRandom', { defaultValue: 'РЎР»СѓС‡Р°Р№РЅРѕ' })}</option>
                  <option value="center">{t('admin.obsOverlayPositionCenter', { defaultValue: 'Р¦РµРЅС‚СЂ' })}</option>
                  <option value="top">{t('admin.obsOverlayPositionTop', { defaultValue: 'РЎРІРµСЂС…Сѓ' })}</option>
                  <option value="bottom">{t('admin.obsOverlayPositionBottom', { defaultValue: 'РЎРЅРёР·Сѓ' })}</option>
                  <option value="top-left">{t('admin.obsOverlayPositionTopLeft', { defaultValue: 'РЎР»РµРІР° СЃРІРµСЂС…Сѓ' })}</option>
                  <option value="top-right">{t('admin.obsOverlayPositionTopRight', { defaultValue: 'РЎРїСЂР°РІР° СЃРІРµСЂС…Сѓ' })}</option>
                  <option value="bottom-left">{t('admin.obsOverlayPositionBottomLeft', { defaultValue: 'РЎР»РµРІР° СЃРЅРёР·Сѓ' })}</option>
                  <option value="bottom-right">{t('admin.obsOverlayPositionBottomRight', { defaultValue: 'РЎРїСЂР°РІР° СЃРЅРёР·Сѓ' })}</option>
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
                    onChange={(e) => setScaleMode(e.target.value as any)}
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
                  onChange={(e) => setUrlAnim(e.target.value as any)}
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
                  onChange={(e) => setAnimEasingPreset(e.target.value as any)}
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
                  onChange={(e) => setGlassPreset(e.target.value as any)}
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
                  onChange={(e) => setBorderPreset(e.target.value as any)}
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
                    onChange={(e) => setBorderMode(e.target.value as any)}
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
                      onChange={(e) => setSenderFontFamily(e.target.value as any)}
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
                      <button
                        type="button"
                        onClick={() => setSenderBgRadius(999)}
                        className="glass-btn px-3 py-2 text-sm font-semibold shrink-0"
                      >
                        {t('admin.obsOverlaySenderBgPill', { defaultValue: 'Pill' })}
                      </button>
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
                          onChange={(e) => setSenderStroke(e.target.value as any)}
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


