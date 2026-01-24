import { useTranslation } from 'react-i18next';

import type { TwitchAutoRewardsV1 } from '@/types';

import { AutoRewardsEditor } from '@/features/settings/tabs/rewards/TwitchAutoRewardsEditor';
import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { Button } from '@/shared/ui';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';

type AutoRewardsSectionProps = {
  saving: boolean;
  savedPulse: boolean;
  autoRewardsLinked: boolean;
  error: string | null;
  draft: TwitchAutoRewardsV1 | null;
  onChangeDraft: (next: TwitchAutoRewardsV1 | null) => void;
  onSave: (overrideValue?: TwitchAutoRewardsV1 | null) => void;
  onClear: () => void;
};

export function AutoRewardsSection({
  saving,
  savedPulse,
  autoRewardsLinked,
  error,
  draft,
  onChangeDraft,
  onSave,
  onClear,
}: AutoRewardsSectionProps) {
  const { t } = useTranslation();

  return (
    <SettingsSection
      title={t('admin.autoRewardsTitle', { defaultValue: 'Автонаграды (Twitch/Kick/Trovo/VKVideo)' })}
      description={t('admin.twitchAutoRewardsDescription', {
        defaultValue:
          'Автоматическое начисление монет за события (Twitch/Kick/Trovo/VKVideo). Настройка хранится в виде JSON и применяется бэкендом best-effort.',
      })}
      overlay={
        <>
          {saving && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
          {savedPulse && !saving && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
        </>
      }
      right={
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" disabled={saving || !autoRewardsLinked} onClick={() => onSave()}>
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
          <Button variant="secondary" size="sm" disabled={saving || !autoRewardsLinked} onClick={onClear}>
            {t('common.clear', { defaultValue: 'Clear' })}
          </Button>
        </div>
      }
    >
      {!autoRewardsLinked && (
        <p className="text-sm text-yellow-700 dark:text-yellow-300">
          {t('admin.autoRewardsNoPlatformsLinked', {
            defaultValue: 'No Twitch/Kick/Trovo/VKVideo account is linked. Link at least one in Settings → Accounts.',
          })}
        </p>
      )}
      {error && <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p>}
      <AutoRewardsEditor
        value={draft}
        onChange={(next) => {
          onChangeDraft(next);
        }}
        disabled={saving || !autoRewardsLinked}
        variant="noChannelPoints"
      />
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {t('admin.twitchAutoRewardsHint', {
          defaultValue:
            'Все секции опциональны. Если enabled=false или coins/… = 0 — награда не начисляется. Twitch: channelPoints → byRewardId (reward.id). VKVideo: follow/subscribe/chat используют те же секции (subscribe.primeCoins = coins). Если channelPoints.enabled=false — остаётся legacy-настройка rewardIdForCoins.',
        })}
      </p>
    </SettingsSection>
  );
}
