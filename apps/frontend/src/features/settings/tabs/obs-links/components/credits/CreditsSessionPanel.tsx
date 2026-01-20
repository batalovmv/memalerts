import { useTranslation } from 'react-i18next';

import type { CreditsSessionState } from '../../hooks/useCreditsSession';

import { Textarea } from '@/shared/ui';

type CreditsSessionPanelProps = {
  creditsSession: CreditsSessionState;
};

export function CreditsSessionPanel({ creditsSession }: CreditsSessionPanelProps) {
  const { t } = useTranslation();
  const {
    creditsChatters,
    loadingCreditsState,
    resettingCredits,
    creditsReconnectWindowMinutes,
    creditsReconnectWindowInput,
    setCreditsReconnectWindowInput,
    savingReconnectWindow,
    creditsIgnoredChatters,
    creditsIgnoredChattersText,
    setCreditsIgnoredChattersText,
    loadingIgnoredChatters,
    savingIgnoredChatters,
    loadCreditsState,
    loadCreditsIgnoredChatters,
    saveCreditsReconnectWindow,
    resetCreditsSession,
    saveCreditsIgnoredChatters,
  } = creditsSession;

  return (
    <details className="glass p-3">
      <summary className="cursor-pointer">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('admin.creditsSessionTitle', { defaultValue: 'Сессия титров' })}
            </div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              {t('admin.creditsSessionHint', {
                defaultValue: 'Списки зрителей/донатеров и настройки сессии. Разворачивается по секциям.',
              })}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {t('admin.creditsViewersTitle', { defaultValue: 'Зрители' })}:{' '}
              <span className="font-mono">{creditsChatters.length}</span>
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {t('admin.creditsIgnoredChattersShort', { defaultValue: 'Игнор' })}:{' '}
              <span className="font-mono">{creditsIgnoredChatters.length}</span>
            </div>
          </div>
        </div>
      </summary>

      <div className="mt-3 space-y-3">
        {/* Viewers (chatters) */}
        <details className="glass p-3">
          <summary className="cursor-pointer">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('admin.creditsViewersTitle', { defaultValue: 'Зрители трансляции' })}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {t('admin.count', { defaultValue: 'count' })}:{' '}
                <span className="font-mono">{creditsChatters.length}</span>
              </div>
            </div>
          </summary>
          <div className="mt-2">
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {t('admin.creditsViewersHint', {
                defaultValue:
                  'Список формируется по сообщениям в чате во время стрима. Аккаунты между платформами склеиваются на бэке; боты MemAlerts игнорируются автоматически.',
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white disabled:opacity-60"
                onClick={() => void loadCreditsState()}
                disabled={loadingCreditsState}
              >
                {loadingCreditsState ? t('common.loading', { defaultValue: 'Loading:' }) : t('common.refresh', { defaultValue: 'Обновить' })}
              </button>
            </div>
            <div className="mt-3 max-h-40 overflow-auto rounded-lg bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-2">
              {creditsChatters.length === 0 ? (
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  {t('admin.creditsNoViewers', {
                    defaultValue: 'Пока пусто. Зрители появятся, когда кто-то напишет в чат во время стрима.',
                  })}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {creditsChatters.map((c, idx) => (
                    <span
                      key={`${String(c?.name || '').toLowerCase()}_${idx}`}
                      className="px-2 py-1 text-xs rounded-md bg-accent/15 text-accent ring-1 ring-accent/20"
                    >
                      {String(c?.name || '').trim()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </details>

        {/* Reconnect window */}
        <details className="glass p-3">
          <summary className="cursor-pointer">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('admin.creditsReconnectWindowTitle', { defaultValue: 'Мёртвая зона (окно переподключения)' })}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                <span className="font-mono">{creditsReconnectWindowMinutes ?? '-'}</span> min
              </div>
            </div>
          </summary>
          <div className="mt-2">
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {t('admin.creditsReconnectWindowHint', {
                defaultValue: 'Сессия зрителей сохраняется X минут после офлайна, чтобы стрим можно было перезапустить без потери списка.',
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                step={1}
                value={creditsReconnectWindowInput}
                onChange={(e) => setCreditsReconnectWindowInput(e.target.value)}
                placeholder={creditsReconnectWindowMinutes === null ? 'min' : String(creditsReconnectWindowMinutes)}
                className="w-32 px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                disabled={savingReconnectWindow}
              />
              <button
                type="button"
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-60"
                onClick={() => void saveCreditsReconnectWindow()}
                disabled={savingReconnectWindow}
              >
                {savingReconnectWindow ? t('common.loading', { defaultValue: 'Loading:' }) : t('common.save', { defaultValue: 'Сохранить' })}
              </button>
            </div>
          </div>
        </details>

        {/* Reset viewers list */}
        <details className="glass p-3">
          <summary className="cursor-pointer">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('admin.creditsResetTitle', { defaultValue: 'Сбросить список зрителей' })}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {t('admin.action', { defaultValue: 'action' })}
              </div>
            </div>
          </summary>
          <div className="mt-2">
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {t('admin.creditsResetHint', {
                defaultValue: 'Начать новую сессию зрителей (новая трансляция  новый список).',
              })}
            </div>
            <div className="mt-3">
              <button
                type="button"
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white disabled:opacity-60"
                onClick={() => void resetCreditsSession()}
                disabled={resettingCredits}
              >
                {resettingCredits ? t('common.loading', { defaultValue: 'Loading:' }) : t('admin.reset', { defaultValue: 'Сбросить' })}
              </button>
            </div>
          </div>
        </details>

        {/* Ignore list */}
        <details className="glass p-3">
          <summary className="cursor-pointer">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('admin.creditsIgnoredChattersTitle', { defaultValue: 'Игнорируемые имена (боты)' })}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {t('admin.count', { defaultValue: 'count' })}:{' '}
                <span className="font-mono">{creditsIgnoredChatters.length}</span>
              </div>
            </div>
          </summary>
          <div className="mt-2">
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {t('admin.creditsIgnoredChattersHint', {
                defaultValue: 'По одному нику на строку. Сравнение без учёта регистра. Авто-боты MemAlerts игнорируются сами.',
              })}
            </div>
            <div className="mt-3 space-y-2">
              <Textarea
                value={creditsIgnoredChattersText}
                onChange={(e) => setCreditsIgnoredChattersText(e.target.value)}
                rows={4}
                className="font-mono text-xs"
                placeholder="nightbot\nstreamelements\n..."
                disabled={loadingIgnoredChatters || savingIgnoredChatters}
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg text-sm font-semibold bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white disabled:opacity-60"
                  onClick={() => void loadCreditsIgnoredChatters()}
                  disabled={loadingIgnoredChatters}
                >
                  {loadingIgnoredChatters ? t('common.loading', { defaultValue: 'Loading:' }) : t('common.refresh', { defaultValue: 'Обновить' })}
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-60"
                  onClick={() => void saveCreditsIgnoredChatters()}
                  disabled={savingIgnoredChatters}
                >
                  {savingIgnoredChatters ? t('common.loading', { defaultValue: 'Loading:' }) : t('common.save', { defaultValue: 'Сохранить' })}
                </button>
              </div>
            </div>
          </div>
        </details>

        {/* Future sections placeholders */}
        <details className="glass p-3 opacity-70">
          <summary className="cursor-pointer">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('admin.creditsFutureSectionsTitle', { defaultValue: 'Ещё секции (в будущем)' })}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {t('subscription.availableOnlyWithSubscription', { defaultValue: 'скоро' })}
              </div>
            </div>
          </summary>
          <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
            {t('admin.creditsFutureSectionsHint', { defaultValue: 'Здесь появятся донатеры, рейдеры и другие списки.' })}
          </div>
        </details>
      </div>
    </details>
  );
}
