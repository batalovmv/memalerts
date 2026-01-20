import { useOverlayPerformanceMode } from './useOverlayPerformanceMode';
import { useOverlayPresets } from './useOverlayPresets';
import { useOverlayStyleState } from './useOverlayStyleState';

export type ObsLinkFormState = ReturnType<typeof useObsLinkForm>;

export function useObsLinkForm(channelSlug: string) {
  const style = useOverlayStyleState();
  const presets = useOverlayPresets(channelSlug, style.makeSharePayload, {
    setOverlayMode: style.setOverlayMode,
    setOverlayMaxConcurrent: style.setOverlayMaxConcurrent,
    setOverlayShowSender: style.setOverlayShowSender,
    setUrlPosition: style.setUrlPosition,
    setScaleMode: style.setScaleMode,
    setScaleMin: style.setScaleMin,
    setScaleMax: style.setScaleMax,
    setScaleFixed: style.setScaleFixed,
    setSafePad: style.setSafePad,
    setUrlAnim: style.setUrlAnim,
    setUrlEnterMs: style.setUrlEnterMs,
    setUrlExitMs: style.setUrlExitMs,
    setAnimEasingPreset: style.setAnimEasingPreset,
    setAnimEasingX1: style.setAnimEasingX1,
    setAnimEasingY1: style.setAnimEasingY1,
    setAnimEasingX2: style.setAnimEasingX2,
    setAnimEasingY2: style.setAnimEasingY2,
    setUrlRadius: style.setUrlRadius,
    setShadowBlur: style.setShadowBlur,
    setShadowSpread: style.setShadowSpread,
    setShadowDistance: style.setShadowDistance,
    setShadowAngle: style.setShadowAngle,
    setShadowOpacity: style.setShadowOpacity,
    setShadowColor: style.setShadowColor,
    setGlassEnabled: style.setGlassEnabled,
    setGlassPreset: style.setGlassPreset,
    setGlassTintColor: style.setGlassTintColor,
    setGlassTintStrength: style.setGlassTintStrength,
    setUrlBlur: style.setUrlBlur,
    setUrlBgOpacity: style.setUrlBgOpacity,
    setBorderPreset: style.setBorderPreset,
    setBorderTintColor: style.setBorderTintColor,
    setBorderTintStrength: style.setBorderTintStrength,
    setUrlBorder: style.setUrlBorder,
    setBorderMode: style.setBorderMode,
    setUrlBorderColor: style.setUrlBorderColor,
    setUrlBorderColor2: style.setUrlBorderColor2,
    setUrlBorderGradientAngle: style.setUrlBorderGradientAngle,
    setSenderHoldMs: style.setSenderHoldMs,
    setSenderBgColor: style.setSenderBgColor,
    setSenderBgOpacity: style.setSenderBgOpacity,
    setSenderBgRadius: style.setSenderBgRadius,
    setSenderStroke: style.setSenderStroke,
    setSenderStrokeWidth: style.setSenderStrokeWidth,
    setSenderStrokeOpacity: style.setSenderStrokeOpacity,
    setSenderStrokeColor: style.setSenderStrokeColor,
    setSenderFontSize: style.setSenderFontSize,
    setSenderFontWeight: style.setSenderFontWeight,
    setSenderFontFamily: style.setSenderFontFamily,
    setSenderFontColor: style.setSenderFontColor,
    setAdvancedTab: style.setAdvancedTab,
  });

  const performance = useOverlayPerformanceMode({
    glassEnabled: style.glassEnabled,
    urlBlur: style.urlBlur,
    urlBgOpacity: style.urlBgOpacity,
    shadowBlur: style.shadowBlur,
    shadowSpread: style.shadowSpread,
    shadowDistance: style.shadowDistance,
    setGlassEnabled: style.setGlassEnabled,
    setUrlBlur: style.setUrlBlur,
    setUrlBgOpacity: style.setUrlBgOpacity,
    setShadowBlur: style.setShadowBlur,
    setShadowSpread: style.setShadowSpread,
    setShadowDistance: style.setShadowDistance,
  });

  return {
    ...style,
    ...presets,
    ...performance,
  };
}
