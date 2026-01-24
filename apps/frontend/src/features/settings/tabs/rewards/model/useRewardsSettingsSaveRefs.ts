import { useMemo, useRef } from 'react';

import type { MutableRefObject } from 'react';

export type RewardsSettingsSaveRefs = {
  settingsLoadedRef: MutableRefObject<string | null>;
  lastSavedTwitchRef: MutableRefObject<string | null>;
  lastSavedTwitchAutoRewardsRef: MutableRefObject<string | null>;
  lastSavedApprovedRef: MutableRefObject<string | null>;
  lastSavedKickRef: MutableRefObject<string | null>;
  lastSavedTrovoRef: MutableRefObject<string | null>;
  lastSavedVkvideoRef: MutableRefObject<string | null>;
  lastSavedBoostyRef: MutableRefObject<string | null>;
  lastSavedYoutubeLikeRef: MutableRefObject<string | null>;
};

export function useRewardsSettingsSaveRefs(): RewardsSettingsSaveRefs {
  const settingsLoadedRef = useRef<string | null>(null);
  const lastSavedTwitchRef = useRef<string | null>(null);
  const lastSavedTwitchAutoRewardsRef = useRef<string | null>(null);
  const lastSavedApprovedRef = useRef<string | null>(null);
  const lastSavedKickRef = useRef<string | null>(null);
  const lastSavedTrovoRef = useRef<string | null>(null);
  const lastSavedVkvideoRef = useRef<string | null>(null);
  const lastSavedBoostyRef = useRef<string | null>(null);
  const lastSavedYoutubeLikeRef = useRef<string | null>(null);

  return useMemo(
    () => ({
      settingsLoadedRef,
      lastSavedTwitchRef,
      lastSavedTwitchAutoRewardsRef,
      lastSavedApprovedRef,
      lastSavedKickRef,
      lastSavedTrovoRef,
      lastSavedVkvideoRef,
      lastSavedBoostyRef,
      lastSavedYoutubeLikeRef,
    }),
    [],
  );
}
