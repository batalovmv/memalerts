import { useEffect, useMemo, useState } from 'react';

import type { Meme } from '@/types';

import { getMemeMediaCandidates } from './lib/getMemeMediaUrl';
import { useMemeCard, type MemeCardPreviewMode } from './model/useMemeCard';
import { MemeCardView } from './ui/MemeCardView';

export interface MemeCardProps {
  meme: Meme;
  onClick: () => void;
  isOwner?: boolean;
  previewMode?: MemeCardPreviewMode;
}

export function MemeCard({ meme, onClick, previewMode = 'hoverWithSound' }: MemeCardProps) {
  const mediaCandidates = useMemo(() => getMemeMediaCandidates(meme), [meme]);
  const [mediaIndex, setMediaIndex] = useState(0);
  const initialSrc = mediaCandidates[0] || '';

  useEffect(() => {
    setMediaIndex(0);
  }, [meme.id, initialSrc]);

  const mediaUrl = mediaIndex >= 0 ? mediaCandidates[mediaIndex] || '' : '';
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
      onMediaError={() => {
        setMediaIndex((prev) => {
          if (mediaCandidates.length === 0) return -1;
          const next = prev + 1;
          return next < mediaCandidates.length ? next : -1;
        });
      }}
      onMouseEnter={vm.onMouseEnter}
      onMouseLeave={vm.onMouseLeave}
      onClick={vm.onClick}
      onMouseDown={vm.onMouseDown}
      onTouchStart={vm.onTouchStart}
      onKeyDown={vm.onKeyDown}
    />
  );
}
