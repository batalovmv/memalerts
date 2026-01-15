import { http, HttpResponse } from 'msw';
import tokenFixture from '../fixtures/discord/token.json';
import userFixture from '../fixtures/discord/user.json';
import guildMemberFixture from '../fixtures/discord/guild_member.json';

export const discordHandlers = [
  http.post('https://discord.com/api/oauth2/token', () => HttpResponse.json(tokenFixture)),
  http.get('https://discord.com/api/users/@me', () => HttpResponse.json(userFixture)),
  http.get('https://discord.com/api/guilds/:guildId/members/:userId', () => HttpResponse.json(guildMemberFixture)),
  http.put('https://discord.com/api/guilds/:guildId/members/:userId', () => new HttpResponse(null, { status: 204 })),
];
