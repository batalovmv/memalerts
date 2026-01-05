import { getMemeMediaUrl } from './lib/getMemeMediaUrl';
import { useMemeCard, type MemeCardPreviewMode } from './model/useMemeCard';
import { MemeCardView } from './ui/MemeCardView';

import type { Meme } from '@/types';

export interface MemeCardProps {
  meme: Meme;
  onClick: () => void;
  isOwner?: boolean;
  previewMode?: MemeCardPreviewMode;
  /**
   * Show expandable AI analysis (description + AI tags) inside the card.
   * Keep disabled by default to avoid changing public/pool layouts.
   */
  showAiAnalysis?: boolean;
}

export function MemeCard({ meme, onClick, previewMode = 'hoverWithSound', showAiAnalysis }: MemeCardProps) {
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
      showAiAnalysis={showAiAnalysis}
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


