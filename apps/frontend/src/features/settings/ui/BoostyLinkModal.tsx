import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { api } from '@/lib/api';
import { toApiError } from '@/shared/api/toApiError';
import { Button, Input, Modal, Spinner } from '@/shared/ui';

type BoostyLinkModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onLinked?: () => void | Promise<void>;
};

function normalizeToken(raw: string): { token: string; hasInnerSpaces: boolean } {
  // Important: do NOT delete all whitespace implicitly; only trim and remove \r\n\t.
  const token = raw.trim().replace(/[\r\n\t]/g, '');
  return { token, hasInnerSpaces: token.includes(' ') };
}

function mapBoostyLinkError(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'BOOSTY_LINK_MISSING_CREDENTIALS':
      return 'Вставьте токен.';
    case 'BOOSTY_INVALID_TOKEN':
      return 'Токен не подходит. Проверьте, что скопировали полностью.';
    case 'BOOSTY_ACCOUNT_ALREADY_LINKED':
      return 'Этот Boosty-аккаунт уже подключён к другому профилю.';
    case 'BOOSTY_RATE_LIMITED':
      return 'Слишком много попыток. Подождите минуту и попробуйте снова.';
    case 'BOOSTY_UNAVAILABLE':
      return 'Boosty временно недоступен. Попробуйте позже.';
    case 'VALIDATION_ERROR':
      // Backend may use generic validation errors; for the viewer this usually means "bad token".
      return 'Токен не подходит. Проверьте, что скопировали полностью.';
    default:
      return fallback;
  }
}

