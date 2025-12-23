export function getResubmitsLeft(
  revisionRaw: unknown,
  maxResubmits = 2,
): {
  revision: number;
  maxResubmits: number;
  resubmitsLeft: number;
  canSendForChanges: boolean;
} {
  const revision = Math.max(0, Math.min(999, Number(revisionRaw ?? 0) || 0));
  const max = Math.max(0, Math.min(999, Number(maxResubmits) || 0));
  const resubmitsLeft = Math.max(0, max - revision);
  return {
    revision,
    maxResubmits: max,
    resubmitsLeft,
    canSendForChanges: resubmitsLeft > 0,
  };
}


