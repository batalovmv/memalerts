import type { OAuthProvider } from './types.js';
import { discordOAuthProvider } from './providers/discord.js';
import { kickOAuthProvider } from './providers/kick.js';
import { trovoOAuthProvider } from './providers/trovo.js';
import { twitchOAuthProvider } from './providers/twitch.js';
import { vkOAuthProvider } from './providers/vk.js';
import { vkVideoOAuthProvider } from './providers/vkvideo.js';
import { youtubeOAuthProvider } from './providers/youtube.js';

const providers: OAuthProvider[] = [
  twitchOAuthProvider,
  youtubeOAuthProvider,
  vkOAuthProvider,
  vkVideoOAuthProvider,
  trovoOAuthProvider,
  kickOAuthProvider,
  discordOAuthProvider,
];

const providerById = new Map<string, OAuthProvider>();
const aliasToProvider = new Map<string, OAuthProvider>();

for (const provider of providers) {
  providerById.set(provider.id, provider);
  if (provider.aliases) {
    for (const alias of provider.aliases) {
      aliasToProvider.set(alias, provider);
    }
  }
}

export function resolveOAuthProvider(input: string): OAuthProvider | null {
  const key = String(input || '').trim().toLowerCase();
  if (!key) return null;
  return providerById.get(key) ?? aliasToProvider.get(key) ?? null;
}
