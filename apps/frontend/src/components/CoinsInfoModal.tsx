import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface CoinsInfoModalProps {
  rewardTitle?: string | null;
}

export default function CoinsInfoModal({ rewardTitle }: CoinsInfoModalProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Check if user has already seen this modal
    const hasSeen = localStorage.getItem('coinsInfoSeen');
    if (!hasSeen) {
      setIsOpen(true);
    }
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    // Mark as seen in localStorage
    localStorage.setItem('coinsInfoSeen', 'true');
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 modal-backdrop-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="glass rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4 relative modal-pop-in" onMouseDown={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          aria-label={t('coinsInfoModal.close', 'Close')}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Content */}
        <h2 className="text-2xl font-bold mb-4 dark:text-white">
          {t('coinsInfoModal.title', 'How to get coins')}
        </h2>
        
        <div className="space-y-3 text-gray-700 dark:text-gray-300">
          <p>
            {rewardTitle
              ? t('coinsInfoModal.descriptionWithReward', `Activate the reward "${rewardTitle}" on the streamer's Twitch channel to get coins.`, { rewardTitle })
              : t('coinsInfoModal.description', 'Activate the reward on the streamer\'s Twitch channel to get coins.')
            }
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('coinsInfoModal.afterActivation', 'After activation, coins will appear in your balance.')}
          </p>
        </div>

        {/* Close button at bottom */}
        <button
          onClick={handleClose}
          className="mt-6 w-full bg-primary hover:bg-secondary text-white font-semibold py-2 px-4 rounded-lg transition-colors"
        >
          {t('coinsInfoModal.gotIt', 'Got it')}
        </button>
      </div>
    </div>
  );
}

