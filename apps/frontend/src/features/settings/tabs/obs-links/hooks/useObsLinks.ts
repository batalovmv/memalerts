import { useEffect, useState } from 'react';

import { useCreditsSession } from './useCreditsSession';
import { useCreditsSettings } from './useCreditsSettings';
import { useObsLinkForm } from './useObsLinkForm';
import { useOverlayPreview } from './useOverlayPreview';
import { useOverlaySettings } from './useOverlaySettings';

import { useSocket } from '@/contexts/SocketContext';
import { getApiOriginForRedirect } from '@/shared/auth/login';
import { getRuntimeConfig } from '@/shared/config/runtimeConfig';
import { useAppSelector } from '@/store/hooks';

export type ObsLinksState = ReturnType<typeof useObsLinks>;

export function useObsLinks() {
  const { user } = useAppSelector((state) => state.auth);
  const { socket, isConnected } = useSocket();

  const channelSlug = user?.channel?.slug || '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const apiOrigin = typeof window !== 'undefined' ? getApiOriginForRedirect() : '';

  const [overlayKind, setOverlayKind] = useState<'memes' | 'credits'>('memes');
  const creditsEnabled = getRuntimeConfig()?.creditsOverlayEnabled !== false;

  useEffect(() => {
    if (!creditsEnabled && overlayKind === 'credits') {
      setOverlayKind('memes');
    }
  }, [creditsEnabled, overlayKind]);

  const overlayForm = useObsLinkForm(channelSlug);
  const overlaySettings = useOverlaySettings(channelSlug, overlayForm);
  const creditsSettings = useCreditsSettings(channelSlug);
  const creditsSession = useCreditsSession({ channelSlug, overlayKind, socket, isConnected });
  const preview = useOverlayPreview({
    channelSlug,
    overlayKind,
    overlayToken: overlaySettings.overlayToken,
    origin,
    apiOrigin,
    overlayForm,
    creditsSettings,
  });

  const overlayUrl = overlaySettings.overlayToken ? `${origin}/overlay/t/${overlaySettings.overlayToken}` : '';
  const creditsUrlResolved =
    creditsSettings.creditsUrl ||
    (creditsSettings.creditsToken ? `${apiOrigin || origin}/overlay/credits/t/${creditsSettings.creditsToken}` : '');

  return {
    channelSlug,
    origin,
    apiOrigin,
    overlayKind,
    setOverlayKind,
    creditsEnabled,
    overlayForm,
    overlaySettings,
    creditsSettings,
    creditsSession,
    preview,
    overlayUrlWithDefaults: overlayUrl,
    creditsUrlWithDefaults: creditsUrlResolved,
  };
}
