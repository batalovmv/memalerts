import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { toRecord } from '../types';
import type { OverlaySharePayload } from '../../obs/lib/shareCode';

type CustomPreset = { id: string; name: string; createdAt: number; payload: OverlaySharePayload };

type PresetActions = {
  setOverlayMode: (value: 'queue' | 'simultaneous') => void;
  setOverlayMaxConcurrent: (value: number) => void;
  setOverlayShowSender: (value: boolean) => void;
  setUrlPosition: (value: 'random' | 'center' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => void;
  setScaleMode: (value: 'fixed' | 'range') => void;
  setScaleMin: (value: number) => void;
  setScaleMax: (value: number) => void;
  setScaleFixed: (value: number) => void;
  setSafePad: (value: number) => void;
  setUrlAnim: (value: 'fade' | 'zoom' | 'slide-up' | 'pop' | 'lift' | 'none') => void;
  setUrlEnterMs: (value: number) => void;
  setUrlExitMs: (value: number) => void;
  setAnimEasingPreset: (value: 'ios' | 'smooth' | 'snappy' | 'linear' | 'custom') => void;
  setAnimEasingX1: (value: number) => void;
  setAnimEasingY1: (value: number) => void;
  setAnimEasingX2: (value: number) => void;
  setAnimEasingY2: (value: number) => void;
  setUrlRadius: (value: number) => void;
  setShadowBlur: (value: number) => void;
  setShadowSpread: (value: number) => void;
  setShadowDistance: (value: number) => void;
  setShadowAngle: (value: number) => void;
  setShadowOpacity: (value: number) => void;
  setShadowColor: (value: string) => void;
  setGlassEnabled: (value: boolean) => void;
  setGlassPreset: (value: 'ios' | 'clear' | 'prism') => void;
  setGlassTintColor: (value: string) => void;
  setGlassTintStrength: (value: number) => void;
  setUrlBlur: (value: number) => void;
  setUrlBgOpacity: (value: number) => void;
  setBorderPreset: (value: 'custom' | 'glass' | 'glow' | 'frosted') => void;
  setBorderTintColor: (value: string) => void;
  setBorderTintStrength: (value: number) => void;
  setUrlBorder: (value: number) => void;
  setBorderMode: (value: 'solid' | 'gradient') => void;
  setUrlBorderColor: (value: string) => void;
  setUrlBorderColor2: (value: string) => void;
  setUrlBorderGradientAngle: (value: number) => void;
  setSenderHoldMs: (value: number) => void;
  setSenderBgColor: (value: string) => void;
  setSenderBgOpacity: (value: number) => void;
  setSenderBgRadius: (value: number) => void;
  setSenderStroke: (value: 'none' | 'glass' | 'solid') => void;
  setSenderStrokeWidth: (value: number) => void;
  setSenderStrokeOpacity: (value: number) => void;
  setSenderStrokeColor: (value: string) => void;
  setSenderFontSize: (value: number) => void;
  setSenderFontWeight: (value: number) => void;
  setSenderFontFamily: (value: 'system' | 'inter' | 'roboto' | 'montserrat' | 'poppins' | 'oswald' | 'raleway' | 'nunito' | 'playfair' | 'jetbrains-mono' | 'mono' | 'serif') => void;
  setSenderFontColor: (value: string) => void;
  setAdvancedTab: (value: 'layout' | 'animation' | 'shadow' | 'border' | 'glass' | 'sender') => void;
};

export type OverlayPresetState = ReturnType<typeof useOverlayPresets>;

export function useOverlayPresets(
  channelSlug: string,
  makeSharePayload: () => OverlaySharePayload,
  actions: PresetActions
) {
  const { t } = useTranslation();
  const [presetName, setPresetName] = useState('');
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);

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
          .filter((p): p is CustomPreset => {
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
        const res = await api.get<{ presets?: Array<CustomPreset> }>('/streamer/overlay/presets', { timeout: 8000 });
        if (cancelled) return;
        const list = Array.isArray(res?.presets) ? res.presets : [];
        const cleaned = list
          .map((p) => ({
            id: String(p?.id || ''),
            name: String(p?.name || '').trim(),
            createdAt: Number(p?.createdAt || 0),
            payload: p?.payload && typeof p.payload === 'object' ? p.payload : null,
          }))
          .filter((p): p is CustomPreset => {
            return Boolean(p.id && p.name && p.payload);
          })
          .slice(0, 30);
        setCustomPresets(cleaned);
        return;
      } catch (e: unknown) {
        const err = e as { response?: { status?: number } };
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
    (next: CustomPreset[]) => {
      setCustomPresets(next);
      (async () => {
        try {
          const { api } = await import('@/lib/api');
          await api.put('/streamer/overlay/presets', { presets: next }, { timeout: 12000 });
          return;
        } catch (e: unknown) {
          const err = e as { response?: { status?: number } };
          if (err?.response?.status !== 404) {
            // fall back to localStorage without surfacing UI noise
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
    actions.setOverlayMode('queue');
    actions.setOverlayMaxConcurrent(3);
    actions.setOverlayShowSender(true);

    actions.setUrlPosition('random');

    actions.setScaleMode('range');
    actions.setScaleMin(0.72);
    actions.setScaleMax(1.0);
    actions.setScaleFixed(0.92);
    actions.setSafePad(80);

    actions.setUrlAnim('slide-up');
    actions.setUrlEnterMs(280);
    actions.setUrlExitMs(220);
    actions.setAnimEasingPreset('ios');
    actions.setAnimEasingX1(0.22);
    actions.setAnimEasingY1(1);
    actions.setAnimEasingX2(0.36);
    actions.setAnimEasingY2(1);

    actions.setUrlRadius(24);
    actions.setShadowBlur(70);
    actions.setShadowSpread(0);
    actions.setShadowDistance(22);
    actions.setShadowAngle(90);
    actions.setShadowOpacity(0.6);
    actions.setShadowColor('#000000');

    actions.setGlassEnabled(true);
    actions.setGlassPreset('ios');
    actions.setGlassTintColor('#7dd3fc');
    actions.setGlassTintStrength(0.22);
    actions.setUrlBlur(6);
    actions.setUrlBgOpacity(0.18);

    actions.setBorderPreset('glass');
    actions.setBorderTintColor('#7dd3fc');
    actions.setBorderTintStrength(0.38);
    actions.setUrlBorder(2);
    actions.setBorderMode('solid');
    actions.setUrlBorderColor('#ffffff');
    actions.setUrlBorderColor2('#7dd3fc');
    actions.setUrlBorderGradientAngle(135);

    actions.setSenderHoldMs(2600);
    actions.setSenderBgColor('#000000');
    actions.setSenderBgOpacity(0.55);
    actions.setSenderBgRadius(14);
    actions.setSenderStroke('glass');
    actions.setSenderStrokeWidth(1);
    actions.setSenderStrokeOpacity(0.24);
    actions.setSenderStrokeColor('#ffffff');

    actions.setSenderFontSize(14);
    actions.setSenderFontWeight(600);
    actions.setSenderFontFamily('system');
    actions.setSenderFontColor('#ffffff');

    actions.setAdvancedTab('border');
    toast.success(t('admin.overlayDefaultsApplied'));
  }, [actions, t]);

  const applyPreset = useCallback(
    (preset: 'default' | 'minimal' | 'neon') => {
      if (preset === 'default') {
        resetOverlayToDefaults();
        return;
      }

      if (preset === 'minimal') {
        actions.setOverlayMode('queue');
        actions.setOverlayMaxConcurrent(1);
        actions.setOverlayShowSender(false);
        actions.setUrlPosition('center');
        actions.setScaleMode('fixed');
        actions.setScaleFixed(1);
        actions.setScaleMin(0.9);
        actions.setScaleMax(1);
        actions.setSafePad(24);
        actions.setUrlAnim('fade');
        actions.setUrlEnterMs(180);
        actions.setUrlExitMs(180);
        actions.setUrlRadius(18);
        actions.setShadowBlur(22);
        actions.setShadowSpread(0);
        actions.setShadowDistance(10);
        actions.setShadowAngle(90);
        actions.setShadowOpacity(0.35);
        actions.setShadowColor('#000000');
        actions.setGlassEnabled(false);
        actions.setUrlBlur(0);
        actions.setUrlBgOpacity(0);
        actions.setBorderPreset('custom');
        actions.setUrlBorder(0);
        actions.setBorderMode('solid');
        actions.setUrlBorderColor('#ffffff');
        actions.setUrlBorderColor2('#00e5ff');
        actions.setUrlBorderGradientAngle(135);
        actions.setAdvancedTab('layout');
        return;
      }

      actions.setOverlayMode('simultaneous');
      actions.setOverlayMaxConcurrent(3);
      actions.setOverlayShowSender(true);
      actions.setUrlPosition('random');
      actions.setScaleMode('range');
      actions.setScaleMin(0.7);
      actions.setScaleMax(1.05);
      actions.setScaleFixed(0.9);
      actions.setSafePad(80);
      actions.setUrlAnim('pop');
      actions.setUrlEnterMs(260);
      actions.setUrlExitMs(220);
      actions.setUrlRadius(26);
      actions.setShadowBlur(110);
      actions.setShadowSpread(18);
      actions.setShadowDistance(18);
      actions.setShadowAngle(120);
      actions.setShadowOpacity(0.55);
      actions.setShadowColor('#000000');
      actions.setGlassEnabled(true);
      actions.setGlassPreset('prism');
      actions.setGlassTintStrength(0.22);
      actions.setUrlBlur(12);
      actions.setUrlBgOpacity(0.24);
      actions.setBorderPreset('glow');
      actions.setBorderTintColor('#00E5FF');
      actions.setBorderTintStrength(0.55);
      actions.setUrlBorder(3);
      actions.setBorderMode('gradient');
      actions.setUrlBorderColor('#00E5FF');
      actions.setUrlBorderColor2('#A78BFA');
      actions.setUrlBorderGradientAngle(135);
      actions.setAdvancedTab('border');
    },
    [actions, resetOverlayToDefaults]
  );

  return {
    presetName,
    setPresetName,
    customPresets,
    saveCurrentAsCustomPreset,
    deleteCustomPreset,
    applyPreset,
    resetOverlayToDefaults,
  };
}
