import { useTranslation } from 'react-i18next';

import type { RewardSettingsState } from '@/features/settings/tabs/rewards/types';
import type { Dispatch, SetStateAction } from 'react';

import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { HelpTooltip, Input } from '@/shared/ui';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';

type EconomySettingsSectionProps = {
  rewardSettings: RewardSettingsState;
  onChangeRewardSettings: Dispatch<SetStateAction<RewardSettingsState>>;
  savingEconomy: boolean;
  economySavedPulse: boolean;
};

export function EconomySettingsSection({
  rewardSettings,
  onChangeRewardSettings,
  savingEconomy,
  economySavedPulse,
}: EconomySettingsSectionProps) {
  const { t } = useTranslation();

  return (
    <SettingsSection
      title={t('economy.settingsTitle', { defaultValue: 'Экономика канала' })}
      description={t('economy.settingsDescription', {
        defaultValue: 'Настройте желаемое число мемов, среднюю цену и множитель наград.',
      })}
      overlay={
        <>
          {savingEconomy && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
          {economySavedPulse && !savingEconomy && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
        </>
      }
    >
      <div className={savingEconomy ? 'pointer-events-none opacity-60' : ''}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <HelpTooltip content={t('economy.memesPerHourHint', { defaultValue: 'Желаемое количество мемов в час (1-10).' })}>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('economy.memesPerHour', { defaultValue: 'Мемов в час' })}
              </label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={rewardSettings.economyMemesPerHour}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^\d]/g, '');
                  const clamped = Math.min(10, Math.max(1, parseInt(next || '1', 10)));
                  onChangeRewardSettings((prev) => ({ ...prev, economyMemesPerHour: String(clamped) }));
                }}
              />
            </div>
          </HelpTooltip>

          <HelpTooltip content={t('economy.avgPriceHint', { defaultValue: 'Средняя цена мема (по умолчанию для новых мемов).' })}>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('economy.avgPrice', { defaultValue: 'Средняя цена мема (coins)' })}
              </label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={rewardSettings.economyAvgMemePriceCoins}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^\d]/g, '');
                  const clamped = Math.max(1, parseInt(next || '1', 10));
                  onChangeRewardSettings((prev) => ({ ...prev, economyAvgMemePriceCoins: String(clamped) }));
                }}
              />
            </div>
          </HelpTooltip>

          <HelpTooltip content={t('economy.rewardMultiplierHint', { defaultValue: 'Множитель наград (0.5 - 2.0).' })}>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('economy.rewardMultiplier', { defaultValue: 'Множитель наград' })}
              </label>
              <Input
                type="text"
                inputMode="decimal"
                value={rewardSettings.economyRewardMultiplier}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^\d.]/g, '');
                  onChangeRewardSettings((prev) => ({ ...prev, economyRewardMultiplier: next }));
                }}
                placeholder="1.0"
              />
            </div>
          </HelpTooltip>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          {t('economy.settingsNote', {
            defaultValue: 'Бонусы daily и watch пересчитываются автоматически на основе этих значений.',
          })}
        </p>
      </div>
    </SettingsSection>
  );
}
