import { useCallback, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { useCreditsPresets } from './useCreditsPresets';
import { useCreditsSettingsLoader } from './useCreditsSettingsLoader';

import { rotateCreditsToken, saveCreditsSettings } from '@/shared/api/creditsOverlay';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

export type CreditsSettingsState = ReturnType<typeof useCreditsSettings>;

export function useCreditsSettings(channelSlug: string) {
  const { t } = useTranslation();

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


  const [creditsUiMode, setCreditsUiMode] = useState<'quick' | 'advanced'>('quick');
  const [creditsTab, setCreditsTab] = useState<'layout' | 'typography' | 'sections' | 'visual' | 'motion'>('layout');

  const state = {
    creditsToken,
    setCreditsToken,
    creditsUrl,
    setCreditsUrl,
    loadingCreditsToken,
    setLoadingCreditsToken,
    loadingCreditsSettings,
    setLoadingCreditsSettings,
    savingCreditsSettings,
    setSavingCreditsSettings,
    creditsSettingsSavedPulse,
    setCreditsSettingsSavedPulse,
    rotatingCreditsToken,
    setRotatingCreditsToken,
    lastSavedCreditsSettingsPayload,
    setLastSavedCreditsSettingsPayload,
    creditsShowDonors,
    setCreditsShowDonors,
    creditsShowChatters,
    setCreditsShowChatters,
    creditsSectionsOrder,
    setCreditsSectionsOrder,
    creditsTitleText,
    setCreditsTitleText,
    creditsDonorsTitleText,
    setCreditsDonorsTitleText,
    creditsChattersTitleText,
    setCreditsChattersTitleText,
    creditsShowNumbers,
    setCreditsShowNumbers,
    creditsShowAvatars,
    setCreditsShowAvatars,
    creditsAvatarSize,
    setCreditsAvatarSize,
    creditsAvatarRadius,
    setCreditsAvatarRadius,
    creditsFontFamily,
    setCreditsFontFamily,
    creditsFontSize,
    setCreditsFontSize,
    creditsFontWeight,
    setCreditsFontWeight,
    creditsFontColor,
    setCreditsFontColor,
    creditsBgOpacity,
    setCreditsBgOpacity,
    creditsBlur,
    setCreditsBlur,
    creditsRadius,
    setCreditsRadius,
    creditsShadowBlur,
    setCreditsShadowBlur,
    creditsShadowOpacity,
    setCreditsShadowOpacity,
    creditsBgColor,
    setCreditsBgColor,
    creditsBackgroundMode,
    setCreditsBackgroundMode,
    creditsBorderEnabled,
    setCreditsBorderEnabled,
    creditsBorderWidth,
    setCreditsBorderWidth,
    creditsBorderColor,
    setCreditsBorderColor,
    creditsAnchorX,
    setCreditsAnchorX,
    creditsAnchorY,
    setCreditsAnchorY,
    creditsBgInsetLeft,
    setCreditsBgInsetLeft,
    creditsBgInsetRight,
    setCreditsBgInsetRight,
    creditsBgInsetTop,
    setCreditsBgInsetTop,
    creditsBgInsetBottom,
    setCreditsBgInsetBottom,
    creditsContentPadLeft,
    setCreditsContentPadLeft,
    creditsContentPadRight,
    setCreditsContentPadRight,
    creditsContentPadTop,
    setCreditsContentPadTop,
    creditsContentPadBottom,
    setCreditsContentPadBottom,
    creditsMaxWidthPx,
    setCreditsMaxWidthPx,
    creditsMaxHeightVh,
    setCreditsMaxHeightVh,
    creditsTextAlign,
    setCreditsTextAlign,
    creditsIndentPx,
    setCreditsIndentPx,
    creditsLineHeight,
    setCreditsLineHeight,
    creditsLetterSpacing,
    setCreditsLetterSpacing,
    creditsTitleEnabled,
    setCreditsTitleEnabled,
    creditsTitleSize,
    setCreditsTitleSize,
    creditsTitleWeight,
    setCreditsTitleWeight,
    creditsTitleColor,
    setCreditsTitleColor,
    creditsTitleTransform,
    setCreditsTitleTransform,
    creditsTextShadowBlur,
    setCreditsTextShadowBlur,
    creditsTextShadowOpacity,
    setCreditsTextShadowOpacity,
    creditsTextShadowColor,
    setCreditsTextShadowColor,
    creditsTextStrokeWidth,
    setCreditsTextStrokeWidth,
    creditsTextStrokeOpacity,
    setCreditsTextStrokeOpacity,
    creditsTextStrokeColor,
    setCreditsTextStrokeColor,
    creditsTitleShadowBlur,
    setCreditsTitleShadowBlur,
    creditsTitleShadowOpacity,
    setCreditsTitleShadowOpacity,
    creditsTitleShadowColor,
    setCreditsTitleShadowColor,
    creditsTitleStrokeWidth,
    setCreditsTitleStrokeWidth,
    creditsTitleStrokeOpacity,
    setCreditsTitleStrokeOpacity,
    creditsTitleStrokeColor,
    setCreditsTitleStrokeColor,
    creditsScrollSpeed,
    setCreditsScrollSpeed,
    creditsScrollDirection,
    setCreditsScrollDirection,
    creditsLoop,
    setCreditsLoop,
    creditsStartDelayMs,
    setCreditsStartDelayMs,
    creditsEndFadeMs,
    setCreditsEndFadeMs,
    creditsSectionGapPx,
    setCreditsSectionGapPx,
    creditsLineGapPx,
    setCreditsLineGapPx,
    creditsFadeInMs,
    setCreditsFadeInMs,
    creditsUiMode,
    setCreditsUiMode,
    creditsTab,
    setCreditsTab,
  };

  useCreditsSettingsLoader(channelSlug, {
    ...state,
    creditsSettingsLoadedRef,
  });

  const applyCreditsPreset = useCreditsPresets(state);


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

  

  return {
    ...state,
    creditsStyleJson,
    creditsSettingsDirty,
    handleSaveCreditsSettings,
    handleRotateCreditsToken,
    applyCreditsPreset,
  };
}
