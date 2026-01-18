import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/prisma.js';

type IndexRow = {
  schemaname: string;
  table_name: string;
  index_name: string;
  idx_scan: number;
  index_size: string;
};

async function main() {
  const unusedIndexes = await prisma.$queryRawUnsafe<IndexRow[]>(`
    SELECT
      s.schemaname,
      s.relname AS table_name,
      s.indexrelname AS index_name,
      s.idx_scan,
      pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON i.indexrelid = s.indexrelid
    WHERE s.idx_scan = 0
      AND NOT i.indisprimary
    ORDER BY pg_relation_size(s.indexrelid) DESC;
  `);

  const lines: string[] = [];
  lines.push('# Index Audit');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Unused Indexes (idx_scan = 0)');
  lines.push('');

  if (!unusedIndexes.length) {
    lines.push('No unused indexes found (excluding primary keys).');
  } else {
    lines.push('| Schema | Table | Index | idx_scan | Size |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const row of unusedIndexes) {
      lines.push(
        `| ${row.schemaname} | ${row.table_name} | ${row.index_name} | ${row.idx_scan} | ${row.index_size} |`
      );
    }
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('- Validate with query logs before dropping any index.');
  lines.push('- Skip indexes that back unique constraints or foreign keys.');
  lines.push('');

  const outputPath = path.join('docs', 'INDEX_AUDIT.md');
  await fs.writeFile(outputPath, lines.join('\n'));
  console.log(`Wrote ${outputPath}`);
}

main()
  .catch((err) => {
    console.error('Index audit failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
