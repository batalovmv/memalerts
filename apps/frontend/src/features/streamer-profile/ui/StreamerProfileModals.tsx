import type { Meme } from '@/types';

import AuthRequiredModal from '@/components/AuthRequiredModal';
import CoinsInfoModal from '@/components/CoinsInfoModal';
import MemeModal from '@/components/MemeModal';
import SubmitModal from '@/components/SubmitModal';

type StreamerProfileModalsProps = {
  selectedMeme: Meme | null;
  isMemeModalOpen: boolean;
  onCloseMemeModal: () => void;
  onTagSearch: (tag: string) => void;
  onMemeUpdate: () => void;
  onActivate: (memeId: string) => void | Promise<void>;
  isOwner: boolean;
  walletBalance?: number;
  isSubmitModalOpen: boolean;
  onCloseSubmitModal: () => void;
  channelSlug?: string | null;
  channelId?: string | null;
  submissionBlocked: boolean;
  showCoinsInfo: boolean;
  rewardTitle?: string | null;
  authModalOpen: boolean;
  onCloseAuthModal: () => void;
  onAuthCta: () => void;
};

export function StreamerProfileModals({
  selectedMeme,
  isMemeModalOpen,
  onCloseMemeModal,
  onTagSearch,
  onMemeUpdate,
  onActivate,
  isOwner,
  walletBalance,
  isSubmitModalOpen,
  onCloseSubmitModal,
  channelSlug,
  channelId,
  submissionBlocked,
  showCoinsInfo,
  rewardTitle,
  authModalOpen,
  onCloseAuthModal,
  onAuthCta,
}: StreamerProfileModalsProps) {
  return (
    <>
      {isMemeModalOpen && selectedMeme && (
        <MemeModal
          meme={selectedMeme}
          isOpen={isMemeModalOpen}
          onClose={onCloseMemeModal}
          onTagSearch={onTagSearch}
          onUpdate={onMemeUpdate}
          isOwner={isOwner}
          mode="viewer"
          onActivate={(memeId) => Promise.resolve(onActivate(memeId))}
          walletBalance={walletBalance}
        />
      )}

      <SubmitModal
        isOpen={isSubmitModalOpen}
        onClose={onCloseSubmitModal}
        channelSlug={channelSlug ?? undefined}
        channelId={channelId ?? undefined}
        initialBlockedReason={submissionBlocked ? 'disabled' : null}
      />

      {showCoinsInfo && <CoinsInfoModal rewardTitle={rewardTitle || null} />}

      <AuthRequiredModal
        isOpen={authModalOpen}
        onClose={onCloseAuthModal}
        onCtaClick={onAuthCta}
      />
    </>
  );
}
