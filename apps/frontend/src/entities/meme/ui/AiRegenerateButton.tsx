import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { getAiRegenerateCooldownUntilMs, setAiRegenerateCooldownUntilMs } from '../lib/aiRegenerateCooldown';

import type { Meme } from '@/types';

import { regenerateMemeAi, getErrorCodeFromError, getRetryAfterSecondsFromError } from '@/shared/api/streamerMemes';
import { isEffectivelyEmptyAiDescription } from '@/shared/lib/aiText';
import { getMemePrimaryId } from '@/shared/lib/memeIds';
import { Button } from '@/shared/ui';

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function getRegenerateKey(meme: Meme): string | null {
  const channelId = meme.channelId;
  if (!channelId) return null;
  const primaryId = getMemePrimaryId(meme);
  const assetId = meme.memeAssetId || null;
  return `${channelId}:${assetId || primaryId}`;
}

export type AiRegenerateButtonProps = {
  meme: Meme;
  /**
   * Parent-level gating (streamer/admin-only context). When false, renders nothing.
   */
  show?: boolean;
};

export function AiRegenerateButton({ meme, show = true }: AiRegenerateButtonProps) {
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);

  const key = useMemo(() => getRegenerateKey(meme), [meme]);
  // IMPORTANT: backend endpoint expects ChannelMeme.id (exposed as `channelMemeId` in DTOs).
  // `getMemePrimaryId` prefers `channelMemeId` when present, but may fall back for older backends.
  const primaryId = getMemePrimaryId(meme);
  const aiDescEffectivelyEmpty = useMemo(
    () => isEffectivelyEmptyAiDescription(meme.aiAutoDescription, meme.title),
    [meme.aiAutoDescription, meme.title],
  );

  const createdAtMs = useMemo(() => {
    if (!meme.createdAt) return null;
    const ms = Date.parse(meme.createdAt);
    return Number.isFinite(ms) ? ms : null;
  }, [meme.createdAt]);

  const ageGateUntilMs = useMemo(() => {
    if (!createdAtMs) return null;
    return createdAtMs + 5 * 60_000;
  }, [createdAtMs]);

  const cooldownUntilMs = useMemo(() => (key ? getAiRegenerateCooldownUntilMs(key) : null), [key]);
  const disabledUntilMs = useMemo(() => {
    const vals = [ageGateUntilMs, cooldownUntilMs].filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    if (vals.length === 0) return null;
    return Math.max(...vals);
  }, [ageGateUntilMs, cooldownUntilMs]);

  const remainingSeconds = disabledUntilMs && disabledUntilMs > now ? Math.ceil((disabledUntilMs - now) / 1000) : 0;
  const disabled = submitting || remainingSeconds > 0;

  // Best-effort countdown ticker (only while disabled by time).
  useEffect(() => {
    if (!disabledUntilMs) return;
    if (disabledUntilMs <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [disabledUntilMs]);

  if (!show) return null;
  if (!key) return null;
  if (!aiDescEffectivelyEmpty) return null;

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={disabled}
      title={remainingSeconds > 0 ? `Доступно через ${formatCountdown(remainingSeconds)}` : undefined}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;

        setSubmitting(true);
        try {
          const resp = await regenerateMemeAi(primaryId);
          const dataObj = resp.data && typeof resp.data === 'object' ? (resp.data as Record<string, unknown>) : null;
          const retryAfterSeconds =
            typeof dataObj?.retryAfterSeconds === 'number' && Number.isFinite(dataObj.retryAfterSeconds) && dataObj.retryAfterSeconds > 0
              ? dataObj.retryAfterSeconds
              : 60;

          // Backend is source of truth; UI just avoids spam clicks.
          setAiRegenerateCooldownUntilMs(key, Date.now() + retryAfterSeconds * 1000);

          if (resp.meta.status === 202) {
            toast.success('В очереди');
          } else {
            toast.success('Запрос отправлен');
          }
        } catch (err) {
          const errorCode = getErrorCodeFromError(err);
          const retryAfterSeconds = getRetryAfterSecondsFromError(err);
          if (retryAfterSeconds && (errorCode === 'AI_REGENERATE_TOO_SOON' || errorCode === 'AI_REGENERATE_COOLDOWN')) {
            setAiRegenerateCooldownUntilMs(key, Date.now() + retryAfterSeconds * 1000);
            toast.error(`Слишком рано. Попробуйте через ${formatCountdown(retryAfterSeconds)}`);
          } else {
            toast.error('Не удалось запустить AI regenerate');
            // Other details go to the global API error banner.
          }
        } finally {
          setSubmitting(false);
          setNow(Date.now());
        }
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onTouchStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {remainingSeconds > 0 ? `AI regenerate (${formatCountdown(remainingSeconds)})` : 'AI regenerate'}
    </Button>
  );
}


