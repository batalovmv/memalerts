import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { Dispatch, SetStateAction } from 'react';

import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { Input } from '@/shared/ui';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';

type TrovoRewardsSectionProps = {
  rewardSettings: RewardSettingsState;
  onChangeRewardSettings: Dispatch<SetStateAction<RewardSettingsState>>;
  savingTrovoReward: boolean;
  trovoSavedPulse: boolean;
  trovoLinked: boolean;
};

export function TrovoRewardsSection({
  rewardSettings,
  onChangeRewardSettings,
  savingTrovoReward,
  trovoSavedPulse,
  trovoLinked,
}: TrovoRewardsSectionProps) {
  const { t } = useTranslation();

  return (
    <SettingsSection
      title={t('admin.trovoCoinsRewardTitle', { defaultValue: 'Награды за монеты (Trovo)' })}
      description={t('admin.trovoCoinsRewardDescription', { defaultValue: 'Начисление монет за mana / elixir на Trovo.' })}
      overlay={
        <>
          {savingTrovoReward && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
          {trovoSavedPulse && !savingTrovoReward && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
        </>
      }
    >
      {!trovoLinked && (
        <p className="text-sm text-yellow-700 dark:text-yellow-300">
          {t('admin.trovoNotLinked', { defaultValue: 'Trovo account is not linked. Link Trovo in Settings → Accounts.' })}
        </p>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t('admin.trovoRewardsPrereqHint', {
          defaultValue:
            'Важно: также нужно настроить интеграцию во вкладке Bots (trovoChannelId). “Включено” считается если per-unit > 0.',
        })}
      </p>
      <div className={savingTrovoReward ? 'pointer-events-none opacity-60' : ''}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('admin.trovoManaCoinsPerUnit', { defaultValue: 'trovoManaCoinsPerUnit' })}
            </label>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={rewardSettings.trovoManaCoinsPerUnit}
              onChange={(e) => {
                const next = e.target.value.replace(/[^\d]/g, '');
                onChangeRewardSettings((p) => ({ ...p, trovoManaCoinsPerUnit: next }));
              }}
              onKeyDown={(e) => {
                if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                  e.preventDefault();
                }
              }}
              placeholder="0"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('admin.trovoManaCoinsPerUnitHint', { defaultValue: 'coins = mana * perUnit (0 = disable)' })}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('admin.trovoElixirCoinsPerUnit', { defaultValue: 'trovoElixirCoinsPerUnit' })}
            </label>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={rewardSettings.trovoElixirCoinsPerUnit}
              onChange={(e) => {
                const next = e.target.value.replace(/[^\d]/g, '');
                onChangeRewardSettings((p) => ({ ...p, trovoElixirCoinsPerUnit: next }));
              }}
              onKeyDown={(e) => {
                if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                  e.preventDefault();
                }
              }}
              placeholder="0"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('admin.trovoElixirCoinsPerUnitHint', { defaultValue: 'coins = elixir * perUnit (0 = disable)' })}
            </p>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
