import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/store/hooks';
import { getUserPreferences, patchUserPreferences } from '@/shared/lib/userPreferences';

import { Modal } from '@/shared/ui/Modal/Modal';

interface CoinsInfoModalProps {
  rewardTitle?: string | null;
}

export default function CoinsInfoModal({ rewardTitle }: CoinsInfoModalProps) {
  const { t } = useTranslation();
  const { user } = useAppSelector((s) => s.auth);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Logged in: backend-first.
      if (user) {
        const prefs = await getUserPreferences();
        if (cancelled) return;
        const seen = !!prefs?.coinsInfoSeen;
        if (!seen) setIsOpen(true);
        return;
      }

      // Guest: localStorage fallback.
      try {
        const hasSeen = localStorage.getItem('coinsInfoSeen');
        if (!hasSeen) setIsOpen(true);
      } catch {
        setIsOpen(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleClose = () => {
    setIsOpen(false);
    // Persist (backend-first; local fallback for guests).
    if (user) {
      void patchUserPreferences({ coinsInfoSeen: true });
      return;
    }
    try {
      localStorage.setItem('coinsInfoSeen', 'true');
    } catch {
      // ignore
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      ariaLabel={t('coinsInfoModal.title', 'How to get coins')}
      contentClassName="max-w-md relative p-4 sm:p-6 max-h-[85vh] overflow-y-auto"
    >
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
      <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4 dark:text-white">
        {t('coinsInfoModal.title', 'How to get coins')}
      </h2>

      <div className="space-y-3 text-gray-700 dark:text-gray-300">
        <p>
          {rewardTitle
            ? t(
                'coinsInfoModal.descriptionWithReward',
                `Activate the reward "${rewardTitle}" on the streamer's Twitch channel to get coins.`,
                { rewardTitle },
              )
            : t('coinsInfoModal.description', "Activate the reward on the streamer's Twitch channel to get coins.")}
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('coinsInfoModal.afterActivation', 'After activation, coins will appear in your balance.')}
        </p>
      </div>

      {/* Close button at bottom */}
      <button
        onClick={handleClose}
        className="mt-5 sm:mt-6 w-full bg-primary hover:bg-secondary text-white font-semibold py-3 sm:py-2.5 px-4 rounded-xl transition-colors"
      >
        {t('coinsInfoModal.gotIt', 'Got it')}
      </button>
    </Modal>
  );
}


