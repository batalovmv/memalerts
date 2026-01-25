import { useTranslation } from 'react-i18next';

import type { BotIntegration, ExpandCard, PublicSubmissionsStatus, SubmissionsControlState } from '@/features/dashboard/types';

import { ToggleSwitch } from '@/features/dashboard/ui/ToggleSwitch';
import { Button, Pill } from '@/shared/ui';
import SecretCopyField from '@/shared/ui/SecretCopyField/SecretCopyField';

type DashboardExpandedPanelProps = {
  expandedCard: ExpandCard;
  helpEnabled: boolean;
  submissionsEnabled: boolean | null;
  submissionsOnlyWhenLive: boolean | null;
  autoApproveEnabled: boolean | null;
  savingSubmissionsSettings: null | 'enabled' | 'onlyWhenLive';
  savingAutoApprove: boolean;
  onToggleSubmissionsEnabled: (next: boolean) => void;
  onToggleOnlyWhenLive: (next: boolean) => void;
  onToggleAutoApprove: (next: boolean) => void;
  memeCatalogMode: null | 'channel' | 'pool_all';
  savingMemeCatalogMode: boolean;
  onChangeMemeCatalogMode: (nextMode: 'channel' | 'pool_all') => void;
  submissionsControl: SubmissionsControlState | null;
  submissionsControlStatus: PublicSubmissionsStatus | null;
  rotatingSubmissionsControl: boolean;
  onRotateSubmissionsControl: () => void;
  botsLoading: boolean;
  botsLoaded: boolean;
  visibleBots: BotIntegration[];
  anyBotEnabled: boolean;
  allBotsEnabled: boolean;
  onToggleAllBots: (nextEnabled: boolean) => void;
  onClose: () => void;
};

export function DashboardExpandedPanel({
  expandedCard,
  helpEnabled,
  submissionsEnabled,
  submissionsOnlyWhenLive,
  autoApproveEnabled,
  savingSubmissionsSettings,
  savingAutoApprove,
  onToggleSubmissionsEnabled,
  onToggleOnlyWhenLive,
  onToggleAutoApprove,
  memeCatalogMode,
  savingMemeCatalogMode,
  onChangeMemeCatalogMode,
  submissionsControl,
  submissionsControlStatus,
  rotatingSubmissionsControl,
  onRotateSubmissionsControl,
  botsLoading,
  botsLoaded,
  visibleBots,
  anyBotEnabled,
  allBotsEnabled,
  onToggleAllBots,
  onClose,
}: DashboardExpandedPanelProps) {
  if (!expandedCard) return null;

  const panelCls = [
    'overflow-hidden transition-all duration-300',
    expandedCard ? 'max-h-[1400px] opacity-100 mt-6' : 'max-h-0 opacity-0 mt-0',
  ].join(' ');

  return (
    <div className={panelCls}>
      {expandedCard === 'submissionsControl' ? (
        <SubmissionsControlPanel
          helpEnabled={helpEnabled}
          submissionsEnabled={submissionsEnabled}
          submissionsOnlyWhenLive={submissionsOnlyWhenLive}
          autoApproveEnabled={autoApproveEnabled}
          savingSubmissionsSettings={savingSubmissionsSettings}
          savingAutoApprove={savingAutoApprove}
          onToggleSubmissionsEnabled={onToggleSubmissionsEnabled}
          onToggleOnlyWhenLive={onToggleOnlyWhenLive}
          onToggleAutoApprove={onToggleAutoApprove}
          memeCatalogMode={memeCatalogMode}
          savingMemeCatalogMode={savingMemeCatalogMode}
          onChangeMemeCatalogMode={onChangeMemeCatalogMode}
          submissionsControl={submissionsControl}
          submissionsControlStatus={submissionsControlStatus}
          rotatingSubmissionsControl={rotatingSubmissionsControl}
          onRotateSubmissionsControl={onRotateSubmissionsControl}
          onClose={onClose}
        />
      ) : expandedCard === 'bots' ? (
        <BotsPanel
          botsLoading={botsLoading}
          botsLoaded={botsLoaded}
          visibleBots={visibleBots}
          anyBotEnabled={anyBotEnabled}
          allBotsEnabled={allBotsEnabled}
          onToggleAllBots={onToggleAllBots}
          onClose={onClose}
        />
      ) : null}
    </div>
  );
}

