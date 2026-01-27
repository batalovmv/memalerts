import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { VoteSession } from '@memalerts/api-contracts';

import { Button, Spinner } from '@/shared/ui';

type StreamerProfileVoteProps = {
  session: VoteSession | null;
  myVoteIndex: number | null;
  loading: boolean;
  voting: boolean;
  creating: boolean;
  closing: boolean;
  isOwner: boolean;
  isAuthed: boolean;
  onVote: (index: number) => void;
  onCreate: () => void;
  onClose: () => void;
  onRequireAuth: () => void;
};

function formatTimeLeft(endsAt?: string | null): string {
  if (!endsAt) return '';
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return '';
  const diff = Math.max(0, Math.floor((end - Date.now()) / 1000));
  if (diff <= 0) return '0s';
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function StreamerProfileVote({
  session,
  myVoteIndex,
  loading,
  voting,
  creating,
  closing,
  isOwner,
  isAuthed,
  onVote,
  onCreate,
  onClose,
  onRequireAuth,
}: StreamerProfileVoteProps) {
  const { t } = useTranslation();

  const timeLeft = useMemo(() => formatTimeLeft(session?.endsAt ?? null), [session?.endsAt]);
  const isActive = session?.status === 'active';
  const winnerIndex = session?.winnerIndex ?? null;

  return (
    <section className="rounded-xl border border-white/10 bg-white/70 dark:bg-white/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('vote.title', { defaultValue: 'Vote for best meme' })}
          </div>
          {session ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {isActive
                ? t('vote.active', { defaultValue: 'Vote is live' })
                : t('vote.ended', { defaultValue: 'Vote ended' })}
              {timeLeft && isActive ? ` · ${t('vote.endsIn', { defaultValue: 'Ends in {{time}}', time: timeLeft })}` : ''}
            </div>
          ) : (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('vote.none', { defaultValue: 'No active vote' })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isOwner ? (
            session?.status === 'active' ? (
              <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={closing}>
                {closing ? t('vote.closing', { defaultValue: 'Closing…' }) : t('vote.close', { defaultValue: 'Close vote' })}
              </Button>
            ) : (
              <Button type="button" size="sm" variant="primary" onClick={onCreate} disabled={creating}>
                {creating ? t('vote.creating', { defaultValue: 'Starting…' }) : t('vote.start', { defaultValue: 'Start vote' })}
              </Button>
            )
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Spinner className="h-3 w-3" />
          {t('vote.loading', { defaultValue: 'Loading vote…' })}
        </div>
      ) : session ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {session.options.map((option) => {
            const isWinner = winnerIndex === option.index;
            const isSelected = myVoteIndex === option.index;
            return (
              <button
                key={option.index}
                type="button"
                className={[
                  'group relative overflow-hidden rounded-xl border p-3 text-left transition',
                  isWinner ? 'border-emerald-400/70 bg-emerald-50/60 dark:bg-emerald-500/10' : 'border-white/10 bg-white/60 dark:bg-white/5',
                  isSelected ? 'ring-2 ring-primary/60' : 'hover:border-primary/40',
                ].join(' ')}
                onClick={() => {
                  if (!isAuthed) {
                    onRequireAuth();
                    return;
                  }
                  if (!isActive || voting || isSelected) return;
                  onVote(option.index);
                }}
                disabled={!isActive || voting}
              >
                {option.previewUrl ? (
                  <div className="aspect-video w-full overflow-hidden rounded-lg bg-black/40">
                    <img
                      src={option.previewUrl}
                      alt={option.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div className="aspect-video w-full rounded-lg bg-black/20" />
                )}
                <div className="mt-2 text-sm font-semibold text-gray-900 dark:text-white truncate">
                  {option.title}
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('vote.votes', { defaultValue: '{{count}} votes', count: option.totalVotes })}
                </div>
                {isWinner ? (
                  <div className="absolute top-2 right-2 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                    {t('vote.winner', { defaultValue: 'Winner' })}
                  </div>
                ) : null}
                {isSelected ? (
                  <div className="absolute bottom-2 right-2 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                    {t('vote.yourPick', { defaultValue: 'Your pick' })}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {!session && !isOwner ? (
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {t('vote.wait', { defaultValue: 'The streamer will start a vote when ready.' })}
        </div>
      ) : null}
    </section>
  );
}
