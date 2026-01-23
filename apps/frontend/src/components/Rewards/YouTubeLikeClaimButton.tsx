import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { claimYouTubeLike, getYouTubeForceSslLinkUrl, type YouTubeLikeClaimResponse } from '@/shared/api/rewards';
import { linkExternalAccount } from '@/shared/auth/login';
import { Button } from '@/shared/ui';

export type YouTubeLikeClaimButtonProps = {
  channelSlug: string;
  coins: number;
  onAwarded?: (resp: YouTubeLikeClaimResponse) => void;
};

export function YouTubeLikeClaimButton({ channelSlug, coins, onAwarded }: YouTubeLikeClaimButtonProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);

  const onClick = useCallback(async () => {
    if (!channelSlug) return;
    setIsLoading(true);
    try {
      const resp = await claimYouTubeLike({ channelSlug });

      if (resp.status === 'need_youtube_link') {
        toast.error(t('rewards.youtubeLike.needLink', { defaultValue: 'Привяжи YouTube, чтобы получить награду.' }));
        linkExternalAccount('youtube', window.location.pathname);
        return;
      }
      if (resp.status === 'need_relink_scopes') {
        toast.error(t('rewards.youtubeLike.needScopes', { defaultValue: 'Нужно дать доступ YouTube для наград.' }));
        window.location.href = getYouTubeForceSslLinkUrl({ redirectTo: window.location.pathname });
        return;
      }
      if (resp.status === 'not_live') {
        toast.error(t('rewards.youtubeLike.notLive', { defaultValue: 'Стрим не активен.' }));
        return;
      }
      if (resp.status === 'cooldown') {
        toast.error(t('rewards.youtubeLike.cooldown', { defaultValue: 'Попробуй позже.' }));
        return;
      }
      if (resp.status === 'not_liked') {
        toast.error(t('rewards.youtubeLike.notLiked', { defaultValue: 'Лайк не найден.' }));
        return;
      }
      if (resp.status === 'disabled') {
        toast.error(t('rewards.youtubeLike.disabled', { defaultValue: 'Награда отключена.' }));
        return;
      }
      if (resp.status === 'failed') {
        toast.error(t('rewards.youtubeLike.failed', { defaultValue: 'Не удалось проверить лайк.' }));
        return;
      }

      if (resp.status === 'awarded') {
        toast.success(
          t('rewards.youtubeLike.awarded', {
            defaultValue: 'Награда получена.',
          })
        );
        onAwarded?.(resp);
        return;
      }
      if (resp.status === 'already_awarded') {
        toast.success(t('rewards.youtubeLike.alreadyAwarded', { defaultValue: 'Награда уже была получена.' }));
        onAwarded?.(resp);
        return;
      }

      toast.error(resp.status);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number } };
      if (err.response?.status === 401) {
        toast.error(t('auth.authRequired', { defaultValue: 'Please sign in to continue.' }));
        return;
      }
      toast.error(t('rewards.youtubeLike.failed', { defaultValue: 'Не удалось проверить лайк.' }));
    } finally {
      setIsLoading(false);
    }
  }, [channelSlug, onAwarded, t]);

  return (
    <Button type="button" variant="secondary" size="sm" disabled={isLoading} onClick={onClick}>
      {t('rewards.youtubeLike.cta', { defaultValue: `Проверить лайк и получить +${coins}` })}
    </Button>
  );
}


