import type { Server } from 'socket.io';
import { emitSubmissionEvent, relaySubmissionEventToPeer } from '../../realtime/submissionBridge.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../../realtime/walletBridge.js';
import { logger } from '../../utils/logger.js';
import { getErrorMessage } from './submissionShared.js';
import { TransactionEventBuffer } from '../../utils/transactionEventBuffer.js';

export function enqueueSubmissionApprovedEvent(opts: {
  io: Server;
  eventBuffer: TransactionEventBuffer;
  submissionId: string;
  channelId: string;
  channelSlug: string | null;
  moderatorId?: string | null;
}): void {
  const { io, eventBuffer, submissionId, channelId, channelSlug, moderatorId } = opts;
  if (!channelSlug) return;
  const evt = {
    event: 'submission:approved' as const,
    submissionId,
    channelId,
    channelSlug,
    moderatorId: moderatorId || undefined,
    userIds: moderatorId ? [moderatorId] : undefined,
    source: 'local' as const,
  };
  eventBuffer.add(() => {
    try {
      emitSubmissionEvent(io, evt);
      void relaySubmissionEventToPeer(evt);
    } catch (error) {
      logger.error('admin.submissions.emit_approved_failed', { errorMessage: getErrorMessage(error) });
    }
  });
}

export function enqueueWalletRewardEvent(opts: {
  io: Server;
  eventBuffer: TransactionEventBuffer;
  event: {
    userId: string;
    channelId: string;
    balance: number;
    delta: number;
    reason: string;
    channelSlug?: string | null;
  };
}): void {
  const { io, eventBuffer, event } = opts;
  eventBuffer.add(() => {
    try {
      emitWalletUpdated(io, event);
      void relayWalletUpdatedToPeer(event);
    } catch (err) {
      logger.error('admin.submissions.emit_wallet_reward_failed', { errorMessage: getErrorMessage(err) });
    }
  });
}
