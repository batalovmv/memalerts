import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChannelInfo } from '@/features/streamer-profile/model/types';
import type { AchievementItem, AchievementSnapshot, ChannelEconomy, EventAchievementItem, User } from '@memalerts/api-contracts';

import { resolveMediaUrl } from '@/lib/urls';
import { Button, HelpTooltip, Pill, Tooltip } from '@/shared/ui';

type StreamerProfileHeaderProps = {
  loading: boolean;
  channelInfo: ChannelInfo | null;
  user: User | null;
  isAuthed: boolean;
  economy?: ChannelEconomy;
  claimingDaily: boolean;
  claimingWatch: boolean;
  onClaimDaily: () => void;
  onClaimWatch: () => void;
  achievements: AchievementSnapshot | null;
  achievementsLoading: boolean;
  isOwner: boolean;
  mix: (cssVar: '--primary-color' | '--secondary-color' | '--accent-color', percent: number) => string;
  onOpenSubmit: () => void;
  onOpenAuthModal: () => void;
};

const MAX_ACHIEVEMENT_ICONS = 10;
type AchievementIconItem = AchievementItem | EventAchievementItem;

export function StreamerProfileHeader({
  loading,
  channelInfo,
  user,
  isAuthed,
  economy,
  claimingDaily,
  claimingWatch,
  onClaimDaily,
  onClaimWatch,
  achievements,
  achievementsLoading,
  isOwner,
  mix,
  onOpenSubmit,
  onOpenAuthModal,
}: StreamerProfileHeaderProps) {
  const { t } = useTranslation();

  const ownerAvatarUrl = useMemo(() => {
    const rawUrl = (isOwner ? user?.profileImageUrl || channelInfo?.owner?.profileImageUrl : channelInfo?.owner?.profileImageUrl) || '';
    const normalized = rawUrl.trim();
    return normalized ? resolveMediaUrl(normalized) : '';
  }, [channelInfo?.owner?.profileImageUrl, isOwner, user?.profileImageUrl]);
  const accentPillStyle = useMemo(
    () => ({ backgroundColor: mix('--accent-color', 14) }),
    [mix],
  );
  const secondaryPillStyle = useMemo(
    () => ({ backgroundColor: mix('--secondary-color', 14) }),
    [mix],
  );
  const handleSubmitClick = useCallback(() => {
    if (channelInfo?.submissionsEnabled === false) return;
    onOpenSubmit();
  }, [channelInfo?.submissionsEnabled, onOpenSubmit]);

  const isLive = economy?.stream?.status === 'online';
  const dailyCoins = economy?.computed?.dailyBonusCoins ?? 0;
  const watchCoins = economy?.computed?.watchBonusCoins ?? 0;
  const dailyCanClaim = !!(isAuthed && economy?.viewer?.daily?.canClaim && dailyCoins > 0);
  const watchCanClaim = !!(isAuthed && economy?.viewer?.watch?.canClaim && watchCoins > 0 && isLive);

  const handleDailyClick = useCallback(() => {
    if (!isAuthed) {
      onOpenAuthModal();
      return;
    }
    if (!dailyCanClaim || claimingDaily) return;
    onClaimDaily();
  }, [claimingDaily, dailyCanClaim, isAuthed, onClaimDaily, onOpenAuthModal]);

  const handleWatchClick = useCallback(() => {
    if (!isAuthed) {
      onOpenAuthModal();
      return;
    }
    if (!watchCanClaim || claimingWatch) return;
    onClaimWatch();
  }, [claimingWatch, isAuthed, onClaimWatch, onOpenAuthModal, watchCanClaim]);

  const unlockedAchievements = useMemo(() => {
    if (!achievements || achievementsLoading) return [];
    const channelUnlocked = (achievements.channel || []).filter((item) => item.achievedAt);
    const globalUnlocked = (achievements.global || []).filter((item) => item.achievedAt);
    const eventUnlocked = (achievements.events || []).filter((item) => item.achievedAt);
    return [...channelUnlocked, ...globalUnlocked, ...eventUnlocked];
  }, [achievements, achievementsLoading]);

  const visibleAchievements = useMemo(
    () => unlockedAchievements.slice(0, MAX_ACHIEVEMENT_ICONS),
    [unlockedAchievements],
  );
  const hiddenAchievementsCount = Math.max(0, unlockedAchievements.length - visibleAchievements.length);

  const buildAchievementIconSrc = useCallback((item: AchievementIconItem) => {
    const key = encodeURIComponent(item.key);
    if ('eventKey' in item && item.eventKey) {
      const eventKey = encodeURIComponent(item.eventKey);
      return `/achievements/events/${eventKey}/${key}.png`;
    }
    return `/achievements/${item.scope}/${key}.png`;
  }, []);

  const buildAchievementTooltip = useCallback(
    (item: AchievementIconItem) => {
      const scopeLabel =
        item.scope === 'channel'
          ? t('achievements.channel', { defaultValue: 'Channel' })
          : item.scope === 'event'
            ? t('achievements.event', { defaultValue: 'Event' })
            : t('achievements.global', { defaultValue: 'Global' });
      const rewardLabel = item.rewardCoins
        ? t('achievements.reward', { defaultValue: '+{{count}} coins', count: item.rewardCoins })
        : '';
      const parts = [scopeLabel, item.title, item.description || '', rewardLabel].filter(Boolean);
      return parts.join(' · ');
    },
    [t],
  );
  if (loading) {
    return (
      <div className="mb-8 pb-6">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
          <div>
            <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-2" />
            <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!channelInfo) {
    return null;
  }

  return (
    <div className="mb-8 pb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-4">
          <div className="flex flex-col items-start gap-2">
            {/* Avatar */}
            {ownerAvatarUrl ? (
              <img
                src={ownerAvatarUrl}
                alt={channelInfo.owner?.displayName || channelInfo.name}
                className="w-20 h-20 rounded-lg object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-20 h-20 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-2xl">
                {channelInfo.name.charAt(0).toUpperCase()}
              </div>
            )}
            {isAuthed && visibleAchievements.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {visibleAchievements.map((item) => {
                  const tooltip = buildAchievementTooltip(item);
                  return (
                    <Tooltip key={`${item.scope}:${item.key}`} content={tooltip} delayMs={500}>
                      <img
                        src={buildAchievementIconSrc(item)}
                        alt={item.title}
                        className="h-4 w-4 rounded-[4px] ring-1 ring-black/10 dark:ring-white/10"
                        style={{ imageRendering: 'pixelated' }}
                        loading="lazy"
                      />
                    </Tooltip>
                  );
                })}
                {hiddenAchievementsCount > 0 ? (
                  <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                    +{hiddenAchievementsCount}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-4xl font-bold mb-2 dark:text-white">{channelInfo.name}</h1>
            </div>
            <div className="mt-4 flex gap-4 text-sm">
              <Pill
                variant="neutral"
                size="sm"
                className="ring-0 px-3 py-1 text-accent"
                style={accentPillStyle}
              >
                {channelInfo.stats.memesCount} {t('profile.memes')}
              </Pill>
              <Pill
                variant="neutral"
                size="sm"
                className="ring-0 px-3 py-1 text-secondary"
                style={secondaryPillStyle}
              >
                {channelInfo.stats.usersCount} {t('profile.users', { defaultValue: 'users' })}
              </Pill>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {dailyCanClaim || watchCanClaim ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {dailyCanClaim ? (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  className="rounded-full px-3 py-1.5 text-xs"
                  onClick={handleDailyClick}
                  disabled={claimingDaily}
                >
                  {claimingDaily
                    ? t('economy.claiming', { defaultValue: 'Claiming...' })
                    : t('economy.dailyAction', { defaultValue: 'Daily +{{count}}', count: dailyCoins })}
                </Button>
              ) : null}
              {watchCanClaim ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="rounded-full px-3 py-1.5 text-xs"
                  onClick={handleWatchClick}
                  disabled={claimingWatch}
                >
                  {claimingWatch
                    ? t('economy.claiming', { defaultValue: 'Claiming...' })
                    : t('economy.watchAction', { defaultValue: 'Watch +{{count}}', count: watchCoins })}
                </Button>
              ) : null}
            </div>
          ) : null}
          {/* Submit Meme Button - only show when logged in and not owner */}
          {user && !isOwner ? (
            <div className="flex flex-col items-end gap-2">
              <HelpTooltip
                content={
                  channelInfo?.submissionsEnabled === false
                    ? t('submitModal.submissionsDisabled', { defaultValue: 'Отправка мемов запрещена стримером' })
                    : t('help.profile.submitMeme', { defaultValue: 'Submit a meme to this channel.' })
                }
              >
                <Button
                  type="button"
                  variant="primary"
                  disabled={channelInfo?.submissionsEnabled === false}
                  onClick={handleSubmitClick}
                  leftIcon={
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  }
                >
                  {t('profile.submitMeme')}
                </Button>
              </HelpTooltip>
            </div>
          ) : null}

          {/* Guest CTA */}
          {!user && (
            <HelpTooltip content={t('help.profile.loginToInteract', { defaultValue: 'Log in to submit memes and use favorites.' })}>
              <Button type="button" variant="secondary" className="glass-btn" onClick={onOpenAuthModal}>
                {t('auth.login', 'Log in with Twitch')}
              </Button>
            </HelpTooltip>
          )}
        </div>
      </div>
    </div>
  );
}

