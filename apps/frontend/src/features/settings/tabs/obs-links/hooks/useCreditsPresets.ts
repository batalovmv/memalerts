import { useCallback } from 'react';

type SetState<T> = (value: T) => void;

type CreditsPresetState = {
  setCreditsShowDonors: SetState<boolean>;
  setCreditsShowChatters: SetState<boolean>;
  setCreditsSectionsOrder: SetState<Array<'donors' | 'chatters'>>;
  setCreditsTitleText: SetState<string>;
  setCreditsDonorsTitleText: SetState<string>;
  setCreditsChattersTitleText: SetState<string>;
  setCreditsShowNumbers: SetState<boolean>;
  setCreditsShowAvatars: SetState<boolean>;
  setCreditsAvatarSize: SetState<number>;
  setCreditsAvatarRadius: SetState<number>;
  setCreditsFontFamily: SetState<string>;
  setCreditsFontSize: SetState<number>;
  setCreditsFontWeight: SetState<number>;
  setCreditsFontColor: SetState<string>;
  setCreditsLineHeight: SetState<number>;
  setCreditsLetterSpacing: SetState<number>;
  setCreditsTitleEnabled: SetState<boolean>;
  setCreditsTitleSize: SetState<number>;
  setCreditsTitleWeight: SetState<number>;
  setCreditsTitleColor: SetState<string>;
  setCreditsTitleTransform: SetState<'none' | 'uppercase' | 'lowercase'>;
  setCreditsAnchorX: SetState<'left' | 'center' | 'right'>;
  setCreditsAnchorY: SetState<'top' | 'center' | 'bottom'>;
  setCreditsBgInsetLeft: SetState<number>;
  setCreditsBgInsetRight: SetState<number>;
  setCreditsBgInsetTop: SetState<number>;
  setCreditsBgInsetBottom: SetState<number>;
  setCreditsContentPadLeft: SetState<number>;
  setCreditsContentPadRight: SetState<number>;
  setCreditsContentPadTop: SetState<number>;
  setCreditsContentPadBottom: SetState<number>;
  setCreditsMaxWidthPx: SetState<number>;
  setCreditsMaxHeightVh: SetState<number>;
  setCreditsTextAlign: SetState<'left' | 'center' | 'right'>;
  setCreditsIndentPx: SetState<number>;
  setCreditsBackgroundMode: SetState<'transparent' | 'card' | 'full'>;
  setCreditsBgColor: SetState<string>;
  setCreditsBgOpacity: SetState<number>;
  setCreditsBlur: SetState<number>;
  setCreditsRadius: SetState<number>;
  setCreditsBorderEnabled: SetState<boolean>;
  setCreditsBorderWidth: SetState<number>;
  setCreditsBorderColor: SetState<string>;
  setCreditsShadowBlur: SetState<number>;
  setCreditsShadowOpacity: SetState<number>;
  setCreditsScrollSpeed: SetState<number>;
  setCreditsScrollDirection: SetState<'up' | 'down'>;
  setCreditsLoop: SetState<boolean>;
  setCreditsStartDelayMs: SetState<number>;
  setCreditsEndFadeMs: SetState<number>;
  setCreditsSectionGapPx: SetState<number>;
  setCreditsLineGapPx: SetState<number>;
  setCreditsFadeInMs: SetState<number>;
  setCreditsTextShadowBlur: SetState<number>;
  setCreditsTextShadowOpacity: SetState<number>;
  setCreditsTextShadowColor: SetState<string>;
  setCreditsTextStrokeWidth: SetState<number>;
  setCreditsTextStrokeOpacity: SetState<number>;
  setCreditsTextStrokeColor: SetState<string>;
  setCreditsTitleShadowBlur: SetState<number>;
  setCreditsTitleShadowOpacity: SetState<number>;
  setCreditsTitleShadowColor: SetState<string>;
  setCreditsTitleStrokeWidth: SetState<number>;
  setCreditsTitleStrokeOpacity: SetState<number>;
  setCreditsTitleStrokeColor: SetState<string>;
};

