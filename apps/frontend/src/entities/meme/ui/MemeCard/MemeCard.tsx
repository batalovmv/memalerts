import { getMemeMediaUrl } from './lib/getMemeMediaUrl';
import { useMemeCard, type MemeCardPreviewMode } from './model/useMemeCard';
import { MemeCardView } from './ui/MemeCardView';

import type { Meme } from '@/types';

export interface MemeCardProps {
  meme: Meme;
  onClick: () => void;
  isOwner?: boolean;
  previewMode?: MemeCardPreviewMode;
}

export function MemeCard({ meme, onClick, previewMode = 'hoverWithSound' }: MemeCardProps) {
  const mediaUrl = getMemeMediaUrl(meme);
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
      onMouseEnter={vm.onMouseEnter}
      onMouseLeave={vm.onMouseLeave}
      onClick={vm.onClick}
      onMouseDown={vm.onMouseDown}
      onTouchStart={vm.onTouchStart}
      onKeyDown={vm.onKeyDown}
    />
  );
}


