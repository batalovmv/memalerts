import type { SettingsTab } from '@/features/settings/model/types';
import type { TFunction } from 'i18next';

export function getSettingsTabLabel(t: TFunction, tab: SettingsTab): string {
  if (tab === 'settings') return t('admin.channelDesign', { defaultValue: 'Оформление' });
  if (tab === 'rewards') return t('admin.rewards', { defaultValue: 'Награды' });
  if (tab === 'obs') return t('admin.obsLinks', { defaultValue: 'OBS' });
  if (tab === 'bot') return t('admin.bot', { defaultValue: 'Bot' });
  if (tab === 'statistics') return t('admin.statistics', { defaultValue: 'Statistics' });
  if (tab === 'promotions') return t('admin.promotions', { defaultValue: 'Promotions' });
  if (tab === 'wallets') return t('admin.walletManagement', { defaultValue: 'Wallet management' });
  if (tab === 'entitlements') return t('admin.entitlements', { defaultValue: 'Entitlements' });
  if (tab === 'ownerMemeAssets') return t('ownerModeration.memeAssetsTab', { defaultValue: 'Owner: Meme assets' });
  if (tab === 'ownerModerators') return t('ownerModerators.tab', { defaultValue: 'Owner: Moderators' });
  if (tab === 'ownerAiStatus') return t('ownerAiStatus.tab', { defaultValue: 'Owner: AI status' });
  if (tab === 'beta') return t('admin.betaAccess', { defaultValue: 'Beta access' });
  if (tab === 'accounts') return t('settings.accounts', { defaultValue: 'Accounts' });
  return tab;
}