export function useCreditsPresets(state: CreditsPresetState) {
  const {
    setCreditsShowDonors,
    setCreditsShowChatters,
    setCreditsSectionsOrder,
    setCreditsTitleText,
    setCreditsDonorsTitleText,
    setCreditsChattersTitleText,
    setCreditsShowNumbers,
    setCreditsShowAvatars,
    setCreditsAvatarSize,
    setCreditsAvatarRadius,
    setCreditsFontFamily,
    setCreditsFontSize,
    setCreditsFontWeight,
    setCreditsFontColor,
    setCreditsLineHeight,
    setCreditsLetterSpacing,
    setCreditsTitleEnabled,
    setCreditsTitleSize,
    setCreditsTitleWeight,
    setCreditsTitleColor,
    setCreditsTitleTransform,
    setCreditsAnchorX,
    setCreditsAnchorY,
    setCreditsBgInsetLeft,
    setCreditsBgInsetRight,
    setCreditsBgInsetTop,
    setCreditsBgInsetBottom,
    setCreditsContentPadLeft,
    setCreditsContentPadRight,
    setCreditsContentPadTop,
    setCreditsContentPadBottom,
    setCreditsMaxWidthPx,
    setCreditsMaxHeightVh,
    setCreditsTextAlign,
    setCreditsIndentPx,
    setCreditsBackgroundMode,
    setCreditsBgColor,
    setCreditsBgOpacity,
    setCreditsBlur,
    setCreditsRadius,
    setCreditsBorderEnabled,
    setCreditsBorderWidth,
    setCreditsBorderColor,
    setCreditsShadowBlur,
    setCreditsShadowOpacity,
    setCreditsScrollSpeed,
    setCreditsScrollDirection,
    setCreditsLoop,
    setCreditsStartDelayMs,
    setCreditsEndFadeMs,
    setCreditsSectionGapPx,
    setCreditsLineGapPx,
    setCreditsFadeInMs,
    setCreditsTextShadowBlur,
    setCreditsTextShadowOpacity,
    setCreditsTextShadowColor,
    setCreditsTextStrokeWidth,
    setCreditsTextStrokeOpacity,
    setCreditsTextStrokeColor,
    setCreditsTitleShadowBlur,
    setCreditsTitleShadowOpacity,
    setCreditsTitleShadowColor,
    setCreditsTitleStrokeWidth,
    setCreditsTitleStrokeOpacity,
    setCreditsTitleStrokeColor,
  } = state;

  return useCallback((preset: 'minimal' | 'classic' | 'neon' | 'fullscreen') => {
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
  }, [
    setCreditsShowDonors,
    setCreditsShowChatters,
    setCreditsSectionsOrder,
    setCreditsTitleText,
    setCreditsDonorsTitleText,
    setCreditsChattersTitleText,
    setCreditsShowNumbers,
    setCreditsShowAvatars,
    setCreditsAvatarSize,
    setCreditsAvatarRadius,
    setCreditsFontFamily,
    setCreditsFontSize,
    setCreditsFontWeight,
    setCreditsFontColor,
    setCreditsLineHeight,
    setCreditsLetterSpacing,
    setCreditsTitleEnabled,
    setCreditsTitleSize,
    setCreditsTitleWeight,
    setCreditsTitleColor,
    setCreditsTitleTransform,
    setCreditsAnchorX,
    setCreditsAnchorY,
    setCreditsBgInsetLeft,
    setCreditsBgInsetRight,
    setCreditsBgInsetTop,
    setCreditsBgInsetBottom,
    setCreditsContentPadLeft,
    setCreditsContentPadRight,
    setCreditsContentPadTop,
    setCreditsContentPadBottom,
    setCreditsMaxWidthPx,
    setCreditsMaxHeightVh,
    setCreditsTextAlign,
    setCreditsIndentPx,
    setCreditsBackgroundMode,
    setCreditsBgColor,
    setCreditsBgOpacity,
    setCreditsBlur,
    setCreditsRadius,
    setCreditsBorderEnabled,
    setCreditsBorderWidth,
    setCreditsBorderColor,
    setCreditsShadowBlur,
    setCreditsShadowOpacity,
    setCreditsScrollSpeed,
    setCreditsScrollDirection,
    setCreditsLoop,
    setCreditsStartDelayMs,
    setCreditsEndFadeMs,
    setCreditsSectionGapPx,
    setCreditsLineGapPx,
    setCreditsFadeInMs,
    setCreditsTextShadowBlur,
    setCreditsTextShadowOpacity,
    setCreditsTextShadowColor,
    setCreditsTextStrokeWidth,
    setCreditsTextStrokeOpacity,
    setCreditsTextStrokeColor,
    setCreditsTitleShadowBlur,
    setCreditsTitleShadowOpacity,
    setCreditsTitleShadowColor,
    setCreditsTitleStrokeWidth,
    setCreditsTitleStrokeOpacity,
    setCreditsTitleStrokeColor,
  ]);
}
