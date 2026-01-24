import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type {
  BoostySettingsState,
  BoostyTierCoinsErrorState,
  BoostyTierCoinsRowErrors,
} from '@/features/settings/tabs/rewards/types';
import type { MutableRefObject } from 'react';

import { parseIntSafe, toRecord } from '@/features/settings/tabs/rewards/utils';
import { toApiError } from '@/shared/api/toApiError';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';

type UseBoostyRewardsParams = {
  channelSlug: string | null | undefined;
  settingsLoadedRef: MutableRefObject<string | null>;
  lastSavedBoostyRef: MutableRefObject<string | null>;
};

const DEFAULT_BOOSTY_SETTINGS: BoostySettingsState = {
  boostyBlogName: '',
  boostyCoinsPerSub: '0',
  boostyTierCoins: [],
};

export function useBoostyRewards({ channelSlug, settingsLoadedRef, lastSavedBoostyRef }: UseBoostyRewardsParams) {
  const { t } = useTranslation();
  const [boostySettings, setBoostySettings] = useState<BoostySettingsState>(DEFAULT_BOOSTY_SETTINGS);
  const [boostyTierErrors, setBoostyTierErrors] = useState<BoostyTierCoinsErrorState>({ table: null, rows: {} });
  const [savingBoosty, setSavingBoosty] = useState(false);
  const [boostySavedPulse, setBoostySavedPulse] = useState(false);
  const saveBoostyTimerRef = useRef<number | null>(null);

  const applyBoostySnapshot = useCallback(
    (source: unknown) => {
      const rec = toRecord(source);
      if (!rec) return;
      const boostyBlogName = typeof rec.boostyBlogName === 'string' ? rec.boostyBlogName : '';
      const boostyCoinsPerSub = typeof rec.boostyCoinsPerSub === 'number' ? rec.boostyCoinsPerSub : 0;
      const boostyTierCoinsRaw = Array.isArray(rec.boostyTierCoins) ? rec.boostyTierCoins : [];
      const boostyTierCoins = boostyTierCoinsRaw
        .map((x) => ({
          tierKey: typeof (x as { tierKey?: unknown }).tierKey === 'string' ? String((x as { tierKey?: unknown }).tierKey) : '',
          coins: typeof (x as { coins?: unknown }).coins === 'number' ? String((x as { coins?: unknown }).coins) : '',
        }))
        .filter((x) => x.tierKey || x.coins);
      setBoostySettings({
        boostyBlogName,
        boostyCoinsPerSub: String(boostyCoinsPerSub ?? 0),
        boostyTierCoins,
      });
      lastSavedBoostyRef.current = JSON.stringify({
        boostyBlogName: boostyBlogName.trim() ? boostyBlogName : null,
        boostyCoinsPerSub: boostyCoinsPerSub ?? 0,
        boostyTierCoins: boostyTierCoinsRaw,
      });
      setBoostyTierErrors({ table: null, rows: {} });
    },
    [lastSavedBoostyRef],
  );

  const saveBoostySettings = useCallback(async () => {
    if (!channelSlug) return;
    if (!settingsLoadedRef.current) return;
    if (savingBoosty) return;

    const blogNameTrimmed = (boostySettings.boostyBlogName || '').trim();
    const coinsPerSubRaw = String(boostySettings.boostyCoinsPerSub || '').trim();
    const coinsPerSub = parseIntSafe(coinsPerSubRaw || '0') ?? 0;

    const rowsErr: BoostyTierCoinsRowErrors = {};
    const sanitizedRows: Array<{ tierKey: string; coins: number }> = [];

    boostySettings.boostyTierCoins.forEach((row, idx) => {
      const tierKeyRaw = String(row.tierKey || '');
      const coinsRaw = String(row.coins || '');
      const isEmpty = !tierKeyRaw.trim() && !coinsRaw.trim();
      if (isEmpty) return;

      const tierKey = tierKeyRaw;
      const coinsStr = coinsRaw.trim();

      if (!tierKey.trim()) {
        rowsErr[idx] = { ...(rowsErr[idx] || {}), tierKey: t('admin.boostyTierKeyRequired', { defaultValue: 'Укажите tierKey.' }) };
      }

      if (!coinsStr) {
        rowsErr[idx] = { ...(rowsErr[idx] || {}), coins: t('admin.boostyCoinsRequired', { defaultValue: 'Укажите coins.' }) };
      } else {
        const n = parseIntSafe(coinsStr);
        if (n === null || !Number.isInteger(n)) {
          rowsErr[idx] = {
            ...(rowsErr[idx] || {}),
            coins: t('admin.boostyCoinsInvalid', { defaultValue: 'coins должно быть целым числом.' }),
          };
        } else if (n < 0 || n > 1_000_000) {
          rowsErr[idx] = {
            ...(rowsErr[idx] || {}),
            coins: t('admin.boostyCoinsRange', { defaultValue: 'coins должно быть в диапазоне 0..1_000_000.' }),
          };
        } else if (tierKey.trim()) {
          sanitizedRows.push({ tierKey, coins: n });
        }
      }
    });

    // Optional (UX): preflight duplicate tierKey (case-insensitive) before request.
    // Ignore incomplete rows (no coins yet) to avoid yelling while the user is still typing.
    // Backend validates this too, but highlighting duplicates locally reduces round-trips.
    const seenTierKeys = new Map<string, { idx: number; rawKey: string }>();
    boostySettings.boostyTierCoins.forEach((row, idx) => {
      const rawKey = String(row.tierKey || '').trim();
      const rawCoins = String(row.coins || '').trim();
      // ignore incomplete rows (UX)
      if (!rawKey || rawCoins === '') return;
      // ignore invalid coins rows (they already have/should have a coins error)
      const coins = parseIntSafe(rawCoins);
      if (coins === null) return;

      const key = rawKey.toLowerCase();
      const prev = seenTierKeys.get(key);
      if (!prev) {
        seenTierKeys.set(key, { idx, rawKey });
        return;
      }

      const msg = t('admin.boostyTierKeyDuplicate', {
        defaultValue: 'Duplicate tierKey (case-insensitive): {{tierKey}}',
        tierKey: `"${rawKey}" (${key})`,
      });
      if (!rowsErr[idx]?.tierKey) rowsErr[idx] = { ...(rowsErr[idx] || {}), tierKey: msg };
      if (!rowsErr[prev.idx]?.tierKey) rowsErr[prev.idx] = { ...(rowsErr[prev.idx] || {}), tierKey: msg };
    });

    // Front validation errors: show inline; do not send request.
    if (Object.keys(rowsErr).length > 0) {
      setBoostyTierErrors({ table: null, rows: rowsErr });
      return;
    }

    // Clear table errors before request; server-side Zod issues will be re-filled on failure.
    setBoostyTierErrors({ table: null, rows: {} });

    const payloadObj = {
      boostyBlogName: blogNameTrimmed ? blogNameTrimmed : null,
      boostyCoinsPerSub: Number.isFinite(coinsPerSub) ? coinsPerSub : 0,
      boostyTierCoins: sanitizedRows,
    };
    const payload = JSON.stringify(payloadObj);
    if (payload === lastSavedBoostyRef.current) return;

    const startedAt = Date.now();
    setSavingBoosty(true);
    try {
      const { api } = await import('@/lib/api');
      await api.patch('/streamer/channel/settings', payloadObj);
      lastSavedBoostyRef.current = payload;
    } catch (e) {
      const err = toApiError(e, t('admin.failedToSaveSettings', { defaultValue: 'Failed to save settings' }));

      if (err.errorCode === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
        let table: string | null = null;
        const nextRows: BoostyTierCoinsRowErrors = {};

        for (const issue of err.details) {
          const msg =
            typeof (issue as { message?: unknown } | null)?.message === 'string' ? (issue as { message: string }).message : err.message;
          const path = (issue as { path?: unknown } | null)?.path;
          if (!Array.isArray(path)) continue;

          if (path.length === 1 && path[0] === 'boostyTierCoins') {
            table = msg;
            continue;
          }

          if (path[0] === 'boostyTierCoins' && typeof path[1] === 'number') {
            const idx = path[1];
            const field = path[2];
            if (field === 'tierKey') nextRows[idx] = { ...(nextRows[idx] || {}), tierKey: msg };
            else if (field === 'coins') nextRows[idx] = { ...(nextRows[idx] || {}), coins: msg };
            else nextRows[idx] = { ...(nextRows[idx] || {}), tierKey: msg };
          }
        }

        setBoostyTierErrors({ table, rows: nextRows });
        return; // Important: no toast on inline validation errors.
      }

      toast.error(err.error || err.message);
    } finally {
      await ensureMinDuration(startedAt, 650);
      setSavingBoosty(false);
      setBoostySavedPulse(true);
      window.setTimeout(() => setBoostySavedPulse(false), 700);
    }
  }, [
    boostySettings.boostyBlogName,
    boostySettings.boostyCoinsPerSub,
    boostySettings.boostyTierCoins,
    channelSlug,
    lastSavedBoostyRef,
    savingBoosty,
    settingsLoadedRef,
    t,
  ]);

  // Autosave: Boosty settings (debounced)
  useEffect(() => {
    if (!channelSlug) return;
    if (!settingsLoadedRef.current) return;
    if (saveBoostyTimerRef.current) window.clearTimeout(saveBoostyTimerRef.current);
    saveBoostyTimerRef.current = window.setTimeout(() => {
      void saveBoostySettings();
    }, 500);

    return () => {
      if (saveBoostyTimerRef.current) window.clearTimeout(saveBoostyTimerRef.current);
      saveBoostyTimerRef.current = null;
    };
  }, [
    boostySettings.boostyBlogName,
    boostySettings.boostyCoinsPerSub,
    boostySettings.boostyTierCoins,
    channelSlug,
    saveBoostySettings,
    settingsLoadedRef,
  ]);

  return {
    boostySettings,
    setBoostySettings,
    boostyTierErrors,
    setBoostyTierErrors,
    savingBoosty,
    boostySavedPulse,
    applyBoostySnapshot,
  };
}
