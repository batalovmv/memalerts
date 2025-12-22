export async function ensureMinDuration(startTs: number, minMs: number) {
  const elapsed = Date.now() - startTs;
  const remaining = minMs - elapsed;
  if (remaining > 0) {
    await new Promise((r) => setTimeout(r, remaining));
  }
}


