import { Server } from 'socket.io';

export type SubmissionEventType =
  | 'submission:created'
  | 'submission:approved'
  | 'submission:rejected'
  | 'submission:needs_changes'
  | 'submission:resubmitted';

export type SubmissionEvent = {
  event: SubmissionEventType;
  submissionId: string;
  channelId: string;
  channelSlug: string;
  submitterId?: string;
  moderatorId?: string;
  /**
   * Optional list of userIds to also emit into `user:{id}` rooms.
   * This mirrors existing behavior where we emit to channel rooms + streamer/moderator user room.
   */
  userIds?: string[];
  source?: 'local' | 'relay';
};

const INTERNAL_HEADER = 'x-memalerts-internal';
const INTERNAL_HEADER_VALUE = 'submission-event';

function getPeerBaseUrl(): string | null {
  const port = String(process.env.PORT || '3001');
  // Two-instance setup on same VPS: 3001 (prod), 3002 (beta)
  if (port === '3001') return 'http://127.0.0.1:3002';
  if (port === '3002') return 'http://127.0.0.1:3001';
  return null;
}

export function isInternalSubmissionRelayRequest(headers: Record<string, any>): boolean {
  const v = headers[INTERNAL_HEADER] || headers[INTERNAL_HEADER.toLowerCase()];
  return v === INTERNAL_HEADER_VALUE;
}

export function emitSubmissionEvent(io: Server, data: SubmissionEvent): void {
  const slug = String(data.channelSlug || '').trim().toLowerCase();
  if (slug) {
    const payload: any = {
      submissionId: data.submissionId,
      channelId: data.channelId,
    };
    if (data.submitterId) payload.submitterId = data.submitterId;
    if (data.moderatorId) payload.moderatorId = data.moderatorId;
    io.to(`channel:${slug}`).emit(data.event, payload);
  }

  if (Array.isArray(data.userIds)) {
    const payload: any = {
      submissionId: data.submissionId,
      channelId: data.channelId,
    };
    if (data.submitterId) payload.submitterId = data.submitterId;
    if (data.moderatorId) payload.moderatorId = data.moderatorId;

    for (const userId of data.userIds) {
      if (!userId) continue;
      io.to(`user:${userId}`).emit(data.event, payload);
    }
  }
}

export async function relaySubmissionEventToPeer(data: SubmissionEvent): Promise<void> {
  const peer = getPeerBaseUrl();
  if (!peer) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    await fetch(`${peer}/internal/submission-event`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [INTERNAL_HEADER]: INTERNAL_HEADER_VALUE,
      },
      body: JSON.stringify({ ...data, source: 'relay' }),
      signal: controller.signal,
    });
  } catch (err) {
    // Non-fatal: local emit already happened.
    console.warn('[submissionBridge] relay to peer failed (continuing):', (err as any)?.message || err);
  } finally {
    clearTimeout(timeout);
  }
}



