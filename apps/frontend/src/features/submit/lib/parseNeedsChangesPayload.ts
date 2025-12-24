export function parseNeedsChangesPayload(
  raw: string | null | undefined
): { codes: string[]; message: string } | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const j = JSON.parse(s) as unknown;
    if (!j || typeof j !== 'object') return null;
    const obj = j as { codes?: unknown; message?: unknown };
    const codes = Array.isArray(obj.codes) ? obj.codes.map((c) => String(c || '').trim()).filter(Boolean) : [];
    const message = String(obj.message || '').trim();
    return { codes, message };
  } catch {
    return null;
  }
}