type SubmissionsControlPanelProps = {
  helpEnabled: boolean;
  submissionsEnabled: boolean | null;
  submissionsOnlyWhenLive: boolean | null;
  autoApproveEnabled: boolean | null;
  savingSubmissionsSettings: null | 'enabled' | 'onlyWhenLive';
  savingAutoApprove: boolean;
  onToggleSubmissionsEnabled: (next: boolean) => void;
  onToggleOnlyWhenLive: (next: boolean) => void;
  onToggleAutoApprove: (next: boolean) => void;
  memeCatalogMode: null | 'channel' | 'pool_all';
  savingMemeCatalogMode: boolean;
  onChangeMemeCatalogMode: (nextMode: 'channel' | 'pool_all') => void;
  submissionsControl: SubmissionsControlState | null;
  submissionsControlStatus: PublicSubmissionsStatus | null;
  rotatingSubmissionsControl: boolean;
  onRotateSubmissionsControl: () => void;
  onClose: () => void;
};

function SubmissionsControlPanel({
  helpEnabled,
  submissionsEnabled,
  submissionsOnlyWhenLive,
  autoApproveEnabled,
  savingSubmissionsSettings,
  savingAutoApprove,
  onToggleSubmissionsEnabled,
  onToggleOnlyWhenLive,
  onToggleAutoApprove,
  memeCatalogMode,
  savingMemeCatalogMode,
  onChangeMemeCatalogMode,
  submissionsControl,
  submissionsControlStatus,
  rotatingSubmissionsControl,
  onRotateSubmissionsControl,
  onClose,
}: SubmissionsControlPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="surface p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold dark:text-white">
            {t('dashboard.submissionsControl.title', { defaultValue: 'Отправка мемов' })}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('dashboard.submissionsControl.subtitle', {
              defaultValue: 'Быстро включайте/выключайте отправку и генерируйте ссылки для StreamerBot.',
            })}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          {t('common.close', { defaultValue: 'Close' })}
        </Button>
      </div>

      <div className="mt-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-medium text-gray-900 dark:text-white">
              {t('dashboard.submissions.enabledTitle', { defaultValue: 'Разрешить отправку' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t('dashboard.submissions.enabledHint', { defaultValue: 'Если выключено — зритель увидит сообщение вместо формы.' })}
            </div>
          </div>
          <ToggleSwitch
            checked={submissionsEnabled ?? true}
            busy={savingSubmissionsSettings === 'enabled'}
            disabled={submissionsEnabled === null}
            ariaLabel={t('dashboard.submissions.enabledTitle', { defaultValue: 'Разрешить отправку' })}
            onChange={onToggleSubmissionsEnabled}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-medium text-gray-900 dark:text-white">
              {t('dashboard.submissions.onlyWhenLiveTitle', { defaultValue: 'Только когда стрим онлайн' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t('dashboard.submissions.onlyWhenLiveHint', { defaultValue: 'Если включено — отправка недоступна когда стрим оффлайн.' })}
            </div>
          </div>
          <ToggleSwitch
            checked={submissionsOnlyWhenLive ?? false}
            busy={savingSubmissionsSettings === 'onlyWhenLive'}
            disabled={submissionsOnlyWhenLive === null || submissionsEnabled === false}
            ariaLabel={t('dashboard.submissions.onlyWhenLiveTitle', { defaultValue: 'Только когда стрим онлайн' })}
            onChange={onToggleOnlyWhenLive}
          />
        </div>

        <div className="pt-4 border-t border-black/5 dark:border-white/10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium text-gray-900 dark:text-white">
                {t('dashboard.submissions.autoApproveTitle', { defaultValue: 'Авто‑одобрение безопасных мемов' })}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {t('dashboard.submissions.autoApproveHint', {
                  defaultValue: 'Включает строгую AI‑проверку. Подходящие мемы будут одобряться автоматически.',
                })}
              </div>
            </div>
            <ToggleSwitch
              checked={autoApproveEnabled ?? false}
              busy={savingAutoApprove}
              disabled={autoApproveEnabled === null}
              ariaLabel={t('dashboard.submissions.autoApproveTitle', { defaultValue: 'Авто‑одобрение безопасных мемов' })}
              onChange={onToggleAutoApprove}
            />
          </div>
        </div>

        <div className="pt-4 border-t border-black/5 dark:border-white/10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium text-gray-900 dark:text-white">
                {t('dashboard.memeCatalogMode.title', { defaultValue: 'Каталог мемов на публичной странице' })}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {t('dashboard.memeCatalogMode.hint', {
                  defaultValue:
                    'Выберите, что будет показываться на странице канала: только ваши одобренные мемы или весь пул.',
                })}
              </div>
            </div>
            <ToggleSwitch
              checked={memeCatalogMode === 'pool_all'}
              busy={savingMemeCatalogMode}
              disabled={memeCatalogMode === null}
              ariaLabel={t('dashboard.memeCatalogMode.toggleAria', { defaultValue: 'Show all pool memes on channel page' })}
              onChange={(next) => onChangeMemeCatalogMode(next ? 'pool_all' : 'channel')}
            />
          </div>
          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            {memeCatalogMode === 'pool_all'
              ? t('dashboard.memeCatalogMode.state.poolAll', {
                  defaultValue: 'Сейчас: весь пул (пользователи могут активировать любой мем).',
                })
              : t('dashboard.memeCatalogMode.state.channelOnly', {
                  defaultValue: 'Сейчас: только мои одобренные мемы.',
                })}
          </div>
        </div>

        <div className="pt-4 border-t border-black/5 dark:border-white/10">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-gray-900 dark:text-white">
                {t('dashboard.submissionsControl.linkTitle', { defaultValue: 'Ссылка для StreamerBot / StreamDeck' })}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {t('dashboard.submissionsControl.linkHint', {
                  defaultValue:
                    'Нажмите «Сгенерировать» и сохраните ссылку. Посмотреть её повторно будет нельзя — только перегенерировать.',
                })}
              </div>
            </div>
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={rotatingSubmissionsControl}
              onClick={onRotateSubmissionsControl}
            >
              {rotatingSubmissionsControl
                ? t('common.loading', { defaultValue: 'Loading…' })
                : t('dashboard.submissionsControl.rotate', { defaultValue: 'Сгенерировать' })}
            </Button>
          </div>

          {submissionsControl?.revealable === true && submissionsControlStatus && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Pill variant={submissionsControlStatus.enabled ? 'successSolid' : 'dangerSolid'} size="sm">
                {t('dashboard.submissionsControl.statusSubmits', { defaultValue: 'Submits' })}:{' '}
                {submissionsControlStatus.enabled ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })}
              </Pill>
              {typeof submissionsOnlyWhenLive === 'boolean' ? (
                <Pill variant="neutral" size="sm">
                  {t('dashboard.submissionsControl.statusOnlyWhenLive', { defaultValue: 'Only when live' })}:{' '}
                  {submissionsOnlyWhenLive ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })}
                </Pill>
              ) : null}
            </div>
          )}

          {submissionsControl?.revealable === true && submissionsControl.url && (
            <div className="mt-4 space-y-3">
              <SecretCopyField
                label={t('dashboard.submissionsControl.controlLink', { defaultValue: 'Control link' })}
                value={submissionsControl.url}
                masked={true}
                helpEnabled={helpEnabled}
              />
              {submissionsControl.token ? (
                <SecretCopyField
                  label={t('dashboard.submissionsControl.token', { defaultValue: 'Token (one-time)' })}
                  value={submissionsControl.token}
                  masked={true}
                  helpEnabled={helpEnabled}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type BotsPanelProps = {
  botsLoading: boolean;
  botsLoaded: boolean;
  visibleBots: BotIntegration[];
  anyBotEnabled: boolean;
  allBotsEnabled: boolean;
  onToggleAllBots: (nextEnabled: boolean) => void;
  onClose: () => void;
};

function BotsPanel({
  botsLoading,
  botsLoaded,
  visibleBots,
  anyBotEnabled,
  allBotsEnabled,
  onToggleAllBots,
  onClose,
}: BotsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="surface p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold dark:text-white">{t('dashboard.bots.title', { defaultValue: 'Боты' })}</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('dashboard.bots.subtitle', { defaultValue: 'Включайте или выключайте все интеграции одним действием.' })}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          {t('common.close', { defaultValue: 'Close' })}
        </Button>
      </div>

      <div className="mt-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium text-gray-900 dark:text-white">{t('dashboard.bots.allOn', { defaultValue: 'Все провайдеры' })}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t('dashboard.bots.hint', {
              defaultValue: 'Список берётся с сервера. Если YouTube просит re-link — переподключите в Settings → Bot.',
            })}
          </div>
        </div>
        <Button
          type="button"
          variant={anyBotEnabled ? 'danger' : 'primary'}
          size="sm"
          disabled={botsLoading || !botsLoaded}
          onClick={() => onToggleAllBots(!anyBotEnabled)}
        >
          {botsLoading
            ? t('common.loading', { defaultValue: 'Loading…' })
            : anyBotEnabled
              ? t('dashboard.bots.disableAll', { defaultValue: 'Выключить всех' })
              : t('dashboard.bots.enableAll', { defaultValue: 'Включить всех' })}
        </Button>
      </div>

      <div className="mt-4">
        {!botsLoaded ? (
          <div className="text-sm text-gray-600 dark:text-gray-400">{t('common.loading', { defaultValue: 'Loading…' })}</div>
        ) : visibleBots.length === 0 ? (
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {t('dashboard.bots.none', { defaultValue: 'No bot integrations found.' })}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visibleBots.map((b) => (
              <Pill key={String(b.provider)} variant={b.enabled ? 'successSolid' : 'neutral'} size="sm">
                {String(b.provider)}: {b.enabled ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })}
              </Pill>
            ))}
            {allBotsEnabled ? (
              <Pill variant="success" size="sm">
                {t('dashboard.bots.allOn', { defaultValue: 'All on' })}
              </Pill>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
