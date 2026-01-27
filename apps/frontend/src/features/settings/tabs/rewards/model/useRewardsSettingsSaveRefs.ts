import { useMemo, useRef } from 'react';

import type { MutableRefObject } from 'react';

export type RewardsSettingsSaveRefs = {
  settingsLoadedRef: MutableRefObject<string | null>;
  lastSavedTwitchRef: MutableRefObject<string | null>;
  lastSavedApprovedRef: MutableRefObject<string | null>;
  lastSavedVkvideoRef: MutableRefObject<string | null>;
  lastSavedEconomyRef: MutableRefObject<string | null>;
  lastSavedWheelRef: MutableRefObject<string | null>;
};

export function useRewardsSettingsSaveRefs(): RewardsSettingsSaveRefs {
  const settingsLoadedRef = useRef<string | null>(null);
  const lastSavedTwitchRef = useRef<string | null>(null);
  const lastSavedApprovedRef = useRef<string | null>(null);
  const lastSavedVkvideoRef = useRef<string | null>(null);
  const lastSavedEconomyRef = useRef<string | null>(null);
  const lastSavedWheelRef = useRef<string | null>(null);

  return useMemo(
    () => ({
      settingsLoadedRef,
      lastSavedTwitchRef,
      lastSavedApprovedRef,
      lastSavedVkvideoRef,
      lastSavedEconomyRef,
      lastSavedWheelRef,
    }),
    [],
  );
}
