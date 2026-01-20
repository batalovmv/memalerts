import { useCallback, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

type PerformanceModeArgs = {
  glassEnabled: boolean;
  urlBlur: number;
  urlBgOpacity: number;
  shadowBlur: number;
  shadowSpread: number;
  shadowDistance: number;
  setGlassEnabled: (value: boolean) => void;
  setUrlBlur: (value: number) => void;
  setUrlBgOpacity: (value: number) => void;
  setShadowBlur: (value: number) => void;
  setShadowSpread: (value: number) => void;
  setShadowDistance: (value: number) => void;
};

export type OverlayPerformanceModeState = ReturnType<typeof useOverlayPerformanceMode>;

export function useOverlayPerformanceMode({
  glassEnabled,
  urlBlur,
  urlBgOpacity,
  shadowBlur,
  shadowSpread,
  shadowDistance,
  setGlassEnabled,
  setUrlBlur,
  setUrlBgOpacity,
  setShadowBlur,
  setShadowSpread,
  setShadowDistance,
}: PerformanceModeArgs) {
  const { t } = useTranslation();
  const perfRestoreRef = useRef<null | {
    glassEnabled: boolean;
    urlBlur: number;
    urlBgOpacity: number;
    shadowBlur: number;
    shadowSpread: number;
    shadowDistance: number;
  }>(null);
  const [performanceMode, setPerformanceMode] = useState(false);

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
  }, [
    glassEnabled,
    shadowBlur,
    shadowDistance,
    shadowSpread,
    t,
    urlBgOpacity,
    urlBlur,
    setGlassEnabled,
    setShadowBlur,
    setShadowDistance,
    setShadowSpread,
    setUrlBgOpacity,
    setUrlBlur,
  ]);

  return { performanceMode, togglePerformanceMode };
}
