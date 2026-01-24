import { useTranslation } from 'react-i18next';

import { AiRegenerateButton } from '../AiRegenerateButton';

import type { Meme } from '@/types';
import type { FormEvent } from 'react';

import { Button, HelpTooltip, Input, Pill, Spinner } from '@/shared/ui';

type MemeModalInfoProps = {
  meme: Meme;
  mode: 'admin' | 'viewer';
  isOwner: boolean;
  isEditing: boolean;
  loading: boolean;
  title: string;
  priceCoins: number;
  onTitleChange: (value: string) => void;
  onPriceChange: (value: number) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (event: FormEvent) => void;
  onDelete: () => void;
  onClose: () => void;
  creatorName: string;
  source: string;
  statusLabel: string | null;
  manualTagNames: string[];
  aiTagNames: string[];
  canTagSearch: boolean;
  onTagSearch?: (tag: string) => void;
  canViewAi: boolean;
  canRegenerateAi: boolean;
  hasAiFields: boolean;
  hasAi: boolean;
  hasAiDesc: boolean;
  aiTags: string[];
  aiDesc: string;
  isAiProcessing: boolean;
  canActivate: boolean;
  isGuestViewer: boolean;
  walletBalance?: number;
  onActivate: () => void;
};

export function MemeModalInfo({
  meme,
  mode,
  isOwner,
  isEditing,
  loading,
  title,
  priceCoins,
  onTitleChange,
  onPriceChange,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  onClose,
  creatorName,
  source,
  statusLabel,
  manualTagNames,
  aiTagNames,
  canTagSearch,
  onTagSearch,
  canViewAi,
  canRegenerateAi,
  hasAiFields,
  hasAi,
  hasAiDesc,
  aiTags,
  aiDesc,
  isAiProcessing,
  canActivate,
  isGuestViewer,
  walletBalance,
  onActivate,
}: MemeModalInfoProps) {
  const { t } = useTranslation();

  return (
    <aside
      className="w-full md:w-80 border-t md:border-t-0 border-black/5 dark:border-white/10 bg-gray-50 dark:bg-gray-900 overflow-y-auto relative"
      aria-label="Meme information"
    >
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        {mode === 'admin' && isOwner && (
          <div className="flex gap-2">
            <HelpTooltip
              content={
                isEditing
                  ? t('help.memeModal.cancelEdit', { defaultValue: 'Stop editing without saving.' })
                  : t('help.memeModal.edit', { defaultValue: 'Edit meme details (title, price, etc.).' })
              }
            >
              <button
                type="button"
                onClick={isEditing ? onCancel : onEdit}
                className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors group"
                aria-label={isEditing ? t('common.cancel', { defaultValue: 'Cancel' }) : t('common.edit', { defaultValue: 'Edit' })}
                disabled={loading}
              >
                <svg
                  className={`w-5 h-5 ${
                    isEditing
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-gray-600 dark:text-gray-400 group-hover:text-primary'
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  {isEditing ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  )}
                </svg>
              </button>
            </HelpTooltip>
            {!isEditing && (
              <HelpTooltip content={t('help.memeModal.delete', { defaultValue: 'Delete this meme.' })}>
                <button
                  type="button"
                  onClick={onDelete}
                  className="p-2 hover:bg-red-100 dark:hover:bg-red-900 rounded-full transition-colors group"
                  aria-label={t('common.delete', { defaultValue: 'Delete' })}
                  disabled={loading}
                >
                  <svg
                    className="w-5 h-5 text-gray-600 dark:text-gray-400 group-hover:text-red-600 dark:group-hover:text-red-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </HelpTooltip>
            )}
          </div>
        )}
        <HelpTooltip content={t('help.memeModal.close', { defaultValue: 'Close.' })}>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </HelpTooltip>
      </div>

      <div className="p-5 md:p-6 space-y-5 md:space-y-6 pt-16">
        <div>
          {isEditing && mode === 'admin' ? (
            <Input
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              className="text-2xl font-bold px-3 py-2"
              disabled={!isEditing}
            />
          ) : (
            <h2 id="meme-modal-title" className="text-2xl font-bold dark:text-white flex flex-wrap items-center gap-3">
              <span>{meme.title}</span>
              {canViewAi && isAiProcessing ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-black/5 dark:bg-white/10 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                  <Spinner className="h-3 w-3" />
                  {t('submissions.aiProcessing', { defaultValue: 'AI: processing…' })}
                </span>
              ) : null}
            </h2>
          )}
        </div>

        {(manualTagNames.length > 0 || aiTagNames.length > 0) && (
          <div>
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {t('memeModal.tags', { defaultValue: 'Tags' })}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {manualTagNames.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onTagSearch?.(tag)}
                  disabled={!canTagSearch}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-colors ${
                    canTagSearch
                      ? 'bg-white/70 text-gray-800 ring-black/5 hover:bg-white dark:bg-white/10 dark:text-gray-100 dark:ring-white/10 dark:hover:bg-white/20'
                      : 'bg-white/60 text-gray-500 ring-black/5 dark:bg-white/5 dark:text-gray-400 dark:ring-white/10'
                  }`}
                  aria-disabled={!canTagSearch}
                  aria-label={t('memeModal.searchByTag', { defaultValue: 'Search by tag {{tag}}', tag })}
                >
                  #{tag}
                </button>
              ))}
              {aiTagNames.map((tag) => (
                <button
                  key={`ai-${tag}`}
                  type="button"
                  onClick={() => onTagSearch?.(tag)}
                  disabled={!canTagSearch}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-colors ${
                    canTagSearch
                      ? 'bg-white/70 text-gray-800 ring-black/5 hover:bg-white dark:bg-white/10 dark:text-gray-100 dark:ring-white/10 dark:hover:bg-white/20'
                      : 'bg-white/60 text-gray-500 ring-black/5 dark:bg-white/5 dark:text-gray-400 dark:ring-white/10'
                  }`}
                  aria-disabled={!canTagSearch}
                  aria-label={t('memeModal.searchByTag', { defaultValue: 'Search by tag {{tag}}', tag })}
                >
                  <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-700 dark:bg-white/15 dark:text-gray-100">
                    AI
                  </span>
                  #{tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {canViewAi && (hasAi || hasAiFields) ? (
          <section className="rounded-xl bg-black/5 dark:bg-white/5 p-4" aria-label="AI">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-bold text-gray-900 dark:text-white">AI</div>
              {aiTags.length > 0 ? (
                <Pill variant="neutral" size="sm">
                  AI tags: {aiTags.length}
                </Pill>
              ) : null}
            </div>

            <div className="mt-2">
              <AiRegenerateButton meme={meme} show={canRegenerateAi} />
            </div>

            {!hasAi ? (
              <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                {t('memeModal.aiPending', { defaultValue: 'AI: данных пока нет (ещё в обработке или не записалось).' })}
              </div>
            ) : null}

            {hasAiDesc ? (
              <div className="mt-3">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">AI description</div>
                <div className="mt-1 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{aiDesc}</div>
              </div>
            ) : null}

            {aiTags.length > 0 ? (
              <div className="mt-3">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">AI tags</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {aiTags.slice(0, 30).map((tag) => (
                    <Pill key={tag} variant="primary" size="sm">
                      {tag}
                    </Pill>
                  ))}
                  {aiTags.length > 30 ? (
                    <Pill variant="neutral" size="sm">
                      +{aiTags.length - 30}
                    </Pill>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {isEditing && mode === 'admin' ? (
          <form onSubmit={onSave} className="space-y-4" aria-label="Edit meme form">
            <div>
              <label htmlFor="meme-price" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('memeModal.priceCoins', { defaultValue: 'Price (coins)' })}
              </label>
              <Input
                id="meme-price"
                type="number"
                value={priceCoins}
                onChange={(e) => onPriceChange(Number.parseInt(e.target.value, 10) || 0)}
                min="1"
                required
                aria-required="true"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" variant="primary" className="flex-1" disabled={loading}>
                {loading ? t('common.loading', { defaultValue: 'Loading…' }) : t('common.save', { defaultValue: 'Save' })}
              </Button>
              <Button type="button" variant="secondary" className="flex-1" onClick={onCancel} disabled={loading}>
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                  {t('memeModal.price', { defaultValue: 'Price' })}
                </div>
                <div className="text-lg font-semibold text-accent">
                  {t('memeModal.priceValue', { defaultValue: '{{price}} coins', price: meme.priceCoins })}
                </div>
              </div>
              {mode === 'admin' && (
                <>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                      {t('memeModal.createdBy', { defaultValue: 'Created by' })}
                    </div>
                    <div className="text-base text-gray-900 dark:text-white">{creatorName}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                      {t('memeModal.source', { defaultValue: 'Source' })}
                    </div>
                    <div className="text-base text-gray-900 dark:text-white capitalize">
                      {source === 'imported'
                        ? t('memeModal.sourceImported', { defaultValue: 'imported' })
                        : source === 'uploaded'
                          ? t('memeModal.sourceUploaded', { defaultValue: 'uploaded' })
                          : source}
                    </div>
                  </div>
                  {statusLabel && (
                    <div>
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                        {t('memeModal.status', { defaultValue: 'Status' })}
                      </div>
                      <div className="text-base text-gray-900 dark:text-white capitalize">{statusLabel}</div>
                    </div>
                  )}
                  {meme.createdAt && (
                    <div>
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                        {t('memeModal.createdAt', { defaultValue: 'Created' })}
                      </div>
                      <div className="text-base text-gray-900 dark:text-white">
                        {new Date(meme.createdAt).toLocaleString()}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {mode === 'viewer' && (
              <div className="pt-4 border-t border-black/5 dark:border-white/10">
                <Button type="button" onClick={onActivate} disabled={!canActivate && !isGuestViewer} variant="primary" className="w-full">
                  {isGuestViewer
                    ? t('auth.loginToUse', { defaultValue: 'Log in to use' })
                    : walletBalance === undefined
                      ? t('common.loading', { defaultValue: 'Loading…' })
                      : walletBalance < (meme.priceCoins || 0)
                        ? t('memeModal.insufficientCoins', {
                            defaultValue: 'Insufficient coins (need {{price}})',
                            price: meme.priceCoins,
                          })
                        : t('dashboard.activate', { defaultValue: 'Activate' })}
                </Button>
                {walletBalance !== undefined && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
                    {t('memeModal.yourBalance', { defaultValue: 'Your balance: {{balance}} coins', balance: walletBalance })}
                  </p>
                )}
              </div>
            )}

            {mode === 'admin' && isOwner && !isEditing && (
              <div className="pt-4 border-t border-black/5 dark:border-white/10">
                <Button type="button" variant="danger" className="w-full" onClick={onDelete} disabled={loading}>
                  {loading ? t('common.loading', { defaultValue: 'Loading…' }) : t('memeModal.deleteMeme', { defaultValue: 'Delete Meme' })}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
