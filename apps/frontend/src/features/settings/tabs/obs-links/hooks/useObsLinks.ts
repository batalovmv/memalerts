import { useObsLinkForm } from './useObsLinkForm';
import { useOverlayPreview } from './useOverlayPreview';
import { useOverlaySettings } from './useOverlaySettings';

import { useAppSelector } from '@/store/hooks';

export type ObsLinksState = ReturnType<typeof useObsLinks>;

export function useObsLinks() {
  const { user } = useAppSelector((state) => state.auth);
  const channelSlug = user?.channel?.slug || '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const overlayForm = useObsLinkForm(channelSlug);
  const overlaySettings = useOverlaySettings(channelSlug, overlayForm);
  const preview = useOverlayPreview({
    channelSlug,
    overlayToken: overlaySettings.overlayToken,
    origin,
    overlayForm,
  });

  const overlayUrl = overlaySettings.overlayToken ? `${origin}/overlay/t/${overlaySettings.overlayToken}` : '';

  return {
    channelSlug,
    origin,
    overlayForm,
    overlaySettings,
    preview,
    overlayUrlWithDefaults: overlayUrl,
  };
}
