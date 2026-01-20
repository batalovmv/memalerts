import { useTranslation } from 'react-i18next';

import { Button, Input } from '@/shared/ui';
import { SavingOverlay } from '@/shared/ui/StatusOverlays';

import { ToggleSwitch } from '../../components/ToggleSwitch';
import type { UseBotCommandsResult } from '../../hooks/useBotCommands';

type TwitchLegacyTriggersProps = {
  commands: UseBotCommandsResult;
};

export const TwitchLegacyTriggers = ({ commands }: TwitchLegacyTriggersProps) => {
  const { t } = useTranslation();
  const {
    followGreetingsEnabled,
    followGreetingTemplate,
    setFollowGreetingTemplate,
    savingFollowGreetings,
    enableFollowGreetings,
    disableFollowGreetings,
    streamDurationNotAvailable,
    streamDurationEnabled,
    streamDurationOpen,
    savingStreamDuration,
    streamDurationTrigger,
    setStreamDurationTrigger,
    streamDurationBreakCreditMinutes,
    setStreamDurationBreakCreditMinutes,
    streamDurationTemplate,
    setStreamDurationTemplate,
    toggleStreamDurationEnabled,
    saveStreamDuration,
  } = commands;

  return (
    <>
      <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 relative">
        {savingFollowGreetings ? <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving:' })} /> : null}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.followGreetingsTitle', { defaultValue: 'Follow greetings' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.followGreetingsHint', {
                defaultValue: 'When someone follows your channel (while you are live), the bot will post a greeting in chat.',
              })}
            </div>
          </div>
          <ToggleSwitch
            checked={followGreetingsEnabled}
            disabled={savingFollowGreetings}
            busy={savingFollowGreetings}
            onChange={(enabled) => {
              if (enabled) {
                void enableFollowGreetings();
              } else {
                void disableFollowGreetings();
              }
            }}
            ariaLabel={t('admin.followGreetingsTitle', { defaultValue: 'Follow greetings' })}
          />
        </div>

        {followGreetingsEnabled && (
          <div className="mt-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              {t('admin.followGreetingTemplateLabel', { defaultValue: 'Greeting template' })}
            </label>
            <Input
              value={followGreetingTemplate}
              onChange={(e) => setFollowGreetingTemplate(e.target.value)}
              placeholder={t('admin.followGreetingTemplatePlaceholder', { defaultValue: 'Thanks for the follow, {user}!' })}
            />
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              {t('admin.followGreetingTemplateVars', { defaultValue: 'You can use {user} placeholder.' })}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 relative">
        {savingStreamDuration ? <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving:' })} /> : null}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.streamDurationTitle', { defaultValue: 'Stream duration command' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.streamDurationHint', {
                defaultValue:
                  'Bot command that tracks how long your stream has been live. Optional "break credit" keeps the timer running during short interruptions.',
              })}
            </div>
          </div>
          <ToggleSwitch
            checked={streamDurationEnabled}
            disabled={savingStreamDuration || streamDurationNotAvailable}
            busy={savingStreamDuration}
            onChange={(enabled) => void toggleStreamDurationEnabled(enabled)}
            ariaLabel={t('admin.streamDurationTitle', { defaultValue: 'Stream duration command' })}
          />
        </div>

        {streamDurationNotAvailable && (
          <div className="mt-3 text-sm text-amber-800 dark:text-amber-200">
            {t('admin.streamDurationNotAvailable', {
              defaultValue: 'Stream duration command is not available on this server yet. Please deploy the backend update.',
            })}
          </div>
        )}

        {!streamDurationNotAvailable && streamDurationEnabled && streamDurationOpen && (
          <div className="mt-3 space-y-3">
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {t('admin.streamDurationLiveOnlyInfo', { defaultValue: 'This command works only while your stream is live.' })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.streamDurationTriggerLabel', { defaultValue: 'Trigger' })}
                </label>
                <Input value={streamDurationTrigger} onChange={(e) => setStreamDurationTrigger(e.target.value)} placeholder="!time" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.streamDurationBreakCreditLabel', { defaultValue: 'Break credit (minutes)' })}
                </label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={String(streamDurationBreakCreditMinutes)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setStreamDurationBreakCreditMinutes(Number.isFinite(n) ? n : 0);
                  }}
                />
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  {t('admin.streamDurationBreakCreditHint', {
                    defaultValue:
                      'If the stream goes offline briefly (e.g. 30 min) and credit is 60 min, the timer won\'t reset.',
                  })}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                {t('admin.streamDurationTemplateLabel', { defaultValue: 'Response template' })}
              </label>
              <Input
                value={streamDurationTemplate}
                onChange={(e) => setStreamDurationTemplate(e.target.value)}
                placeholder={t('admin.streamDurationTemplatePlaceholder', { defaultValue: 'Live for {hours}h {minutes}m' })}
              />
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                {t('admin.streamDurationTemplateVars', { defaultValue: 'Variables: {hours}, {minutes}, {totalMinutes}.' })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <Button type="button" variant="primary" onClick={() => void saveStreamDuration()} disabled={savingStreamDuration}>
                {t('common.save', { defaultValue: 'Save' })}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
