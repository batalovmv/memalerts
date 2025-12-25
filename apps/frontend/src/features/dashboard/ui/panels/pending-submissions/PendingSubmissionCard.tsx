import { useTranslation } from 'react-i18next';

import { getResubmitsLeft } from './lib/resubmits';
import { useSubmissionPreview } from './model/useSubmissionPreview';
import { SubmissionPreview } from './ui/SubmissionPreview';

import type { Submission } from '@/types';
import { AttemptsPill } from '@/shared/ui';

export function PendingSubmissionCard(props: {
  submission: Submission;
  resolveMediaUrl: (src: string) => string;
  onApprove: (id: string) => void;
  onNeedsChanges: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const { submission, resolveMediaUrl, onApprove, onNeedsChanges, onReject } = props;
  const { t } = useTranslation();

  const src = resolveMediaUrl(submission.fileUrlTemp || '');
  const { resubmitsLeft, maxResubmits, canSendForChanges } = getResubmitsLeft(submission.revision, 2);
  const preview = useSubmissionPreview(src);

  return (
    <li ref={preview.cardRef}>
      <article className="glass p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="shrink-0 w-full lg:w-[249px]">
            <SubmissionPreview
              src={src}
              shouldLoad={preview.shouldLoad}
              aspectRatio={preview.aspectRatio}
              isPlaying={preview.isPlaying}
              isMuted={preview.isMuted}
              videoRef={preview.videoRef}
              onPlayPause={() => void preview.togglePlay()}
              onToggleMute={() => preview.setIsMuted((v) => !v)}
              onPlay={() => preview.setIsPlaying(true)}
              onPause={() => preview.setIsPlaying(false)}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-lg dark:text-white truncate">{submission.title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {t('dashboard.submittedBy', {
                    defaultValue: 'Submitted by {{name}}',
                    name: submission.submitter?.displayName || 'Unknown',
                  })}
                </p>
                <div className="mt-2">
                  <AttemptsPill left={resubmitsLeft} max={maxResubmits} />
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onApprove(submission.id)}
                  className="glass-btn bg-emerald-500/90 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl font-semibold"
                >
                  {t('admin.approve', 'Approve')}
                </button>
                <button
                  type="button"
                  onClick={() => onNeedsChanges(submission.id)}
                  disabled={!canSendForChanges}
                  className={`glass-btn px-4 py-2 rounded-xl font-semibold ${
                    canSendForChanges
                      ? 'bg-amber-500/90 hover:bg-amber-500 text-white'
                      : 'bg-gray-300 dark:bg-gray-700 text-gray-600 dark:text-gray-300 opacity-60 cursor-not-allowed'
                  }`}
                  title={
                    canSendForChanges
                      ? t('submissions.needsChanges', { defaultValue: 'Needs changes' })
                      : t('submissions.noResubmitsLeftHint', { defaultValue: 'No resubmits left — reject instead.' })
                  }
                >
                  {t('submissions.needsChanges', { defaultValue: 'Needs changes' })}
                </button>
                <button
                  type="button"
                  onClick={() => onReject(submission.id)}
                  className="glass-btn bg-rose-500/85 hover:bg-rose-500 text-white px-4 py-2 rounded-xl font-semibold"
                >
                  {t('admin.reject', 'Reject')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}


