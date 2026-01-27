import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { Dispatch, SetStateAction } from 'react';

import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { HelpTooltip, Input } from '@/shared/ui';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';

type WheelSettingsSectionProps = {
  rewardSettings: RewardSettingsState;
  onChangeRewardSettings: Dispatch<SetStateAction<RewardSettingsState>>;
  savingWheel: boolean;
  wheelSavedPulse: boolean;
};

export function WheelSettingsSection({
  rewardSettings,
  onChangeRewardSettings,
  savingWheel,
  wheelSavedPulse,
}: WheelSettingsSectionProps) {
  const { t } = useTranslation();

  return (
    <SettingsSection
      title={t('wheel.settingsTitle', { defaultValue: 'Колесо фортуны' })}
      description={t('wheel.settingsDescription', {
        defaultValue: 'Настройте доступность колеса, цену платной крутки и множитель призов.',
      })}
      overlay={
        <>
          {savingWheel && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
          {wheelSavedPulse && !savingWheel && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
        </>
      }
    >
      <div className={savingWheel ? 'pointer-events-none opacity-60' : ''}>
        <label className="flex items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
          <input
            type="checkbox"
            checked={rewardSettings.wheelEnabled}
            onChange={(e) => {
              onChangeRewardSettings((prev) => ({ ...prev, wheelEnabled: e.target.checked }));
            }}
          />
          {t('wheel.settingsEnabled', { defaultValue: 'Включить колесо' })}
        </label>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <HelpTooltip content={t('wheel.paidCostHint', { defaultValue: 'Стоимость платной крутки (в coins). Пусто = авто по экономике.' })}>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('wheel.paidCost', { defaultValue: 'Цена платной крутки' })}
              </label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={rewardSettings.wheelPaidSpinCostCoins}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^\d]/g, '');
                  onChangeRewardSettings((prev) => ({ ...prev, wheelPaidSpinCostCoins: next }));
                }}
                placeholder=""
              />
            </div>
          </HelpTooltip>

          <HelpTooltip content={t('wheel.multiplierHint', { defaultValue: 'Множитель призов (0.5 - 2.0).' })}>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('wheel.multiplier', { defaultValue: 'Множитель призов' })}
              </label>
              <Input
                type="text"
                inputMode="decimal"
                value={rewardSettings.wheelPrizeMultiplier}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^\d.]/g, '');
                  onChangeRewardSettings((prev) => ({ ...prev, wheelPrizeMultiplier: next }));
                }}
                placeholder="1.0"
              />
            </div>
          </HelpTooltip>
        </div>
      </div>
    </SettingsSection>
  );
}
