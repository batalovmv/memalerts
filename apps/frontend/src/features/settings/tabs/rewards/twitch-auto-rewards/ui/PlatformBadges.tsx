import type { PlatformCode } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/types';

import { PLATFORM_TITLES } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/utils';

type PlatformBadgesProps = {
  platforms: PlatformCode[];
};

export function PlatformBadges({ platforms }: PlatformBadgesProps) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {platforms.map((code) => (
        <span
          key={code}
          title={PLATFORM_TITLES[code]}
          className="rounded-md bg-black/5 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700 dark:text-gray-200"
        >
          {code}
        </span>
      ))}
    </span>
  );
}
