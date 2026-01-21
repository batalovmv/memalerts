import { useEffect, useMemo, useState } from 'react';

import { useBotIntegrations } from './useBotIntegrations';
import { useBotOutbox } from './useBotOutbox';
import { useBotOverrides } from './useBotOverrides';
import { useBotSubscription } from './useBotSubscription';

import { useAppSelector } from '@/store/hooks';

export const useBotSettings = () => {
  const { user } = useAppSelector((s) => s.auth);
  const externalAccounts = useMemo(() => (Array.isArray(user?.externalAccounts) ? user.externalAccounts : []), [user]);
  const linkedProviders = useMemo(
    () => new Set(externalAccounts.map((a) => String((a as { provider?: unknown })?.provider || '').toLowerCase()).filter(Boolean)),
    [externalAccounts]
  );

  const twitchLinked = user?.channel?.twitchChannelId !== null && user?.channel?.twitchChannelId !== undefined ? true : linkedProviders.has('twitch');
  const youtubeLinked = linkedProviders.has('youtube');
  const vkvideoLinked = linkedProviders.has('vkvideo');
  const trovoLinked = linkedProviders.has('trovo');
  const kickLinked = linkedProviders.has('kick');

  const [botTab, setBotTab] = useState<'commands' | 'twitch' | 'youtube' | 'vk' | 'trovo' | 'kick'>('commands');
  const [menusOpen, setMenusOpen] = useState(true);

  useEffect(() => {
    const sub = window.location.pathname.replace(/^\/settings\/?/, '');
    const parts = sub.split('/').filter(Boolean);
    if (parts[0] !== 'bot') return;
    const provider = (parts[1] || '').toLowerCase();
    if (provider === 'youtube') setBotTab('youtube');
    else if (provider === 'vk' || provider === 'vkvideo') setBotTab('vk');
    else if (provider === 'twitch') setBotTab('twitch');
    else if (provider === 'trovo') setBotTab('trovo');
    else if (provider === 'kick') setBotTab('kick');
  }, []);

  const subscription = useBotSubscription({ twitchLinked });
  const integrations = useBotIntegrations();
  const overrides = useBotOverrides({ botTab });
  const outbox = useBotOutbox();

  return {
    botTab,
    setBotTab,
    menusOpen,
    setMenusOpen,
    twitchLinked,
    youtubeLinked,
    vkvideoLinked,
    trovoLinked,
    kickLinked,
    ...subscription,
    ...integrations,
    ...overrides,
    ...outbox,
  };
};

export type UseBotSettingsResult = ReturnType<typeof useBotSettings>;
