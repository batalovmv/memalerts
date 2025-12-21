import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface AuthRequiredModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  ctaLabel?: string;
  onCtaClick: () => void;
}

export default function AuthRequiredModal({
  isOpen,
  onClose,
  title,
  description,
  ctaLabel,
  onCtaClick,
}: AuthRequiredModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 pb-safe bg-black/50 modal-backdrop-in"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || t('auth.modal.title', { defaultValue: 'Login required' })}
        className="glass w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-4 shadow-2xl modal-pop-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-gray-900 dark:text-white">
              {title || t('auth.modal.title', { defaultValue: 'Login required' })}
            </div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {description || t('auth.modal.description', { defaultValue: 'Log in with Twitch to use this feature.' })}
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10"
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="flex-1 glass-btn px-4 py-2 text-sm font-semibold text-gray-900 dark:text-white"
            onClick={onCtaClick}
          >
            {ctaLabel || t('auth.login', { defaultValue: 'Log in with Twitch' })}
          </button>
        </div>
      </div>
    </div>
  );
}


