import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TwitchAutoRewardsV1 } from '@/types';
import { Button, Input } from '@/shared/ui';

type KvRow = { key: string; value: string };

type PlatformCode = 'TW' | 'K' | 'TR' | 'VK';

const PLATFORM_TITLES: Record<PlatformCode, string> = {
  TW: 'Twitch',
  K: 'Kick',
  TR: 'Trovo',
  VK: 'VKVideo',
};

function PlatformBadges({ platforms }: { platforms: PlatformCode[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {platforms.map((code) => (
        <span
          key={code}
          title={PLATFORM_TITLES[code]}
          className="rounded-md bg-black/5 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700 dark:text-gray-200"
        >
          {code}
        </span>
      ))}
    </span>
  );
}

function rowsFromRecord(rec: Record<string, number> | undefined): KvRow[] {
  if (!rec) return [];
  return Object.entries(rec)
    .map(([key, value]) => ({ key: String(key), value: Number.isFinite(value) ? String(value) : '' }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function recordFromRows(rows: KvRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = String(row.key || '').trim();
    const vStr = String(row.value || '').trim();
    if (!k) continue;
    const v = Number.parseInt(vStr || '0', 10);
    if (!Number.isFinite(v) || v <= 0) continue;
    out[k] = v;
  }
  return out;
}

function intOrEmpty(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

function bool(v: unknown, fallback: boolean = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function base(value: TwitchAutoRewardsV1 | null): TwitchAutoRewardsV1 {
  return value ?? { v: 1 };
}

export type AutoRewardsEditorVariant = 'all' | 'noChannelPoints' | 'channelPointsOnly';

export type AutoRewardsEditorProps = {
  value: TwitchAutoRewardsV1 | null;
  onChange: (next: TwitchAutoRewardsV1 | null) => void;
  disabled?: boolean;
  variant?: AutoRewardsEditorVariant;
};

export function AutoRewardsEditor({ value, onChange, disabled, variant = 'all' }: AutoRewardsEditorProps) {
  const { t } = useTranslation();
  const v = base(value);

  const dirtyRef = useRef(false);

  // Records are easier to edit as rows; keep local state for key/value maps.
  const [channelPointsRows, setChannelPointsRows] = useState<KvRow[]>(() => rowsFromRecord(v.channelPoints?.byRewardId));
  const [subscribeTierRows, setSubscribeTierRows] = useState<KvRow[]>(() => rowsFromRecord(v.subscribe?.tierCoins));
  const [resubTierRows, setResubTierRows] = useState<KvRow[]>(() => rowsFromRecord(v.resubMessage?.tierCoins));
  const [giftGiverTierRows, setGiftGiverTierRows] = useState<KvRow[]>(() => rowsFromRecord(v.giftSub?.giverTierCoins));
  const [thresholdCoinsRows, setThresholdCoinsRows] = useState<KvRow[]>(() => rowsFromRecord(v.chat?.messageThresholds?.coinsByThreshold));
  const [dailyStreakRows, setDailyStreakRows] = useState<KvRow[]>(() => rowsFromRecord(v.chat?.dailyStreak?.coinsByStreak));

  // If parent value changes from the outside (initial load), re-sync rows (but don't clobber while user is editing).
  useEffect(() => {
    if (dirtyRef.current) return;
    setChannelPointsRows(rowsFromRecord(base(value).channelPoints?.byRewardId));
    setSubscribeTierRows(rowsFromRecord(base(value).subscribe?.tierCoins));
    setResubTierRows(rowsFromRecord(base(value).resubMessage?.tierCoins));
    setGiftGiverTierRows(rowsFromRecord(base(value).giftSub?.giverTierCoins));
    setThresholdCoinsRows(rowsFromRecord(base(value).chat?.messageThresholds?.coinsByThreshold));
    setDailyStreakRows(rowsFromRecord(base(value).chat?.dailyStreak?.coinsByStreak));
  }, [value]);

  const isEnabled = {
    follow: bool(v.follow?.enabled),
    subscribe: bool(v.subscribe?.enabled),
    resubMessage: bool(v.resubMessage?.enabled),
    giftSub: bool(v.giftSub?.enabled),
    cheer: bool(v.cheer?.enabled),
    raid: bool(v.raid?.enabled),
    channelPoints: bool(v.channelPoints?.enabled),
    chatFirstMessage: bool(v.chat?.firstMessage?.enabled),
    chatThresholds: bool(v.chat?.messageThresholds?.enabled),
    chatDailyStreak: bool(v.chat?.dailyStreak?.enabled),
  };

  const hasAnyEnabled = useMemo(() => {
    if (variant === 'channelPointsOnly') return isEnabled.channelPoints;
    if (variant === 'noChannelPoints') {
      const { channelPoints: _channelPoints, ...rest } = isEnabled;
      return Object.values(rest).some(Boolean);
    }
    return Object.values(isEnabled).some(Boolean);
  }, [isEnabled, variant]);

  const markDirty = () => {
    dirtyRef.current = true;
  };

  const patch = (next: TwitchAutoRewardsV1) => {
    markDirty();
    onChange(next);
  };

  const setEnabled = (key: keyof typeof isEnabled, enabled: boolean) => {
    const cur = base(value);
    if (key === 'follow') patch({ ...cur, follow: { ...(cur.follow ?? {}), enabled } });
    if (key === 'subscribe') patch({ ...cur, subscribe: { ...(cur.subscribe ?? {}), enabled } });
    if (key === 'resubMessage') patch({ ...cur, resubMessage: { ...(cur.resubMessage ?? {}), enabled } });
    if (key === 'giftSub') patch({ ...cur, giftSub: { ...(cur.giftSub ?? {}), enabled } });
    if (key === 'cheer') patch({ ...cur, cheer: { ...(cur.cheer ?? {}), enabled } });
    if (key === 'raid') patch({ ...cur, raid: { ...(cur.raid ?? {}), enabled } });
    if (key === 'channelPoints') patch({ ...cur, channelPoints: { ...(cur.channelPoints ?? {}), enabled } });
    if (key === 'chatFirstMessage') patch({ ...cur, chat: { ...(cur.chat ?? {}), firstMessage: { ...(cur.chat?.firstMessage ?? {}), enabled } } });
    if (key === 'chatThresholds')
      patch({ ...cur, chat: { ...(cur.chat ?? {}), messageThresholds: { ...(cur.chat?.messageThresholds ?? {}), enabled } } });
    if (key === 'chatDailyStreak') patch({ ...cur, chat: { ...(cur.chat ?? {}), dailyStreak: { ...(cur.chat?.dailyStreak ?? {}), enabled } } });
  };

  // NOTE: Keep the UI minimal: everything is collapsed by default; user expands only what they need.
  const showChannelPoints = variant !== 'noChannelPoints';

  const channelPointsMappingBlock = (
    <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="font-semibold text-gray-900 dark:text-white">
            {t('admin.autoRewardsChannelPointsMapping', { defaultValue: 'Channel Points: rewardId → coins' })}
          </div>
          <PlatformBadges platforms={['TW']} />
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={bool(v.channelPoints?.enabled)}
            aria-label="Enable channel points auto reward"
            disabled={disabled}
            onChange={(e) => setEnabled('channelPoints', e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
        </label>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t('admin.autoRewardsChannelPointsKeysHint', { defaultValue: 'Ключи — это reward.id из Twitch.' })}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="glass-btn bg-white/40 dark:bg-white/5"
          onClick={() => {
            markDirty();
            setChannelPointsRows((p) => [...p, { key: '', value: '' }]);
          }}
        >
          {t('admin.autoRewardsAdd', { defaultValue: 'Добавить' })}
        </Button>
      </div>
      <div className="space-y-2">
        {channelPointsRows.length === 0 ? (
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {t('admin.autoRewardsNoMappingsYet', { defaultValue: 'Пока нет сопоставлений.' })}
          </div>
        ) : (
          channelPointsRows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-end">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">rewardId</label>
                <Input
                  type="text"
                  value={row.key}
                  onChange={(e) => {
                    const key = e.target.value;
                    markDirty();
                    setChannelPointsRows((p) => p.map((r, i) => (i === idx ? { ...r, key } : r)));
                  }}
                  placeholder="abc123..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.autoRewardsCoinsLower', { defaultValue: 'монеты' })}
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={row.value}
                  onChange={(e) => {
                    const valueStr = e.target.value.replace(/[^\d]/g, '');
                    markDirty();
                    setChannelPointsRows((p) => p.map((r, i) => (i === idx ? { ...r, value: valueStr } : r)));
                  }}
                  placeholder="0"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="glass-btn bg-white/40 dark:bg-white/5"
                  onClick={() => {
                    markDirty();
                    setChannelPointsRows((p) => p.filter((_, i) => i !== idx));
                  }}
                >
                  {t('admin.autoRewardsRemove', { defaultValue: 'Удалить' })}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={bool(v.channelPoints?.onlyWhenLive)}
            disabled={disabled}
            onChange={(e) => patch({ ...base(value), channelPoints: { ...(base(value).channelPoints ?? {}), onlyWhenLive: e.target.checked } })}
          />
          {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
        </label>
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() => {
            patch({
              ...base(value),
              channelPoints: { ...(base(value).channelPoints ?? {}), byRewardId: recordFromRows(channelPointsRows) },
            });
          }}
        >
          {t('admin.autoRewardsApplyMappings', { defaultValue: 'Применить' })}
        </Button>
      </div>
    </div>
  );

  if (variant === 'channelPointsOnly') {
    return (
      <div className={disabled ? 'pointer-events-none opacity-60 space-y-3' : 'space-y-3'}>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t('admin.autoRewardsTwitchOnlyHint', {
            defaultValue: 'Twitch-only: channel points mapping. Stored in the same auto-rewards JSON.',
          })}
        </div>
        {channelPointsMappingBlock}
      </div>
    );
  }

  return (
    <div className={disabled ? 'pointer-events-none opacity-60 space-y-3' : 'space-y-3'}>
      <div className="text-xs text-gray-500 dark:text-gray-400">
        {t('admin.autoRewardsSharedConfigHint', {
          defaultValue: 'Общая конфигурация: применяется там, где бэкенд поддерживает событие (Twitch/Kick/Trovo/VKVideo).',
        })}
      </div>

      {!hasAnyEnabled ? (
        <div className="rounded-xl bg-white/30 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 text-sm text-gray-700 dark:text-gray-200">
          {t('admin.autoRewardsAllDisabled', { defaultValue: 'Все автонаграды сейчас отключены. Включите нужные события ниже.' })}
        </div>
      ) : null}

      <details className="rounded-xl bg-white/30 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4" open>
        <summary className="cursor-pointer select-none font-semibold text-gray-900 dark:text-white">
          {t('admin.autoRewardsCore', { defaultValue: 'Основное' })}
        </summary>
        <div className="mt-3 space-y-4">
          {/* Follow */}
          <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="font-semibold text-gray-900 dark:text-white">{t('admin.autoRewardsFollow', { defaultValue: 'Фоллоу' })}</div>
                <PlatformBadges platforms={['TW', 'K', 'TR']} />
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={bool(v.follow?.enabled)}
                  aria-label="Enable follow auto reward"
                  disabled={disabled}
                  onChange={(e) => setEnabled('follow', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.autoRewardsCoins', { defaultValue: 'Монеты' })}
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label="Follow coins"
                  value={intOrEmpty(v.follow?.coins)}
                  onChange={(e) => {
                    const coins = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                    patch({ ...base(value), follow: { ...(base(value).follow ?? {}), coins } });
                  }}
                  placeholder="10"
                />
              </div>
              <div className="flex items-end gap-2">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={bool(v.follow?.onceEver)}
                    disabled={disabled}
                    onChange={(e) => patch({ ...base(value), follow: { ...(base(value).follow ?? {}), onceEver: e.target.checked } })}
                  />
                  {t('admin.autoRewardsOnceEver', { defaultValue: 'Один раз за всё время' })}
                </label>
              </div>
              <div className="flex items-end gap-2">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={bool(v.follow?.onlyWhenLive)}
                    disabled={disabled}
                    onChange={(e) => patch({ ...base(value), follow: { ...(base(value).follow ?? {}), onlyWhenLive: e.target.checked } })}
                  />
                  {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
                </label>
              </div>
            </div>
          </div>

          {/* Raid */}
          <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="font-semibold text-gray-900 dark:text-white">{t('admin.autoRewardsRaid', { defaultValue: 'Рейд' })}</div>
                <PlatformBadges platforms={['TW', 'TR']} />
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={bool(v.raid?.enabled)}
                  aria-label="Enable raid auto reward"
                  disabled={disabled}
                  onChange={(e) => setEnabled('raid', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">Base coins</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={intOrEmpty(v.raid?.baseCoins)}
                  onChange={(e) => {
                    const baseCoins = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                    patch({ ...base(value), raid: { ...(base(value).raid ?? {}), baseCoins } });
                  }}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">Coins / viewer</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={intOrEmpty(v.raid?.coinsPerViewer)}
                  onChange={(e) => {
                    const coinsPerViewer = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                    patch({ ...base(value), raid: { ...(base(value).raid ?? {}), coinsPerViewer } });
                  }}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">Min viewers</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={intOrEmpty(v.raid?.minViewers)}
                  onChange={(e) => {
                    const minViewers = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                    patch({ ...base(value), raid: { ...(base(value).raid ?? {}), minViewers } });
                  }}
                  placeholder="0"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={bool(v.raid?.onlyWhenLive)}
                    disabled={disabled}
                    onChange={(e) => patch({ ...base(value), raid: { ...(base(value).raid ?? {}), onlyWhenLive: e.target.checked } })}
                  />
                  {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
                </label>
              </div>
            </div>
          </div>

          {/* Chat: first message */}
          <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="font-semibold text-gray-900 dark:text-white">
                  {t('admin.autoRewardsChatFirstMessage', { defaultValue: 'Чат: первое сообщение' })}
                </div>
                <PlatformBadges platforms={['TW', 'K', 'TR', 'VK']} />
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={bool(v.chat?.firstMessage?.enabled)}
                  aria-label="Enable chat first message auto reward"
                  disabled={disabled}
                  onChange={(e) => setEnabled('chatFirstMessage', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                  {t('admin.autoRewardsCoins', { defaultValue: 'Монеты' })}
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={intOrEmpty(v.chat?.firstMessage?.coins)}
                  onChange={(e) => {
                    const coins = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                    patch({ ...base(value), chat: { ...(base(value).chat ?? {}), firstMessage: { ...(base(value).chat?.firstMessage ?? {}), coins } } });
                  }}
                  placeholder="0"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={bool(v.chat?.firstMessage?.onlyWhenLive)}
                    disabled={disabled}
                    onChange={(e) =>
                      patch({
                        ...base(value),
                        chat: {
                          ...(base(value).chat ?? {}),
                          firstMessage: { ...(base(value).chat?.firstMessage ?? {}), onlyWhenLive: e.target.checked },
                        },
                      })
                    }
                  />
                  {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
                </label>
              </div>
            </div>
          </div>
        </div>
      </details>

      <details className="rounded-xl bg-white/30 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
        <summary className="cursor-pointer select-none font-semibold text-gray-900 dark:text-white">
          {t('admin.autoRewardsAdvanced', { defaultValue: 'Расширенное' })}
        </summary>
        <div className="mt-3 space-y-4">
          {/* Channel points mapping */}
          {showChannelPoints ? channelPointsMappingBlock : null}

          {/* Subscribe/resub/gift */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-white">{t('admin.autoRewardsSubscribe', { defaultValue: 'Подписка' })}</div>
                  <PlatformBadges platforms={['TW', 'K', 'TR']} />
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={bool(v.subscribe?.enabled)}
                    aria-label="Enable subscribe auto reward"
                    disabled={disabled}
                    onChange={(e) => setEnabled('subscribe', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                    {t('admin.autoRewardsPrimeCoins', { defaultValue: 'Prime монеты' })}
                  </label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={intOrEmpty(v.subscribe?.primeCoins)}
                    onChange={(e) => {
                      const primeCoins = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                      patch({ ...base(value), subscribe: { ...(base(value).subscribe ?? {}), primeCoins } });
                    }}
                    placeholder="0"
                  />
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={bool(v.subscribe?.onlyWhenLive)}
                      disabled={disabled}
                      onChange={(e) => patch({ ...base(value), subscribe: { ...(base(value).subscribe ?? {}), onlyWhenLive: e.target.checked } })}
                    />
                    {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
                  </label>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t('admin.autoRewardsTierCoinsHint', { defaultValue: 'tierCoins: tierKey → coins (ключи задаёт бэкенд)' })}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="glass-btn bg-white/40 dark:bg-white/5"
                  onClick={() => {
                    markDirty();
                    setSubscribeTierRows((p) => [...p, { key: '', value: '' }]);
                  }}
                >
                  {t('admin.autoRewardsAdd', { defaultValue: 'Добавить' })}
                </Button>
              </div>
              <div className="space-y-2">
                {subscribeTierRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-end">
                    <Input
                      type="text"
                      value={row.key}
                      onChange={(e) => {
                        const key = e.target.value;
                        markDirty();
                        setSubscribeTierRows((p) => p.map((r, i) => (i === idx ? { ...r, key } : r)));
                      }}
                      placeholder="T1"
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={row.value}
                      onChange={(e) => {
                        const valueStr = e.target.value.replace(/[^\d]/g, '');
                        markDirty();
                        setSubscribeTierRows((p) => p.map((r, i) => (i === idx ? { ...r, value: valueStr } : r)));
                      }}
                      placeholder="0"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="glass-btn bg-white/40 dark:bg-white/5"
                      onClick={() => {
                        markDirty();
                        setSubscribeTierRows((p) => p.filter((_, i) => i !== idx));
                      }}
                    >
                      {t('admin.autoRewardsRemove', { defaultValue: 'Удалить' })}
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={() => patch({ ...base(value), subscribe: { ...(base(value).subscribe ?? {}), tierCoins: recordFromRows(subscribeTierRows) } })}
              >
                {t('admin.autoRewardsApplyTierCoins', { defaultValue: 'Применить tierCoins' })}
              </Button>
            </div>

            <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-white">{t('admin.autoRewardsResubMessage', { defaultValue: 'Сообщение о продлении' })}</div>
                  <PlatformBadges platforms={['TW', 'K']} />
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={bool(v.resubMessage?.enabled)}
                    aria-label="Enable resub message auto reward"
                    disabled={disabled}
                    onChange={(e) => setEnabled('resubMessage', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                    {t('admin.autoRewardsPrimeCoins', { defaultValue: 'Prime монеты' })}
                  </label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={intOrEmpty(v.resubMessage?.primeCoins)}
                    onChange={(e) => {
                      const primeCoins = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                      patch({ ...base(value), resubMessage: { ...(base(value).resubMessage ?? {}), primeCoins } });
                    }}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                    {t('admin.autoRewardsBonusCoins', { defaultValue: 'Бонусные монеты' })}
                  </label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={intOrEmpty(v.resubMessage?.bonusCoins)}
                    onChange={(e) => {
                      const bonusCoins = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                      patch({ ...base(value), resubMessage: { ...(base(value).resubMessage ?? {}), bonusCoins } });
                    }}
                    placeholder="0"
                  />
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={bool(v.resubMessage?.onlyWhenLive)}
                      disabled={disabled}
                      onChange={(e) => patch({ ...base(value), resubMessage: { ...(base(value).resubMessage ?? {}), onlyWhenLive: e.target.checked } })}
                    />
                    {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
                  </label>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t('admin.autoRewardsTierCoinsShortHint', { defaultValue: 'tierCoins: tierKey → coins' })}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="glass-btn bg-white/40 dark:bg-white/5"
                  onClick={() => {
                    markDirty();
                    setResubTierRows((p) => [...p, { key: '', value: '' }]);
                  }}
                >
                  {t('admin.autoRewardsAdd', { defaultValue: 'Добавить' })}
                </Button>
              </div>
              <div className="space-y-2">
                {resubTierRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-end">
                    <Input
                      type="text"
                      value={row.key}
                      onChange={(e) => {
                        const key = e.target.value;
                        markDirty();
                        setResubTierRows((p) => p.map((r, i) => (i === idx ? { ...r, key } : r)));
                      }}
                      placeholder="T1"
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={row.value}
                      onChange={(e) => {
                        const valueStr = e.target.value.replace(/[^\d]/g, '');
                        markDirty();
                        setResubTierRows((p) => p.map((r, i) => (i === idx ? { ...r, value: valueStr } : r)));
                      }}
                      placeholder="0"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="glass-btn bg-white/40 dark:bg-white/5"
                      onClick={() => {
                        markDirty();
                        setResubTierRows((p) => p.filter((_, i) => i !== idx));
                      }}
                    >
                      {t('admin.autoRewardsRemove', { defaultValue: 'Удалить' })}
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={() => patch({ ...base(value), resubMessage: { ...(base(value).resubMessage ?? {}), tierCoins: recordFromRows(resubTierRows) } })}
              >
                {t('admin.autoRewardsApplyTierCoins', { defaultValue: 'Применить tierCoins' })}
              </Button>
            </div>
          </div>

          {/* Gift sub + Cheer */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-white">{t('admin.autoRewardsGiftSubs', { defaultValue: 'Подарочные подписки' })}</div>
                  <PlatformBadges platforms={['TW', 'K', 'TR']} />
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={bool(v.giftSub?.enabled)}
                    aria-label="Enable gift subs auto reward"
                    disabled={disabled}
                    onChange={(e) => setEnabled('giftSub', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                    {t('admin.autoRewardsRecipientCoins', { defaultValue: 'Монеты получателю' })}
                  </label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={intOrEmpty(v.giftSub?.recipientCoins)}
                    onChange={(e) => {
                      const recipientCoins = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                      patch({ ...base(value), giftSub: { ...(base(value).giftSub ?? {}), recipientCoins } });
                    }}
                    placeholder="0"
                  />
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={bool(v.giftSub?.onlyWhenLive)}
                      disabled={disabled}
                      onChange={(e) => patch({ ...base(value), giftSub: { ...(base(value).giftSub ?? {}), onlyWhenLive: e.target.checked } })}
                    />
                    {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
                  </label>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t('admin.autoRewardsGiverTierCoinsHint', { defaultValue: 'giverTierCoins: tierKey → coins' })}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="glass-btn bg-white/40 dark:bg-white/5"
                  onClick={() => {
                    markDirty();
                    setGiftGiverTierRows((p) => [...p, { key: '', value: '' }]);
                  }}
                >
                  {t('admin.autoRewardsAdd', { defaultValue: 'Добавить' })}
                </Button>
              </div>
              <div className="space-y-2">
                {giftGiverTierRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-end">
                    <Input
                      type="text"
                      value={row.key}
                      onChange={(e) => {
                        const key = e.target.value;
                        markDirty();
                        setGiftGiverTierRows((p) => p.map((r, i) => (i === idx ? { ...r, key } : r)));
                      }}
                      placeholder="T1"
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={row.value}
                      onChange={(e) => {
                        const valueStr = e.target.value.replace(/[^\d]/g, '');
                        markDirty();
                        setGiftGiverTierRows((p) => p.map((r, i) => (i === idx ? { ...r, value: valueStr } : r)));
                      }}
                      placeholder="0"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="glass-btn bg-white/40 dark:bg-white/5"
                      onClick={() => {
                        markDirty();
                        setGiftGiverTierRows((p) => p.filter((_, i) => i !== idx));
                      }}
                    >
                      {t('admin.autoRewardsRemove', { defaultValue: 'Удалить' })}
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={() => patch({ ...base(value), giftSub: { ...(base(value).giftSub ?? {}), giverTierCoins: recordFromRows(giftGiverTierRows) } })}
              >
                {t('admin.autoRewardsApplyGiverTierCoins', { defaultValue: 'Применить giverTierCoins' })}
              </Button>
            </div>

            <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {t('admin.autoRewardsCheer', { defaultValue: 'Cheer / подарки (bits/kicks)' })}
                  </div>
                  <PlatformBadges platforms={['TW', 'K']} />
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={bool(v.cheer?.enabled)}
                    aria-label="Enable cheer auto reward"
                    disabled={disabled}
                    onChange={(e) => setEnabled('cheer', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">bitsPerCoin</label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={intOrEmpty(v.cheer?.bitsPerCoin)}
                    onChange={(e) => {
                      const bitsPerCoin = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                      patch({ ...base(value), cheer: { ...(base(value).cheer ?? {}), bitsPerCoin } });
                    }}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">minBits</label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={intOrEmpty(v.cheer?.minBits)}
                    onChange={(e) => {
                      const minBits = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                      patch({ ...base(value), cheer: { ...(base(value).cheer ?? {}), minBits } });
                    }}
                    placeholder="0"
                  />
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={bool(v.cheer?.onlyWhenLive)}
                      disabled={disabled}
                      onChange={(e) => patch({ ...base(value), cheer: { ...(base(value).cheer ?? {}), onlyWhenLive: e.target.checked } })}
                    />
                    {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
                    {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
                    {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Chat thresholds + daily streak */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {t('admin.autoRewardsChatThresholds', { defaultValue: 'Чат: пороги сообщений' })}
                  </div>
                  <PlatformBadges platforms={['TW', 'K', 'TR', 'VK']} />
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={bool(v.chat?.messageThresholds?.enabled)}
                    aria-label="Enable chat message thresholds auto reward"
                    disabled={disabled}
                    onChange={(e) => setEnabled('chatThresholds', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                </label>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t('admin.autoRewardsChatThresholdsHint', {
                  defaultValue: 'coinsByThreshold: threshold → coins. (thresholds вычисляется из ключей.)',
                })}
              </div>
              <div className="flex items-center justify-between gap-2">
                <div />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="glass-btn bg-white/40 dark:bg-white/5"
                  onClick={() => {
                    markDirty();
                    setThresholdCoinsRows((p) => [...p, { key: '', value: '' }]);
                  }}
                >
                  {t('admin.autoRewardsAdd', { defaultValue: 'Добавить' })}
                </Button>
              </div>
              <div className="space-y-2">
                {thresholdCoinsRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-end">
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={row.key}
                      onChange={(e) => {
                        const key = e.target.value.replace(/[^\d]/g, '');
                        markDirty();
                        setThresholdCoinsRows((p) => p.map((r, i) => (i === idx ? { ...r, key } : r)));
                      }}
                      placeholder="messages"
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={row.value}
                      onChange={(e) => {
                        const valueStr = e.target.value.replace(/[^\d]/g, '');
                        markDirty();
                        setThresholdCoinsRows((p) => p.map((r, i) => (i === idx ? { ...r, value: valueStr } : r)));
                      }}
                      placeholder="coins"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="glass-btn bg-white/40 dark:bg-white/5"
                      onClick={() => {
                        markDirty();
                        setThresholdCoinsRows((p) => p.filter((_, i) => i !== idx));
                      }}
                    >
                      {t('admin.autoRewardsRemove', { defaultValue: 'Удалить' })}
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={bool(v.chat?.messageThresholds?.onlyWhenLive)}
                    disabled={disabled}
                    onChange={(e) =>
                      patch({
                        ...base(value),
                        chat: { ...(base(value).chat ?? {}), messageThresholds: { ...(base(value).chat?.messageThresholds ?? {}), onlyWhenLive: e.target.checked } },
                      })
                    }
                  />
                  {t('admin.autoRewardsOnlyWhenLive', { defaultValue: 'Только когда стрим в онлайне' })}
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    const coinsByThreshold = recordFromRows(thresholdCoinsRows);
                    const thresholds = Object.keys(coinsByThreshold)
                      .map((x) => Number.parseInt(x, 10))
                      .filter((n) => Number.isFinite(n) && n > 0)
                      .sort((a, b) => a - b);

                    patch({
                      ...base(value),
                      chat: {
                        ...(base(value).chat ?? {}),
                        messageThresholds: {
                          ...(base(value).chat?.messageThresholds ?? {}),
                          thresholds,
                          coinsByThreshold,
                        },
                      },
                    });
                  }}
                >
                  {t('admin.autoRewardsApplyThresholds', { defaultValue: 'Применить thresholds' })}
                </Button>
              </div>
            </div>

            <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-white">{t('admin.autoRewardsChatDailyStreak', { defaultValue: 'Чат: ежедневная серия' })}</div>
                  <PlatformBadges platforms={['TW', 'K', 'TR', 'VK']} />
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={bool(v.chat?.dailyStreak?.enabled)}
                    aria-label="Enable chat daily streak auto reward"
                    disabled={disabled}
                    onChange={(e) => setEnabled('chatDailyStreak', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                </label>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">coinsPerDay</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={intOrEmpty(v.chat?.dailyStreak?.coinsPerDay)}
                  onChange={(e) => {
                    const coinsPerDay = Number.parseInt(e.target.value.replace(/[^\d]/g, '') || '0', 10) || 0;
                    patch({
                      ...base(value),
                      chat: { ...(base(value).chat ?? {}), dailyStreak: { ...(base(value).chat?.dailyStreak ?? {}), coinsPerDay } },
                    });
                  }}
                  placeholder="0"
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t('admin.autoRewardsChatDailyStreakHint', { defaultValue: 'coinsByStreak: streakDay → coins' })}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="glass-btn bg-white/40 dark:bg-white/5"
                  onClick={() => {
                    markDirty();
                    setDailyStreakRows((p) => [...p, { key: '', value: '' }]);
                  }}
                >
                  {t('admin.autoRewardsAdd', { defaultValue: 'Добавить' })}
                </Button>
              </div>

              <div className="space-y-2">
                {dailyStreakRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-end">
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={row.key}
                      onChange={(e) => {
                        const key = e.target.value.replace(/[^\d]/g, '');
                        markDirty();
                        setDailyStreakRows((p) => p.map((r, i) => (i === idx ? { ...r, key } : r)));
                      }}
                      placeholder="day"
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={row.value}
                      onChange={(e) => {
                        const valueStr = e.target.value.replace(/[^\d]/g, '');
                        markDirty();
                        setDailyStreakRows((p) => p.map((r, i) => (i === idx ? { ...r, value: valueStr } : r)));
                      }}
                      placeholder="coins"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="glass-btn bg-white/40 dark:bg-white/5"
                      onClick={() => {
                        markDirty();
                        setDailyStreakRows((p) => p.filter((_, i) => i !== idx));
                      }}
                    >
                      {t('admin.autoRewardsRemove', { defaultValue: 'Удалить' })}
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={() => {
                  patch({
                    ...base(value),
                    chat: {
                      ...(base(value).chat ?? {}),
                      dailyStreak: { ...(base(value).chat?.dailyStreak ?? {}), coinsByStreak: recordFromRows(dailyStreakRows) },
                    },
                  });
                }}
              >
                {t('admin.autoRewardsApplyCoinsByStreak', { defaultValue: 'Применить coinsByStreak' })}
              </Button>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}


