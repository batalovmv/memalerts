import type { Request } from 'express';
import crypto from 'crypto';
import { fetchKickPublicKeyPem } from '../utils/kickWebhookSecurity.js';
import { asRecord, getHeader, parseTimestampMs } from './kickWebhookShared.js';

export function getKickEventType(req: Request, payload: unknown): string {
  const headerType = getHeader(req, 'Kick-Event-Type') || getHeader(req, 'kick-event-type');
  const payloadRec = asRecord(payload);
  const kind = String(payloadRec.type ?? payloadRec.event ?? payloadRec.event_type ?? payloadRec.name ?? '').trim();
  return String(headerType || kind || '')
    .trim()
    .toLowerCase();
}

export async function verifyKickSignature(params: {
  req: Request;
  rawBody: string;
}): Promise<{ ok: boolean; reason: string }> {
  const signatureB64 = getHeader(params.req, 'Kick-Event-Signature') || getHeader(params.req, 'kick-event-signature');
  const messageId = getHeader(params.req, 'Kick-Event-Message-Id') || getHeader(params.req, 'kick-event-message-id');
  const messageTimestamp =
    getHeader(params.req, 'Kick-Event-Message-Timestamp') ||
    getHeader(params.req, 'kick-event-message-timestamp') ||
    // Back-compat with older integrations:
    getHeader(params.req, 'Kick-Event-Timestamp') ||
    getHeader(params.req, 'kick-event-timestamp');

  if (!signatureB64) return { ok: false, reason: 'missing_signature' };
  if (!messageId || !messageTimestamp) return { ok: false, reason: 'missing_signature_headers' };

  const ts = parseTimestampMs(messageTimestamp);
  if (!ts) return { ok: false, reason: 'invalid_timestamp' };
  const windowMs = (() => {
    const raw = Number(process.env.KICK_WEBHOOK_REPLAY_WINDOW_MS ?? 10 * 60 * 1000);
    return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60 * 1000;
  })();
  if (Math.abs(Date.now() - ts) > windowMs) return { ok: false, reason: 'request_too_old' };

  const pem = await fetchKickPublicKeyPem();
  if (!pem) return { ok: false, reason: 'public_key_unavailable' };

  const signatureBuf = (() => {
    try {
      return Buffer.from(signatureB64, 'base64');
    } catch {
      return null;
    }
  })();
  if (!signatureBuf || signatureBuf.length === 0) return { ok: false, reason: 'invalid_signature_encoding' };

  // Kick webhook signature (RSA-SHA256, PKCS#1 v1.5): messageId.timestamp.rawBody
  const message = `${messageId}.${messageTimestamp}.${params.rawBody}`;
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(message, 'utf8'),
    { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
    signatureBuf
  );
  if (!ok) return { ok: false, reason: 'invalid_signature' };
  return { ok: true, reason: 'ok' };
}
