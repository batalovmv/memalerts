import { useEffect } from 'react';

import {
  type CreditsAnchorX,
  type CreditsAnchorY,
  type CreditsBackgroundMode,
  type CreditsScrollDirection,
  type CreditsTextAlign,
  type CreditsTitleTransform,
  toRecord,
} from '../types';

import type { CreditsSettingsLoaderState } from './creditsSettingsLoaderTypes';

import { getCreditsToken } from '@/shared/api/creditsOverlay';

export function useCreditsSettingsLoader(channelSlug: string, state: CreditsSettingsLoaderState) {
  const {
    setCreditsToken,
    setCreditsUrl,
    setLoadingCreditsToken,
    setLoadingCreditsSettings,
    setLastSavedCreditsSettingsPayload,
    creditsSettingsLoadedRef,
    creditsSectionsOrder,
    setCreditsSectionsOrder,
    creditsShowDonors,
    setCreditsShowDonors,
    creditsShowChatters,
    setCreditsShowChatters,
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
  } = state;

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
        const nextDonorsTitleText =
          typeof styleFromServer?.donorsTitleText === 'string' ? styleFromServer.donorsTitleText : creditsDonorsTitleText;
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
        const nextShadowOpacity =
          typeof styleFromServer?.shadowOpacity === 'number' ? styleFromServer.shadowOpacity : creditsShadowOpacity;
        const nextBgColor = typeof styleFromServer?.bgColor === 'string' ? styleFromServer.bgColor : creditsBgColor;
        const nextBackgroundMode: CreditsBackgroundMode =
          styleFromServer?.backgroundMode === 'transparent'
            ? 'transparent'
            : styleFromServer?.backgroundMode === 'full'
              ? 'full'
              : 'card';
        const nextBorderEnabled = typeof styleFromServer?.borderEnabled === 'boolean' ? styleFromServer.borderEnabled : creditsBorderEnabled;
        const nextBorderWidth = typeof styleFromServer?.borderWidth === 'number' ? styleFromServer.borderWidth : creditsBorderWidth;
        const nextBorderColor = typeof styleFromServer?.borderColor === 'string' ? styleFromServer.borderColor : creditsBorderColor;

        const nextAnchorX: CreditsAnchorX =
          styleFromServer?.anchorX === 'left' ? 'left' : styleFromServer?.anchorX === 'right' ? 'right' : 'center';
        const nextAnchorY: CreditsAnchorY =
          styleFromServer?.anchorY === 'top' ? 'top' : styleFromServer?.anchorY === 'bottom' ? 'bottom' : 'center';
        // Back-compat: old padX/padY -> use as bg inset defaults if new fields are missing
        const padXLegacy = typeof styleFromServer?.padX === 'number' ? styleFromServer.padX : 24;
        const padYLegacy = typeof styleFromServer?.padY === 'number' ? styleFromServer.padY : 24;

        const nextBgInsetLeft =
          typeof styleFromServer?.bgInsetLeft === 'number' ? styleFromServer.bgInsetLeft : creditsBgInsetLeft ?? padXLegacy;
        const nextBgInsetRight =
          typeof styleFromServer?.bgInsetRight === 'number' ? styleFromServer.bgInsetRight : creditsBgInsetRight ?? padXLegacy;
        const nextBgInsetTop =
          typeof styleFromServer?.bgInsetTop === 'number' ? styleFromServer.bgInsetTop : creditsBgInsetTop ?? padYLegacy;
        const nextBgInsetBottom =
          typeof styleFromServer?.bgInsetBottom === 'number' ? styleFromServer.bgInsetBottom : creditsBgInsetBottom ?? padYLegacy;

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
        const nextTextAlign: CreditsTextAlign =
          styleFromServer?.textAlign === 'left' ? 'left' : styleFromServer?.textAlign === 'right' ? 'right' : 'center';
        const nextIndentPx = typeof styleFromServer?.indentPx === 'number' ? styleFromServer.indentPx : creditsIndentPx;

        const nextLineHeight = typeof styleFromServer?.lineHeight === 'number' ? styleFromServer.lineHeight : creditsLineHeight;
        const nextLetterSpacing =
          typeof styleFromServer?.letterSpacing === 'number' ? styleFromServer.letterSpacing : creditsLetterSpacing;
        const nextTitleEnabled = typeof styleFromServer?.titleEnabled === 'boolean' ? styleFromServer.titleEnabled : creditsTitleEnabled;
        const nextTitleSize =
          typeof styleFromServer?.titleSize === 'number'
            ? styleFromServer.titleSize
            : Math.round((typeof nextFontSize === 'number' ? nextFontSize : creditsFontSize) * 0.85);
        const nextTitleWeight =
          typeof styleFromServer?.titleWeight === 'number'
            ? styleFromServer.titleWeight
            : typeof nextFontWeight === 'number'
              ? nextFontWeight
              : creditsFontWeight;
        const nextTitleColor = typeof styleFromServer?.titleColor === 'string' ? styleFromServer.titleColor : nextFontColor;
        const nextTitleTransform: CreditsTitleTransform =
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

        const nextScrollSpeed =
          typeof styleFromServer?.scrollSpeed === 'number' ? styleFromServer.scrollSpeed : creditsScrollSpeed;
        const nextSectionGapPx =
          typeof styleFromServer?.sectionGapPx === 'number' ? styleFromServer.sectionGapPx : creditsSectionGapPx;
        const nextLineGapPx = typeof styleFromServer?.lineGapPx === 'number' ? styleFromServer.lineGapPx : creditsLineGapPx;
        const nextFadeInMs = typeof styleFromServer?.fadeInMs === 'number' ? styleFromServer.fadeInMs : creditsFadeInMs;
        const nextScrollDirection: CreditsScrollDirection = styleFromServer?.scrollDirection === 'down' ? 'down' : 'up';
        const nextLoop = typeof styleFromServer?.loop === 'boolean' ? styleFromServer.loop : creditsLoop;
        const nextStartDelayMs =
          typeof styleFromServer?.startDelayMs === 'number' ? styleFromServer.startDelayMs : creditsStartDelayMs;
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

        setCreditsLineHeight(Math.max(0.8, Math.min(2.4, Number(nextLineHeight) || 1.15)));
        setCreditsLetterSpacing(Math.max(-4, Math.min(8, Number(nextLetterSpacing) || 0)));
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

        setCreditsScrollSpeed(Math.max(8, Math.min(600, Math.round(nextScrollSpeed))));
        setCreditsScrollDirection(nextScrollDirection);
        setCreditsLoop(Boolean(nextLoop));
        setCreditsStartDelayMs(Math.max(0, Math.min(60000, Math.round(nextStartDelayMs))));
        setCreditsEndFadeMs(Math.max(0, Math.min(60000, Math.round(nextEndFadeMs))));
        setCreditsSectionGapPx(Math.max(0, Math.min(120, Math.round(nextSectionGapPx))));
        setCreditsLineGapPx(Math.max(0, Math.min(80, Math.round(nextLineGapPx))));
        setCreditsFadeInMs(Math.max(0, Math.min(5000, Math.round(nextFadeInMs))));

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
          sectionsOrder: nextOrder,
          showDonors: nextShowDonors,
          showChatters: nextShowChatters,
          titleText: nextTitleText,
          donorsTitleText: nextDonorsTitleText,
          chattersTitleText: nextChattersTitleText,
          showNumbers: nextShowNumbers,
          showAvatars: nextShowAvatars,
          avatarSize: nextAvatarSize,
          avatarRadius: nextAvatarRadius,
          fontFamily: nextFontFamily,
          fontSize: nextFontSize,
          fontWeight: nextFontWeight,
          fontColor: nextFontColor,
          lineHeight: nextLineHeight,
          letterSpacing: nextLetterSpacing,
          titleEnabled: nextTitleEnabled,
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
}
