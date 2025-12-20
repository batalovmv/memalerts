import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

type Props = {
  label: string;
  value: string;
  description?: string;
  masked?: boolean;
  emptyText?: string;
  rightActions?: React.ReactNode;
};

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13.875 18.825A10.05 10.05 0 0112 19c-5.523 0-10-4.477-10-10 0-1.02.153-2.004.437-2.93M6.227 6.227A9.97 9.97 0 0112 5c5.523 0 10 4.477 10 10 0 2.21-.716 4.253-1.93 5.91M15 12a3 3 0 11-6 0 3 3 0 016 0zM3 3l18 18"
      />
    </svg>
  ) : (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

export default function SecretCopyField({ label, value, description, masked = true, emptyText = '—', rightActions }: Props) {
  const [isRevealed, setIsRevealed] = useState(false);
  const { t } = useTranslation();

  const displayValue = useMemo(() => {
    const v = (value || '').trim();
    if (!v) return emptyText;
    if (!masked) return v;
    if (isRevealed) return v;
    // Mask the value, but include a small suffix of the *secret token* (not query params)
    // so the user can confirm it changed after rotation without leaking the whole URL.
    try {
      const marker = '/overlay/t/';
      const idx = v.indexOf(marker);
      if (idx !== -1) {
        const after = v.slice(idx + marker.length);
        const token = after.split('?')[0] || '';
        const suffix = token.length > 8 ? token.slice(-8) : token;
        return `****************${suffix}`;
      }
    } catch {
      // ignore and fall back
    }
    return '****************';
  }, [value, masked, isRevealed, emptyText]);

  const canCopy = (value || '').trim().length > 0;

  const copy = async () => {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('toast.linkCopied', { defaultValue: 'Copied' }));
    } catch {
      toast.error(t('toast.failedToCopyLink', { defaultValue: 'Failed to copy' }));
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      <div
        className={`flex items-center gap-2 rounded-lg border border-secondary/20 bg-gray-50 dark:bg-gray-700 px-3 py-2 ${
          canCopy ? 'cursor-pointer hover:border-secondary/40' : 'cursor-not-allowed opacity-70'
        }`}
        role="button"
        tabIndex={canCopy ? 0 : -1}
        onClick={() => void copy()}
        onKeyDown={(e) => {
          if (!canCopy) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void copy();
          }
        }}
        title={canCopy ? t('common.clickToCopy', { defaultValue: 'Click to copy' }) : undefined}
      >
        <div className="flex-1 min-w-0">
          <div className="font-mono text-sm text-gray-900 dark:text-gray-100 truncate">{displayValue}</div>
        </div>

        {rightActions}

        {masked && (
          <button
            type="button"
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-gray-700 dark:text-gray-200"
            onClick={(e) => {
              e.stopPropagation();
              setIsRevealed((v) => !v);
            }}
            title={isRevealed ? 'Hide' : 'Show'}
            aria-label={isRevealed ? 'Hide value' : 'Show value'}
          >
            <EyeIcon open={isRevealed} />
          </button>
        )}

        <button
          type="button"
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-gray-700 dark:text-gray-200"
          onClick={(e) => {
            e.stopPropagation();
            void copy();
          }}
          title={t('common.copy', { defaultValue: 'Copy' })}
          aria-label={t('common.copy', { defaultValue: 'Copy' })}
          disabled={!canCopy}
        >
          <CopyIcon />
        </button>
      </div>

      {description && <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>}
    </div>
  );
}


