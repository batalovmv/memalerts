import fs from 'node:fs';
import path from 'node:path';

type Check = { name: string; predicate: (text: string) => boolean; hint: string };

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');

if (!fs.existsSync(schemaPath)) {
  fail(`[schema:check] Missing Prisma schema at: ${schemaPath}`);
}

const buf = fs.readFileSync(schemaPath);

// Defensive: we once had a broken schema with NUL bytes that caused Prisma tooling to behave unexpectedly.
if (buf.includes(0)) {
  fail(
    `[schema:check] prisma/schema.prisma contains NUL (\\0) bytes. This usually means the file got corrupted or saved with a wrong encoding. Revert the file and re-apply changes.`
  );
}

const text = buf.toString('utf8');

const required: Check[] = [
  {
    name: 'credits fields on Channel',
    predicate: (t) =>
      t.includes('creditsStyleJson') &&
      t.includes('creditsTokenVersion') &&
      t.includes('creditsReconnectWindowMinutes'),
    hint: 'Expected Channel to include credits overlay fields (creditsStyleJson/creditsTokenVersion/creditsReconnectWindowMinutes).',
  },
  {
    name: 'ChatBotSubscription model',
    predicate: (t) => t.includes('model ChatBotSubscription'),
    hint: 'Expected model ChatBotSubscription to exist (chatbot DB subscriptions).',
  },
  {
    name: 'chatBotSubscriptions relation on Channel',
    predicate: (t) => t.includes('chatBotSubscriptions') && t.includes('ChatBotSubscription[]'),
    hint: 'Expected Channel to have chatBotSubscriptions: ChatBotSubscription[].',
  },
  {
    name: 'rollup tables',
    predicate: (t) =>
      t.includes('model ChannelDailyStats') &&
      t.includes('model ChannelUserStats30d') &&
      t.includes('model ChannelMemeStats30d') &&
      t.includes('model ChannelMemeDailyStats'),
    hint: 'Expected rollup models (ChannelDailyStats, ChannelUserStats30d, ChannelMemeStats30d, ChannelMemeDailyStats).',
  },
];

const missing = required.filter((c) => !c.predicate(text));
if (missing.length > 0) {
  fail(
    [
      '[schema:check] prisma/schema.prisma is missing expected models/fields:',
      ...missing.map((m) => `- ${m.hint}`),
      '',
      'This will cause Prisma Client types to drift from the code and break builds.',
    ].join('\n')
  );
}

console.log('[schema:check] OK');
