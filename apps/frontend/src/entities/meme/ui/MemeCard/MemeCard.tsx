import { memo, useMemo } from 'react';

import { useMemeCard, type MemeCardPreviewMode } from './model/useMemeCard';
import { MemeCardView } from './ui/MemeCardView';
import type { MemeCardItem } from './model/types';

import { resolveMediaUrl } from '@/shared/config/urls';

export interface MemeCardProps {
  meme: MemeCardItem;
  previewMode?: MemeCardPreviewMode;
  onClick: () => void;
}

function MemeCardBase({ meme, previewMode = 'hoverMuted', onClick }: MemeCardProps) {
  const variantUrl = meme.variants?.[0]?.fileUrl;
  const mediaUrl = useMemo(() => {
    if (meme.previewUrl) return resolveMediaUrl(meme.previewUrl);
    if (variantUrl) return resolveMediaUrl(variantUrl);
    return resolveMediaUrl(meme.fileUrl);
  }, [meme.previewUrl, variantUrl, meme.fileUrl]);

  const vm = useMemeCard({ meme, mediaUrl, previewMode, onClick });

  return (
    <MemeCardView
      meme={meme}
      mediaUrl={mediaUrl}
      previewMode={previewMode}
      aspectRatio={vm.aspectRatio}
      isHovered={vm.isHovered}
      shouldLoadMedia={vm.shouldLoadMedia}
      videoMuted={vm.getVideoMuted()}
      setCardEl={vm.setCardEl}
      videoRef={vm.videoRef}
      onMediaError={() => {}}
      onMouseEnter={vm.onMouseEnter}
      onMouseLeave={vm.onMouseLeave}
      onClick={vm.onClick}
      onMouseDown={vm.onMouseDown}
      onTouchStart={vm.onTouchStart}
      onKeyDown={vm.onKeyDown}
    />
  );
}

export const MemeCard = memo(MemeCardBase);
