import { useTranslation } from 'react-i18next';

import type { BoostySettingsState, BoostyTierCoinsErrorState } from '@/features/settings/tabs/rewards/types';
import type { Dispatch, SetStateAction } from 'react';

import { parseIntSafe } from '@/features/settings/tabs/rewards/utils';
import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { Button, Input } from '@/shared/ui';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';

type BoostyRewardsSectionProps = {
  boostySettings: BoostySettingsState;
  boostyTierErrors: BoostyTierCoinsErrorState;
  savingBoosty: boolean;
  boostySavedPulse: boolean;
  onChangeBoostySettings: Dispatch<SetStateAction<BoostySettingsState>>;
  onChangeBoostyTierErrors: Dispatch<SetStateAction<BoostyTierCoinsErrorState>>;
};

export function BoostyRewardsSection({
  boostySettings,
  boostyTierErrors,
  savingBoosty,
  boostySavedPulse,
  onChangeBoostySettings,
  onChangeBoostyTierErrors,
}: BoostyRewardsSectionProps) {
  const { t } = useTranslation();

  return (
    <SettingsSection
      title={t('admin.boostyRewardsTitle', { defaultValue: 'Boosty' })}
      description={t('admin.boostyRewardsDescription', {
        defaultValue: 'Настройка наград за подписку Boosty (fallback и таблица tier→coins).',
      })}
      overlay={
        <>
          {savingBoosty && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
          {boostySavedPulse && !savingBoosty && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
        </>
      }
    >
      <div className={savingBoosty ? 'pointer-events-none opacity-60' : ''}>
        {(() => {
          const fallback = parseIntSafe(String(boostySettings.boostyCoinsPerSub || '0')) ?? 0;
          const hasAnyTier = boostySettings.boostyTierCoins.some((r) => {
            const key = String(r.tierKey || '').trim();
            const coinsStr = String(r.coins || '').trim();
            if (!key || coinsStr === '') return false;
            const coins = parseIntSafe(coinsStr);
            return coins !== null && coins > 0;
          });
          if (fallback > 0 || hasAnyTier) return null;
          return (
            <div className="mb-4 rounded-xl bg-yellow-500/10 ring-1 ring-yellow-500/20 p-4 text-sm text-yellow-800 dark:text-yellow-200">
              {t('admin.boostyRewardsDisabledWarning', {
                defaultValue:
                  'Награды отключены: укажите fallback (boostyCoinsPerSub) или таблицу tier→coins, иначе монеты начисляться не будут.',
              })}
            </div>
          );
        })()}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('admin.boostyBlogName', { defaultValue: 'boostyBlogName' })}
            </label>
            <Input
              type="text"
              value={boostySettings.boostyBlogName}
              onChange={(e) => {
                onChangeBoostySettings((p) => ({ ...p, boostyBlogName: e.target.value }));
                // Clear any table-level error (e.g. server validation) once user edits inputs.
                onChangeBoostyTierErrors((prev) => (prev.table ? { ...prev, table: null } : prev));
              }}
              placeholder={t('admin.boostyBlogNamePlaceholder', { defaultValue: 'например: memalerts' })}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('admin.boostyBlogNameHint', {
                defaultValue: 'Какой Boosty-блог считать “подпиской на канал”.',
              })}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('admin.boostyCoinsPerSub', { defaultValue: 'boostyCoinsPerSub (fallback)' })}
            </label>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={boostySettings.boostyCoinsPerSub}
              onChange={(e) => {
                const next = e.target.value.replace(/[^\d]/g, '');
                onChangeBoostySettings((p) => ({ ...p, boostyCoinsPerSub: next }));
                onChangeBoostyTierErrors((prev) => (prev.table ? { ...prev, table: null } : prev));
              }}
              onKeyDown={(e) => {
                if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                  e.preventDefault();
                }
              }}
              placeholder="0"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('admin.boostyCoinsPerSubHint', { defaultValue: 'Награда по умолчанию, если tier не сопоставлен (0 = отключить).' })}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('admin.boostyTierCoinsTitle', { defaultValue: 'boostyTierCoins (tier→coins)' })}
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="glass-btn bg-white/40 dark:bg-white/5"
              onClick={() => {
                onChangeBoostySettings((p) => ({ ...p, boostyTierCoins: [...p.boostyTierCoins, { tierKey: '', coins: '' }] }));
                // Indices-based errors would shift; simplest UX is to clear and re-validate on save.
                onChangeBoostyTierErrors({ table: null, rows: {} });
              }}
            >
              {t('admin.addRow', { defaultValue: 'Добавить строку' })}
            </Button>
          </div>

          {boostyTierErrors.table ? (
            <div className="mt-2 text-sm text-red-600 dark:text-red-400">{boostyTierErrors.table}</div>
          ) : null}

          <div className="mt-3 space-y-2">
            {boostySettings.boostyTierCoins.length === 0 ? (
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {t('admin.boostyTierCoinsEmpty', { defaultValue: 'Таблица пуста.' })}
              </div>
            ) : (
              boostySettings.boostyTierCoins.map((row, idx) => {
                const rowErr = boostyTierErrors.rows[idx] || {};
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-start rounded-xl bg-white/30 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-3"
                  >
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                        {t('admin.boostyTierKey', { defaultValue: 'tierKey' })}
                      </label>
                      <Input
                        type="text"
                        value={row.tierKey}
                        hasError={!!rowErr.tierKey}
                        onChange={(e) => {
                          const v = e.target.value;
                          onChangeBoostySettings((p) => ({
                            ...p,
                            boostyTierCoins: p.boostyTierCoins.map((r, i) => (i === idx ? { ...r, tierKey: v } : r)),
                          }));
                          onChangeBoostyTierErrors((prev) => {
                            const cur = prev.rows[idx];
                            if (!prev.table && !cur?.tierKey) return prev;
                            const nextRows = { ...prev.rows };
                            if (cur) {
                              const nextRow = { ...cur };
                              delete nextRow.tierKey;
                              if (Object.keys(nextRow).length === 0) {
                                delete nextRows[idx];
                              } else {
                                nextRows[idx] = nextRow;
                              }
                            }
                            return { table: null, rows: nextRows };
                          });
                        }}
                        placeholder="tier-1"
                      />
                      {rowErr.tierKey ? <div className="mt-1 text-xs text-red-600 dark:text-red-400">{rowErr.tierKey}</div> : null}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                        {t('admin.boostyCoins', { defaultValue: 'coins' })}
                      </label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={row.coins}
                        hasError={!!rowErr.coins}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^\d]/g, '');
                          onChangeBoostySettings((p) => ({
                            ...p,
                            boostyTierCoins: p.boostyTierCoins.map((r, i) => (i === idx ? { ...r, coins: v } : r)),
                          }));
                          onChangeBoostyTierErrors((prev) => {
                            const cur = prev.rows[idx];
                            if (!prev.table && !cur?.coins) return prev;
                            const nextRows = { ...prev.rows };
                            if (cur) {
                              const nextRow = { ...cur };
                              delete nextRow.coins;
                              if (Object.keys(nextRow).length === 0) {
                                delete nextRows[idx];
                              } else {
                                nextRows[idx] = nextRow;
                              }
                            }
                            return { table: null, rows: nextRows };
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
                            e.preventDefault();
                          }
                        }}
                        placeholder="0"
                      />
                      {row.coins === '0' ? (
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {t('admin.boostyCoinsZeroHint', { defaultValue: '0 отключает награду для этого tier.' })}
                        </div>
                      ) : null}
                      {rowErr.coins ? <div className="mt-1 text-xs text-red-600 dark:text-red-400">{rowErr.coins}</div> : null}
                    </div>

                    <div className="pt-6 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="glass-btn bg-white/40 dark:bg-white/5"
                        onClick={() => {
                          onChangeBoostySettings((p) => ({
                            ...p,
                            boostyTierCoins: p.boostyTierCoins.filter((_, i) => i !== idx),
                          }));
                          // Clear errors to avoid index mismatch.
                          onChangeBoostyTierErrors({ table: null, rows: {} });
                        }}
                      >
                        {t('common.remove', { defaultValue: 'Remove' })}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
