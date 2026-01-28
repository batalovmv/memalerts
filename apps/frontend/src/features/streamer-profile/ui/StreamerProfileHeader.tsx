import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChannelInfo } from '@/features/streamer-profile/model/types';
import type { AchievementItem, User } from '@memalerts/api-contracts';

import { resolveMediaUrl } from '@/lib/urls';
import { Button, HelpTooltip, Pill } from '@/shared/ui';

type StreamerProfileHeaderProps = {
  loading: boolean;
  channelInfo: ChannelInfo | null;
  streamerAchievements: AchievementItem[] | null;
  streamerAchievementsLoading: boolean;
  user: User | null;
  isOwner: boolean;
  mix: (cssVar: '--primary-color' | '--secondary-color' | '--accent-color', percent: number) => string;
  onOpenSubmit: () => void;
  onOpenAuthModal: () => void;
};

export function StreamerProfileHeader({
  loading,
  channelInfo,
  streamerAchievements,
  streamerAchievementsLoading,
  user,
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

  const unlockedStreamerAchievements = (streamerAchievements ?? []).filter((item) => !!item.achievedAt).slice(0, 3);

  return (
    <div className="mb-8 pb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
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
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-4xl font-bold mb-2 dark:text-white">{channelInfo.name}</h1>
            </div>

            {!streamerAchievementsLoading && unlockedStreamerAchievements.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {unlockedStreamerAchievements.map((item) => (
                  <Pill
                    key={item.key}
                    variant="neutral"
                    size="sm"
                    className="ring-0 px-2.5 py-1 text-gray-800 dark:text-gray-100"
                    title={item.description || item.title}
                    style={{ backgroundColor: mix('--primary-color', 10) }}
                  >
                    {item.title}
                  </Pill>
                ))}
              </div>
            ) : null}

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
  );
}

