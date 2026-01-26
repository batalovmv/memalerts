import { Pill, type PillSize } from './Pill/Pill';

import type { SubmissionAiDecision, SubmissionAiStatus } from '@memalerts/api-contracts';

export type AiStatusBadgeProps = {
  decision?: SubmissionAiDecision | null;
  status?: SubmissionAiStatus | null;
  statusLabel?: string | null;
  size?: PillSize;
  decisionTitle?: string;
  statusTitle?: string;
};

export function AiStatusBadge({
  decision,
  status,
  statusLabel,
  size = 'sm',
  decisionTitle,
  statusTitle,
}: AiStatusBadgeProps) {
  if (!decision && !status) return null;

  const decisionVariant = decision === 'low' ? 'success' : decision === 'medium' ? 'warning' : decision === 'high' ? 'danger' : 'neutral';
  const statusVariant =
    status === 'done'
      ? 'success'
      : status === 'pending' || status === 'processing'
        ? 'primary'
        : status === 'failed' || status === 'failed_final'
          ? 'danger'
          : 'neutral';
  const resolvedStatusLabel = typeof statusLabel === 'string' ? statusLabel : status;

  return (
    <>
      {decision ? (
        <Pill variant={decisionVariant} size={size} title={decisionTitle}>
          AI: {decision}
        </Pill>
      ) : null}
      {status ? (
        <Pill variant={statusVariant} size={size} title={statusTitle}>
          AI {resolvedStatusLabel}
        </Pill>
      ) : null}
    </>
  );
}

