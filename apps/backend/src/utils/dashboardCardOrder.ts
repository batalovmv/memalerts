export const DASHBOARD_CARD_IDS = ['submit', 'pending', 'memes', 'settings', 'submissionsControl', 'bots'] as const;

export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number];

export const DEFAULT_DASHBOARD_CARD_ORDER: DashboardCardId[] = [...DASHBOARD_CARD_IDS];

// Future-proof: allow growth without schema/API changes.
export const MAX_DASHBOARD_CARD_ORDER_LENGTH = 50;

/**
 * Normalizes a dashboard card order array:
 * - keeps only whitelisted ids
 * - removes duplicates (keeps first occurrence)
 * - appends missing ids in default order
 * - caps to MAX_DASHBOARD_CARD_ORDER_LENGTH (future-proof)
 */
export function normalizeDashboardCardOrder(input: unknown): DashboardCardId[] {
  const allowed = new Set<string>(DASHBOARD_CARD_IDS);
  const seen = new Set<string>();
  const out: DashboardCardId[] = [];

  if (Array.isArray(input)) {
    for (const raw of input) {
      if (out.length >= MAX_DASHBOARD_CARD_ORDER_LENGTH) break;
      if (typeof raw !== 'string') continue;
      if (!allowed.has(raw)) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      out.push(raw as DashboardCardId);
    }
  }

  for (const id of DEFAULT_DASHBOARD_CARD_ORDER) {
    if (out.length >= MAX_DASHBOARD_CARD_ORDER_LENGTH) break;
    if (!seen.has(id)) out.push(id);
  }

  return out;
}
