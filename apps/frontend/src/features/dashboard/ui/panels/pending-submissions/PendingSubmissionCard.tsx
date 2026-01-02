import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getResubmitsLeft } from './lib/resubmits';
import { useSubmissionPreview } from './model/useSubmissionPreview';
import { SubmissionPreview } from './ui/SubmissionPreview';

import type { Submission } from '@/types';

import { canViewSubmissionAiDescription } from '@/shared/lib/permissions';
import { AttemptsPill, Button, Pill, Tooltip } from '@/shared/ui';
import { useAppSelector } from '@/store/hooks';

export function PendingSubmissionCard(props: {
  submission: Submission;
  resolveMediaUrl: (src: string) => string;
  onOpenPreview?: (data: { src: string; title: string }) => void;
  onApprove: (id: string) => void;
  onNeedsChanges: (id: string) => void;
  onReject: (id: string) => void;
  helpEnabled?: boolean;
}) {
  const { submission, resolveMediaUrl, onOpenPreview, onApprove, onNeedsChanges, onReject, helpEnabled } = props;
  const { t } = useTranslation();
  const { user } = useAppSelector((s) => s.auth);
  const [aiOpen, setAiOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  // Submissions can come from multiple sources:
  // - upload: fileUrlTemp is populated
  // - import: sourceUrl (and often fileUrlTemp) is populated
  // - pool: backend should provide at least one of them; otherwise preview is impossible
  const src = resolveMediaUrl(submission.fileUrlTemp || submission.sourceUrl || '');
  const { resubmitsLeft, maxResubmits, canSendForChanges } = getResubmitsLeft(submission.revision, 2);
  const preview = useSubmissionPreview(src);

  const aiDecision = submission.aiDecision ?? null;
  const aiStatus = submission.aiStatus ?? null;
  const aiRisk = typeof submission.aiRiskScore === 'number' && Number.isFinite(submission.aiRiskScore) ? submission.aiRiskScore : null;
  const aiLabels = Array.isArray(submission.aiLabelsJson) ? submission.aiLabelsJson.filter((x) => typeof x === 'string') : [];
  const aiAutoTags = Array.isArray(submission.aiAutoTagNamesJson) ? submission.aiAutoTagNamesJson.filter((x) => typeof x === 'string') : [];
  const aiAutoDescription = typeof submission.aiAutoDescription === 'string' ? submission.aiAutoDescription : '';
  const aiTranscript = typeof submission.aiTranscript === 'string' ? submission.aiTranscript : '';
  const aiError = typeof submission.aiError === 'string' ? submission.aiError : '';
  const canSeeAiDescription = canViewSubmissionAiDescription(user);

  const hasAi =
    !!aiDecision ||
    !!aiStatus ||
    aiRisk !== null ||
    aiLabels.length > 0 ||
    aiAutoTags.length > 0 ||
    !!aiAutoDescription ||
    !!aiTranscript ||
    !!aiError;

  const decisionVariant = aiDecision === 'low' ? 'success' : aiDecision === 'medium' ? 'warning' : aiDecision === 'high' ? 'danger' : 'neutral';
  const statusVariant =
    aiStatus === 'done' ? 'success' : aiStatus === 'pending' || aiStatus === 'processing' ? 'primary' : aiStatus === 'failed' || aiStatus === 'failed_final' ? 'danger' : 'neutral';
  const isLowConfidence = aiLabels.includes('low_confidence');

  return (
    <li ref={preview.cardRef}>
      <article className="glass p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="shrink-0 w-full lg:w-[249px]">
            <div className="relative">
              {onOpenPreview ? (
                helpEnabled ? (
                  <Tooltip
                    delayMs={1000}
                    content={t('dashboard.help.openPreview', { defaultValue: 'Open a larger preview.' })}
                  >
                    <button
                      type="button"
                      className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      onClick={() => onOpenPreview({ src, title: submission.title })}
                      aria-label={t('submissions.openPreview', { defaultValue: 'Open preview' })}
                    />
                  </Tooltip>
                ) : (
                  <button
                    type="button"
                    className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    onClick={() => onOpenPreview({ src, title: submission.title })}
                    aria-label={t('submissions.openPreview', { defaultValue: 'Open preview' })}
                  />
                )
              ) : null}
              <div className="pointer-events-none">
                <SubmissionPreview
                  src={src}
                  shouldLoad={preview.shouldLoad}
                  aspectRatio={preview.aspectRatio}
                  isPlaying={preview.isPlaying}
                  isMuted={preview.isMuted}
                  helpEnabled={helpEnabled}
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
                  <div className="flex flex-wrap items-center gap-2">
                    <AttemptsPill left={resubmitsLeft} max={maxResubmits} />
                    {aiDecision ? (
                      <Pill variant={decisionVariant} title={t('submissions.aiDecision', { defaultValue: 'AI decision' })}>
                        AI: {aiDecision}
                      </Pill>
                    ) : null}
                    {aiStatus ? (
                      <Pill variant={statusVariant} title={t('submissions.aiStatus', { defaultValue: 'AI status' })}>
                        AI {aiStatus}
                      </Pill>
                    ) : null}
                    {aiAutoTags.length > 0 ? (
                      <Pill variant="neutral" title={t('submissions.aiAutoTags', { defaultValue: 'AI теги' })}>
                        {t('submissions.aiTagsCount', { defaultValue: 'AI tags: {{count}}', count: aiAutoTags.length })}
                      </Pill>
                    ) : null}
                    {aiAutoDescription ? (
                      <Tooltip delayMs={300} content={t('submissions.aiAutoDescription', { defaultValue: 'AI описание' })}>
                        <span
                          className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-black/5 dark:bg-white/10 text-gray-700 dark:text-gray-200 ring-1 ring-black/10 dark:ring-white/10 text-xs font-bold"
                          aria-label={t('submissions.aiAutoDescription', { defaultValue: 'AI описание' })}
                        >
                          i
                        </span>
                      </Tooltip>
                    ) : null}
                    {isLowConfidence ? <Pill variant="warning">low confidence</Pill> : null}
                    {(aiStatus === 'failed' || aiStatus === 'failed_final') && aiError ? (
                      <Tooltip delayMs={300} content={aiError}>
                        <span
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20 text-xs font-bold"
                          aria-label={t('submissions.aiError', { defaultValue: 'AI error' })}
                        >
                          !
                        </span>
                      </Tooltip>
                    ) : null}
                  </div>
                  {aiDecision === 'high' ? (
                    <div className="mt-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
                      {t('submissions.aiHighApproveBlocked', { defaultValue: 'Approve будет заблокирован (карантин)' })}
                    </div>
                  ) : null}
                </div>

                {hasAi ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      className="text-xs font-semibold text-gray-700 dark:text-gray-200 hover:underline"
                      onClick={() => setAiOpen((v) => !v)}
                      aria-expanded={aiOpen}
                    >
                      {aiOpen
                        ? t('submissions.aiHide', { defaultValue: 'Скрыть AI анализ' })
                        : t('submissions.aiShow', { defaultValue: 'Показать AI анализ' })}
                    </button>

                    {aiOpen ? (
                      <div className="mt-2 rounded-lg bg-black/5 dark:bg-white/5 p-3 text-sm text-gray-800 dark:text-gray-200">
                        <div className="flex flex-wrap items-center gap-2">
                          {aiDecision ? <Pill variant={decisionVariant}>AI: {aiDecision}</Pill> : null}
                          {aiRisk !== null ? <Pill variant="neutral">risk: {aiRisk.toFixed(2)}</Pill> : null}
                        </div>

                        {aiStatus && aiStatus !== 'done' && aiLabels.length === 0 && aiAutoTags.length === 0 && !aiAutoDescription && !aiTranscript && !aiError ? (
                          <div className="mt-2 text-xs text-gray-700 dark:text-gray-300">
                            {t('submissions.aiProcessing', { defaultValue: 'AI: в обработке…' })}
                          </div>
                        ) : null}

                        {aiLabels.length > 0 ? (
                          <div className="mt-2">
                            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                              {t('submissions.aiLabels', { defaultValue: 'AI labels' })}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {aiLabels.slice(0, 12).map((lbl) => (
                                <Pill key={lbl} variant="neutral">
                                  {lbl}
                                </Pill>
                              ))}
                              {aiLabels.length > 12 ? <Pill variant="neutral">+{aiLabels.length - 12}</Pill> : null}
                            </div>
                          </div>
                        ) : null}

                        {aiAutoDescription && canSeeAiDescription ? (
                          <div className="mt-2">
                            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                              {t('submissions.aiAutoDescription', { defaultValue: 'AI описание' })}
                            </div>
                            <div className="mt-1 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{aiAutoDescription}</div>
                          </div>
                        ) : null}

                        {aiAutoTags.length > 0 ? (
                          <div className="mt-2">
                            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                              {t('submissions.aiAutoTags', { defaultValue: 'AI теги' })}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {aiAutoTags.slice(0, 20).map((tag) => (
                                <Pill key={tag} variant="primary">
                                  {tag}
                                </Pill>
                              ))}
                              {aiAutoTags.length > 20 ? <Pill variant="neutral">+{aiAutoTags.length - 20}</Pill> : null}
                            </div>
                          </div>
                        ) : null}

                        {aiTranscript ? (
                          <div className="mt-2">
                            <button
                              type="button"
                              className="text-xs font-semibold text-gray-700 dark:text-gray-200 hover:underline"
                              onClick={() => setTranscriptOpen((v) => !v)}
                              aria-expanded={transcriptOpen}
                            >
                              {transcriptOpen
                                ? t('submissions.aiHideTranscript', { defaultValue: 'Скрыть расшифровку' })
                                : t('submissions.aiShowTranscript', { defaultValue: 'Показать расшифровку' })}
                            </button>
                            {transcriptOpen ? (
                              <div className="mt-1 rounded-md bg-white/60 dark:bg-black/30 p-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-gray-700 dark:text-gray-200">
                                {aiTranscript}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {submission.aiModelVersionsJson && typeof submission.aiModelVersionsJson === 'object' ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-200">
                              {t('submissions.aiDebug', { defaultValue: 'Debug' })}
                            </summary>
                            <pre className="mt-1 rounded-md bg-white/60 dark:bg-black/30 p-2 max-h-48 overflow-auto text-[11px] leading-snug">
                              {JSON.stringify(submission.aiModelVersionsJson, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
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
                {(() => {
                  const btn = (
                    <Button
                      type="button"
                      variant="warning"
                      size="sm"
                      className="glass-btn"
                      onClick={() => onNeedsChanges(submission.id)}
                      disabled={!canSendForChanges}
                    >
                      {t('submissions.needsChanges', { defaultValue: 'Needs changes' })}
                    </Button>
                  );

                  if (!helpEnabled) return btn;

                  return (
                    <Tooltip
                      delayMs={1000}
                      content={
                        canSendForChanges
                          ? t('dashboard.help.needsChanges', {
                              defaultValue: 'Send back to the author to fix and resubmit.',
                            })
                          : t('dashboard.help.needsChangesDisabled', {
                              defaultValue: 'No resubmits left — reject instead.',
                            })
                      }
                    >
                      {btn}
                    </Tooltip>
                  );
                })()}
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


