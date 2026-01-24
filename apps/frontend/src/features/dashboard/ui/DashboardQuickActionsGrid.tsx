import { useTranslation } from 'react-i18next';

import type { DashboardCardId, ExpandCard } from '@/features/dashboard/types';

import { CardHelpHint } from '@/features/dashboard/ui/CardHelpHint';
import { Pill, Tooltip } from '@/shared/ui';

type DashboardQuickActionsGridProps = {
  cardOrder: DashboardCardId[];
  expandedCard: ExpandCard;
  helpEnabled: boolean;
  isMemesOpen: boolean;
  isStreamerAdmin: boolean;
  memesCountText: string;
  pendingSubmissionsCount: number;
  submissionsEnabled: boolean | null;
  anyBotEnabled: boolean;
  onOpenSubmit: () => void;
  onOpenMySubmissions: () => void;
  onToggleMemes: () => void;
  onOpenSettings: () => void;
  onToggleSubmissionsControl: () => void;
  onToggleBots: () => void;
};

function ChevronRightIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function DashboardQuickActionsGrid({
  cardOrder,
  expandedCard,
  helpEnabled,
  isMemesOpen,
  isStreamerAdmin,
  memesCountText,
  pendingSubmissionsCount,
  submissionsEnabled,
  anyBotEnabled,
  onOpenSubmit,
  onOpenMySubmissions,
  onToggleMemes,
  onOpenSettings,
  onToggleSubmissionsControl,
  onToggleBots,
}: DashboardQuickActionsGridProps) {
  const { t } = useTranslation();
  const baseCardCls =
    'surface surface-hover p-6 flex flex-col min-h-[210px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-2xl';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {cardOrder.map((cardId) => {
        if (cardId === 'submit') {
          return (
            <div
              key={cardId}
              className={baseCardCls}
              role="button"
              tabIndex={0}
              onClick={onOpenSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenSubmit();
                }
              }}
              aria-label={t('dashboard.quickActions.submitMemeButton', 'Submit Meme')}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold mb-2 dark:text-white">
                  {t('dashboard.quickActions.submitMeme', 'Submit Meme')}
                </h2>
                <div className="flex items-start gap-2">
                  <CardHelpHint
                    enabled={helpEnabled}
                    text={t('dashboard.help.cards.submit', {
                      defaultValue: 'Add a new meme to your channel (upload or import).',
                    })}
                  />
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                {t('dashboard.quickActions.submitMemeDescription', 'Add a meme directly to your pool')}
              </p>
              <div className="mt-auto flex items-center justify-between text-primary font-semibold">
                <span>{t('dashboard.quickActions.submitMemeButton', 'Submit Meme')}</span>
                <ChevronRightIcon />
              </div>
            </div>
          );
        }

        if (cardId === 'mySubmissions') {
          return (
            <div
              key={cardId}
              className={baseCardCls}
              role="button"
              tabIndex={0}
              onClick={onOpenMySubmissions}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenMySubmissions();
                }
              }}
              aria-label={t('dashboard.quickActions.mySubmissions', { defaultValue: 'My submissions' })}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="text-lg font-semibold dark:text-white truncate">
                    {t('dashboard.quickActions.mySubmissions', { defaultValue: 'My submissions' })}
                  </h2>
                  {pendingSubmissionsCount > 0 && (
                    helpEnabled ? (
                      <Tooltip
                        delayMs={1000}
                        content={t('dashboard.help.pendingCount', { defaultValue: 'How many submissions are waiting for approval.' })}
                      >
                        <Pill variant="danger" size="md">
                          {pendingSubmissionsCount}
                        </Pill>
                      </Tooltip>
                    ) : (
                      <Pill variant="danger" size="md">
                        {pendingSubmissionsCount}
                      </Pill>
                    )
                  )}
                </div>
                <div className="flex items-start gap-2">
                  <CardHelpHint
                    enabled={helpEnabled}
                    text={t('dashboard.help.cards.mySubmissions', {
                      defaultValue: 'Open your submission list and see what needs your action.',
                    })}
                  />
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                {t('dashboard.quickActions.mySubmissionsDescription', {
                  defaultValue: 'Track the submissions you sent to other channels',
                })}
              </p>
              <div className="mt-auto flex items-center justify-between text-primary font-semibold">
                <span>{t('dashboard.quickActions.mySubmissionsButton', { defaultValue: 'Open' })}</span>
                <ChevronRightIcon />
              </div>
            </div>
          );
        }

        if (cardId === 'memes') {
          return (
            <div
              key={cardId}
              className={baseCardCls}
              role="button"
              tabIndex={0}
              onClick={onToggleMemes}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggleMemes();
                }
              }}
              aria-label={t('dashboard.quickActions.allMemes', { defaultValue: 'All memes' })}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center justify-between w-full gap-3">
                  <h2 className="text-lg font-semibold dark:text-white">
                    {t('dashboard.quickActions.allMemes', { defaultValue: 'All memes' })}
                  </h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{memesCountText}</span>
                </div>
                <div className="flex items-start gap-2">
                  <CardHelpHint
                    enabled={helpEnabled}
                    text={t('dashboard.help.cards.allMemes', {
                      defaultValue: 'Browse your meme library and edit existing memes.',
                    })}
                  />
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                {t('dashboard.quickActions.allMemesDescription', { defaultValue: 'Browse and edit your meme library' })}
              </p>
              <div className="mt-auto flex items-center justify-between text-primary font-semibold">
                <span>
                  {isMemesOpen
                    ? t('common.close', { defaultValue: 'Close' })
                    : t('dashboard.quickActions.openAllMemes', { defaultValue: 'Open' })}
                </span>
                <ChevronRightIcon />
              </div>
            </div>
          );
        }

        if (cardId === 'settings') {
          return (
            <div
              key={cardId}
              className={baseCardCls}
              role="button"
              tabIndex={0}
              onClick={onOpenSettings}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenSettings();
                }
              }}
              aria-label={t('dashboard.quickActions.settingsButton', 'Open Settings')}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold mb-2 dark:text-white">
                  {t('dashboard.quickActions.settings', 'Settings')}
                </h2>
                <div className="flex items-start gap-2">
                  <CardHelpHint
                    enabled={helpEnabled}
                    text={t('dashboard.help.cards.settings', {
                      defaultValue: 'Open channel settings: rewards, bots, OBS links, and more.',
                    })}
                  />
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                {t('dashboard.quickActions.settingsDescription', 'Configure your channel and preferences')}
              </p>
              <div className="mt-auto flex items-center justify-between text-primary font-semibold">
                <span>{t('dashboard.quickActions.settingsButton', 'Open Settings')}</span>
                <ChevronRightIcon />
              </div>
            </div>
          );
        }

        if (cardId === 'submissionsControl' && isStreamerAdmin) {
          return (
            <div
              key={cardId}
              className={baseCardCls}
              role="button"
              tabIndex={0}
              aria-expanded={expandedCard === 'submissionsControl'}
              onClick={onToggleSubmissionsControl}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggleSubmissionsControl();
                }
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold dark:text-white">
                    {t('dashboard.submissionsControl.title', { defaultValue: 'Отправка мемов' })}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    {t('dashboard.submissionsControl.subtitle', {
                      defaultValue: 'Быстро включайте/выключайте отправку и генерируйте ссылки для StreamerBot.',
                    })}
                  </p>
                </div>
                <div className="flex items-start gap-2 shrink-0">
                  <CardHelpHint
                    enabled={helpEnabled}
                    text={t('dashboard.help.cards.submissionsControl', {
                      defaultValue: 'Control whether viewers can submit memes, and generate automation links.',
                    })}
                  />
                  <Pill variant={submissionsEnabled === false ? 'dangerSolid' : 'successSolid'} size="sm">
                    {t('dashboard.submissionsControl.statusSubmits', { defaultValue: 'Submits' })}:{' '}
                    {submissionsEnabled === false ? t('common.off', { defaultValue: 'Off' }) : t('common.on', { defaultValue: 'On' })}
                  </Pill>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between text-primary font-semibold">
                <span>
                  {expandedCard === 'submissionsControl'
                    ? t('common.close', { defaultValue: 'Close' })
                    : t('common.open', { defaultValue: 'Open' })}
                </span>
                <ChevronRightIcon />
              </div>
            </div>
          );
        }

        if (cardId === 'bots' && isStreamerAdmin) {
          return (
            <div
              key={cardId}
              className={baseCardCls}
              role="button"
              tabIndex={0}
              aria-expanded={expandedCard === 'bots'}
              onClick={onToggleBots}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggleBots();
                }
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold dark:text-white">{t('dashboard.bots.title', { defaultValue: 'Боты' })}</h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    {t('dashboard.bots.subtitle', { defaultValue: 'Включайте или выключайте все интеграции одним действием.' })}
                  </p>
                </div>
                <div className="flex items-start gap-2 shrink-0">
                  <CardHelpHint
                    enabled={helpEnabled}
                    text={t('dashboard.help.cards.bots', {
                      defaultValue: 'Manage bot integrations: enable/disable them quickly.',
                    })}
                  />
                  <Pill variant={anyBotEnabled ? 'successSolid' : 'neutral'} size="sm">
                    {anyBotEnabled ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })}
                  </Pill>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between text-primary font-semibold">
                <span>
                  {expandedCard === 'bots' ? t('common.close', { defaultValue: 'Close' }) : t('common.open', { defaultValue: 'Open' })}
                </span>
                <ChevronRightIcon />
              </div>
            </div>
          );
        }

        return (
          <div key={cardId} className="surface surface-hover p-6 flex flex-col min-h-[210px] rounded-2xl">
            <div className="text-sm text-gray-600 dark:text-gray-400">Unknown card</div>
          </div>
        );
      })}
    </div>
  );
}