export function BoostyLinkModal({ isOpen, onClose, onLinked }: BoostyLinkModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [accessToken, setAccessToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [spaceWarning, setSpaceWarning] = useState<string | null>(null);

  const normalized = useMemo(() => normalizeToken(accessToken), [accessToken]);

  useEffect(() => {
    if (!isOpen) return;
    setBusy(false);
    setSpaceWarning(null);
    setShowHelp(false);
    setShowToken(false);
    // focus is handled by Modal; just ensure ref exists for optional actions
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (normalized.hasInnerSpaces) {
      setSpaceWarning('Похоже, в токене есть пробелы. Обычно их быть не должно. Уберите их и попробуйте снова.');
    } else {
      setSpaceWarning(null);
    }
  }, [isOpen, normalized.hasInnerSpaces]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const txt = await navigator.clipboard.readText();
      setAccessToken(txt ?? '');
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } catch {
      toast.error(t('toast.failedToPaste', { defaultValue: 'Не удалось прочитать буфер обмена.' }));
    }
  }, [t]);

  const removeAllWhitespace = useCallback(() => {
    setAccessToken((prev) => prev.replace(/\s+/g, ''));
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const submit = useCallback(async () => {
    if (busy) return;

    const { token, hasInnerSpaces } = normalizeToken(accessToken);
    if (!token) {
      toast.error('Вставьте токен.');
      return;
    }
    if (hasInnerSpaces) {
      // UX: warn, but don't block submit (user may know what they're doing).
      setSpaceWarning('Похоже, в токене есть пробелы. Обычно их быть не должно. Уберите их и попробуйте снова.');
    }

    try {
      setBusy(true);
      await api.post('/auth/boosty/link', { accessToken: token, token });
      toast.success('Boosty подключён. Мы проверим подписку при следующей синхронизации.');
      await onLinked?.();
      onClose();
    } catch (e) {
      const err = toApiError(e, t('admin.failedToSave', { defaultValue: 'Failed.' }));
      const rawFallback = (err.error || err.message || '').trim();
      const msg = mapBoostyLinkError(err.errorCode, rawFallback);
      toast.error(msg && msg.trim() ? msg : 'Не удалось подключить Boosty.');
    } finally {
      setBusy(false);
    }
  }, [accessToken, busy, onClose, onLinked, t]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      ariaLabelledBy={titleId}
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
      overlayClassName="overflow-y-auto"
      contentClassName="max-w-lg relative p-4 sm:p-6 max-h-[90vh] overflow-y-auto"
    >
      <button
        onClick={() => {
          if (busy) return;
          onClose();
        }}
        className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        aria-label={t('common.close', { defaultValue: 'Close' })}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <h2 id={titleId} className="text-xl sm:text-2xl font-bold mb-1 sm:mb-2 dark:text-white">
        {t('settings.boostyLinkTitle', { defaultValue: 'Подключить Boosty' })}
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
        {t('settings.boostyLinkSubtitle', {
          defaultValue: 'Нужно один раз, чтобы автоматически определять вашу подписку и уровень.',
        })}
      </p>

      <div className="space-y-4">
        <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
          <div className="font-semibold text-gray-900 dark:text-white mb-2">
            {t('settings.boostyLinkBlockA', { defaultValue: 'Открыть Boosty' })}
          </div>
          <div className="flex items-center gap-2">
            <a
              className="inline-flex"
              href="https://boosty.to/"
              target="_blank"
              rel="noreferrer"
              onClick={() => {
                // keep focus in modal after open
                window.requestAnimationFrame(() => inputRef.current?.focus());
              }}
            >
              <Button type="button" variant="secondary">
                {t('settings.boostyLinkOpenBoosty', { defaultValue: 'Открыть Boosty' })}
              </Button>
            </a>
          </div>
          <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
            {t('settings.boostyLinkOpenBoostyHint', { defaultValue: 'Если вы не вошли — войдите в Boosty в новой вкладке.' })}
          </div>
        </div>

        <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('settings.boostyLinkBlockB', { defaultValue: 'Где взять токен' })}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowHelp((v) => !v)} disabled={busy}>
              {t('settings.boostyLinkHelpToggle', { defaultValue: 'Где найти токен?' })}
            </Button>
          </div>
          {showHelp ? (
            <ol className="mt-3 text-sm text-gray-700 dark:text-gray-300 list-decimal pl-5 space-y-1">
              <li>{t('settings.boostyLinkHelpStep1', { defaultValue: 'Откройте настройки Boosty.' })}</li>
              <li>{t('settings.boostyLinkHelpStep2', { defaultValue: 'Найдите Access Token.' })}</li>
              <li>{t('settings.boostyLinkHelpStep3', { defaultValue: 'Скопируйте и вставьте его ниже.' })}</li>
            </ol>
          ) : null}
        </div>

        <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
          <div className="font-semibold text-gray-900 dark:text-white mb-2">
            {t('settings.boostyLinkBlockC', { defaultValue: 'Вставить и проверить' })}
          </div>

          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              type={showToken ? 'text' : 'password'}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={t('settings.boostyAccessTokenPlaceholder', { defaultValue: 'Access Token' })}
              autoComplete="off"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={() => setShowToken((v) => !v)} disabled={busy}>
              {showToken ? t('common.hide', { defaultValue: 'Скрыть' }) : t('common.show', { defaultValue: 'Показать' })}
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => void pasteFromClipboard()} disabled={busy}>
              {t('settings.pasteFromClipboard', { defaultValue: 'Вставить из буфера' })}
            </Button>
            {normalized.hasInnerSpaces ? (
              <Button type="button" variant="secondary" size="sm" onClick={removeAllWhitespace} disabled={busy}>
                {t('settings.boostyRemoveSpaces', { defaultValue: 'Убрать пробелы' })}
              </Button>
            ) : null}
          </div>

          {spaceWarning ? <div className="mt-2 text-sm text-amber-800 dark:text-amber-200">{spaceWarning}</div> : null}

          <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
            {t('settings.boostyPrivacy', {
              defaultValue: 'Мы не публикуем токен. Его можно отключить в любой момент.',
            })}
          </div>

          <div className="mt-4">
            <Button type="button" variant="primary" onClick={() => void submit()} disabled={busy}>
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner className="h-4 w-4 border-[2px]" />
                  {t('common.loading', { defaultValue: 'Loading…' })}
                </span>
              ) : (
                t('settings.boostyLinkSubmit', { defaultValue: 'Проверить и подключить' })
              )}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}


