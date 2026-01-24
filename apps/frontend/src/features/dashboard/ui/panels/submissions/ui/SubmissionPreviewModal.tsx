import { useTranslation } from 'react-i18next';

import type { SubmissionPreviewState } from '@/features/dashboard/ui/panels/submissions/model/types';
import type { User } from '@/types';

import { canViewSubmissionAiDescription } from '@/shared/lib/permissions';
import { IconButton, Modal, Pill } from '@/shared/ui';

type SubmissionPreviewModalProps = {
  aiEnabled: boolean;
  previewModal: SubmissionPreviewState;
  user: User | null;
  onClose: () => void;
};

export function SubmissionPreviewModal({ aiEnabled, previewModal, user, onClose }: SubmissionPreviewModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={previewModal.open}
      onClose={onClose}
      ariaLabel={t('submissions.preview', { defaultValue: 'Submission preview' })}
      contentClassName="max-w-4xl"
    >
      <div className="p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-bold dark:text-white truncate">
              {previewModal.title || t('submissions.preview', { defaultValue: 'Preview' })}
            </div>
          </div>
          <IconButton
            type="button"
            variant="secondary"
            aria-label={t('common.close', { defaultValue: 'Close' })}
            onClick={onClose}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            }
          />
        </div>

        <div className="mt-4 rounded-xl overflow-hidden bg-black/90 ring-1 ring-black/10 dark:ring-white/10">
          <video src={previewModal.src} controls autoPlay playsInline className="w-full max-h-[70vh] object-contain" />
        </div>

        {(() => {
          const s = previewModal.submission;
          if (!s || !aiEnabled) return null;
          const aiStatus = s.aiStatus ?? null;
          const aiAutoTags = Array.isArray(s.aiAutoTagNamesJson) ? s.aiAutoTagNamesJson.filter((x) => typeof x === 'string') : [];
          const aiAutoDescription = typeof s.aiAutoDescription === 'string' ? s.aiAutoDescription : '';
          const canSeeAiDescription = canViewSubmissionAiDescription(user);
          const showProcessing = aiStatus && aiStatus !== 'done' && aiAutoTags.length === 0 && !aiAutoDescription;

          if (!aiStatus && aiAutoTags.length === 0 && !aiAutoDescription) return null;

          return (
            <section className="mt-4 rounded-xl bg-black/5 dark:bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-bold text-gray-900 dark:text-white">AI</div>
                {aiStatus ? (
                  <Pill
                    variant={
                      aiStatus === 'done' ? 'success' : aiStatus === 'failed' || aiStatus === 'failed_final' ? 'danger' : 'primary'
                    }
                    size="sm"
                  >
                    AI {aiStatus}
                  </Pill>
                ) : null}
              </div>

              {showProcessing ? (
                <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                  {t('submissions.aiProcessing', { defaultValue: 'AI: в обработке…' })}
                </div>
              ) : null}

              {aiAutoTags.length > 0 ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {t('submissions.aiAutoTags', { defaultValue: 'AI теги' })}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {aiAutoTags.slice(0, 40).map((tag) => (
                      <Pill key={tag} variant="primary" size="sm">
                        {tag}
                      </Pill>
                    ))}
                    {aiAutoTags.length > 40 ? (
                      <Pill variant="neutral" size="sm">
                        +{aiAutoTags.length - 40}
                      </Pill>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {aiAutoDescription && canSeeAiDescription ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {t('submissions.aiAutoDescription', { defaultValue: 'AI описание' })}
                  </div>
                  <div className="mt-1 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{aiAutoDescription}</div>
                </div>
              ) : null}
            </section>
          );
        })()}
      </div>
    </Modal>
  );
}
