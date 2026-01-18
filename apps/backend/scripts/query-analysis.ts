import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/prisma.js';

type ExplainCase = {
  name: string;
  sql: string;
  params: Array<string | number>;
};

async function resolvePerfIds() {
  const channelIdEnv = String(process.env.PERF_CHANNEL_ID || '').trim();
  const userIdEnv = String(process.env.PERF_USER_ID || '').trim();

  const channelId =
    channelIdEnv || (await prisma.channel.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }))?.id || '';
  const userId =
    userIdEnv || (await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }))?.id || '';

  return { channelId, userId };
}

async function runExplain(caseDef: ExplainCase, explainPrefix: string) {
  const query = `${explainPrefix} ${caseDef.sql}`;
  const result = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(query, ...caseDef.params);
  return result;
}

async function main() {
  const analyze = String(process.env.EXPLAIN_ANALYZE || '').trim() === '1';
  const explainPrefix = analyze ? 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)' : 'EXPLAIN (FORMAT JSON)';

  const { channelId, userId } = await resolvePerfIds();
  if (!channelId || !userId) {
    throw new Error('Missing PERF_CHANNEL_ID or PERF_USER_ID (and unable to auto-detect).');
  }

  const cases: ExplainCase[] = [
    {
      name: 'Streamer moderation pending submissions',
      sql: 'SELECT * FROM "MemeSubmission" WHERE "channelId" = $1 AND "status" = $2 ORDER BY "createdAt" DESC, "id" DESC LIMIT 51',
      params: [channelId, 'pending'],
    },
    {
      name: 'Viewer submissions list',
      sql: 'SELECT * FROM "MemeSubmission" WHERE "submitterUserId" = $1 ORDER BY "createdAt" DESC, "id" DESC LIMIT 51',
      params: [userId],
    },
    {
      name: 'Channel meme library (approved)',
      sql: 'SELECT * FROM "ChannelMeme" WHERE "channelId" = $1 AND "status" = $2 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC, "id" DESC LIMIT 51',
      params: [channelId, 'approved'],
    },
  ];

  const out: Array<{ name: string; sql: string; params: Array<string | number>; result: unknown }> = [];

  for (const c of cases) {
    const result = await runExplain(c, explainPrefix);
    out.push({ name: c.name, sql: c.sql, params: c.params, result });
  }

  const lines: string[] = [];
  lines.push('# Query Analysis (EXPLAIN)');
  lines.push('');
  lines.push(`Mode: ${analyze ? 'EXPLAIN ANALYZE' : 'EXPLAIN (no analyze)'}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  for (const entry of out) {
    lines.push(`## ${entry.name}`);
    lines.push('');
    lines.push('SQL:');
    lines.push('```sql');
    lines.push(entry.sql);
    lines.push('```');
    lines.push('');
    lines.push('Params:');
    lines.push('```json');
    lines.push(JSON.stringify(entry.params, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('Plan:');
    lines.push('```json');
    lines.push(JSON.stringify(entry.result, null, 2));
    lines.push('```');
    lines.push('');
  }

  const outputPath = path.join('docs', 'QUERY_ANALYSIS.md');
  await fs.writeFile(outputPath, lines.join('\n'));
  console.log(`Wrote ${outputPath}`);
}

main()
  .catch((err) => {
    console.error('Query analysis failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
