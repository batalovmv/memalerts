import { useTranslation } from 'react-i18next';

import { getResubmitsLeft } from './lib/resubmits';
import { useSubmissionPreview } from './model/useSubmissionPreview';
import { SubmissionPreview } from './ui/SubmissionPreview';

import type { Submission } from '@/types';

import { AttemptsPill, Button } from '@/shared/ui';

export function PendingSubmissionCard(props: {
  submission: Submission;
  resolveMediaUrl: (src: string) => string;
  onOpenPreview: (data: { src: string; title: string }) => void;
  onApprove: (id: string) => void;
  onNeedsChanges: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const { submission, resolveMediaUrl, onOpenPreview, onApprove, onNeedsChanges, onReject } = props;
  const { t } = useTranslation();

  // Submissions can come from multiple sources:
  // - upload: fileUrlTemp is populated
  // - import: sourceUrl (and often fileUrlTemp) is populated
  // - pool: backend should provide at least one of them; otherwise preview is impossible
  const src = resolveMediaUrl(submission.fileUrlTemp || submission.sourceUrl || '');
  const { resubmitsLeft, maxResubmits, canSendForChanges } = getResubmitsLeft(submission.revision, 2);
  const preview = useSubmissionPreview(src);

  return (
    <li ref={preview.cardRef}>
      <article className="glass p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="shrink-0 w-full lg:w-[249px]">
            <div className="relative">
              <button
                type="button"
                className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                onClick={() => onOpenPreview({ src, title: submission.title })}
                aria-label={t('submissions.openPreview', { defaultValue: 'Open preview' })}
                title={t('submissions.openPreview', { defaultValue: 'Open preview' })}
              />
              <div className="pointer-events-none">
                <SubmissionPreview
                  src={src}
                  shouldLoad={preview.shouldLoad}
                  aspectRatio={preview.aspectRatio}
                  isPlaying={preview.isPlaying}
                  isMuted={preview.isMuted}
                  error={preview.error}
                  playError={preview.playError}
                  httpStatus={preview.httpStatus}
                  videoRef={preview.videoRef}
                  onPlayPause={() => void preview.togglePlay()}
                  onToggleMute={() => preview.setIsMuted((v) => !v)}
                  onPlay={() => preview.setIsPlaying(true)}
                  onPause={() => preview.setIsPlaying(false)}
                  onError={preview.onVideoError}
                />
              </div>
            </div>
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
                <Button
                  type="button"
                  variant="success"
                  size="sm"
                  className="glass-btn"
                  onClick={() => onApprove(submission.id)}
                >
                  {t('admin.approve', { defaultValue: 'Approve' })}
                </Button>
                <Button
                  type="button"
                  variant="warning"
                  size="sm"
                  className="glass-btn"
                  onClick={() => onNeedsChanges(submission.id)}
                  disabled={!canSendForChanges}
                  title={
                    canSendForChanges
                      ? t('submissions.needsChanges', { defaultValue: 'Needs changes' })
                      : t('submissions.noResubmitsLeftHint', { defaultValue: 'No resubmits left — reject instead.' })
                  }
                >
                  {t('submissions.needsChanges', { defaultValue: 'Needs changes' })}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  className="glass-btn"
                  onClick={() => onReject(submission.id)}
                >
                  {t('admin.reject', { defaultValue: 'Reject' })}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}


