import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import { useChannelColors } from '@/contexts/ChannelColorsContext';
import { useAppSelector } from '@/store/hooks';

export function useHeaderChannelData(params: {
  channelSlug?: string;
  coinIconUrl?: string | null;
  rewardTitle?: string | null;
}) {
  const { channelSlug, coinIconUrl, rewardTitle } = params;
  const { user } = useAppSelector((state) => state.auth);
  const location = useLocation();
  const routeParams = useParams<{ slug: string }>();
  const { getChannelData, getCachedChannelData } = useChannelColors();

  const [channelCoinIconUrl, setChannelCoinIconUrl] = useState<string | null>(coinIconUrl ?? null);
  const [channelRewardTitle, setChannelRewardTitle] = useState<string | null>(rewardTitle ?? null);
  const channelDataLoadedRef = useRef<string | null>(null);

  useEffect(() => {
    const loadChannelData = async () => {
      if (coinIconUrl !== undefined) {
        setChannelCoinIconUrl(coinIconUrl);
      }
      if (rewardTitle !== undefined) {
        setChannelRewardTitle(rewardTitle ?? null);
      }

      if (coinIconUrl !== undefined && rewardTitle !== undefined) {
        channelDataLoadedRef.current = 'props';
        return;
      }

      const slugToUse = user?.channel?.slug || channelSlug || routeParams.slug;
      if (!slugToUse) {
        channelDataLoadedRef.current = null;
        return;
      }

      if (channelDataLoadedRef.current === slugToUse) {
        return;
      }

      if (location.pathname.startsWith('/channel/')) {
        channelDataLoadedRef.current = null;
        return;
      }

      const cached = getCachedChannelData(slugToUse);
      if (cached) {
        if (coinIconUrl === undefined && cached.coinIconUrl) {
          setChannelCoinIconUrl(cached.coinIconUrl);
        }
        if (rewardTitle === undefined && cached.rewardTitle) {
          setChannelRewardTitle(cached.rewardTitle);
        }
        if ((coinIconUrl !== undefined || cached.coinIconUrl) && (rewardTitle !== undefined || cached.rewardTitle)) {
          channelDataLoadedRef.current = slugToUse;
          return;
        }
      }

      const channelData = await getChannelData(slugToUse);
      if (channelData) {
        if (coinIconUrl === undefined && channelData.coinIconUrl) {
          setChannelCoinIconUrl(channelData.coinIconUrl);
        }
        if (rewardTitle === undefined && channelData.rewardTitle) {
          setChannelRewardTitle(channelData.rewardTitle);
        }
        channelDataLoadedRef.current = slugToUse;
      }
    };

    void loadChannelData();
  }, [
    coinIconUrl,
    rewardTitle,
    user?.channel?.slug,
    channelSlug,
    routeParams.slug,
    getCachedChannelData,
    getChannelData,
    location.pathname,
  ]);

  return {
    coinIconUrl: coinIconUrl !== undefined ? coinIconUrl : channelCoinIconUrl,
    rewardTitle: rewardTitle !== undefined ? rewardTitle : channelRewardTitle,
  };
}
