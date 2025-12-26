import { useState } from 'react';

import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { parseNeedsChangesPayload } from '../lib/parseNeedsChangesPayload';
import type { MySubmission } from '../types';

import TagInput from '@/components/TagInput';
import { api } from '@/lib/api';
import { AttemptsPill } from '@/shared/ui/AttemptsPill';
import { Button, Input, Spinner, Textarea, Pill } from '@/shared/ui';

export function NeedsChangesSubmissionCard(props: { submission: MySubmission; onUpdated: () => void }) {
  const { submission, onUpdated } = props;
  const { t } = useTranslation();
  const [title, setTitle] = useState(submission.title);
  const [notes, setNotes] = useState(submission.notes || '');
  const [tags, setTags] = useState<string[]>(submission.tags || []);
  const [saving, setSaving] = useState(false);

  const revision = Math.max(0, Math.min(2, Number(submission.revision ?? 0) || 0));
  const maxResubmits = 2;
  const left = Math.max(0, maxResubmits - revision);

  const parsed = parseNeedsChangesPayload(submission.moderatorNotes);
  const codes = parsed?.codes || [];
  const message = parsed?.message || '';

  const codeToText = (code: string): string => {
    if (code === 'no_tags') return t('submissions.reasonNoTagsUser', { defaultValue: 'Add tags' });
    if (code === 'bad_title') return t('submissions.reasonBadTitleUser', { defaultValue: 'Fix the title' });
    if (code === 'other') return t('submissions.reasonOtherUser', { defaultValue: 'Other changes' });
    return code;
  };

  const canResubmit = left > 0 && title.trim().length > 0 && !saving;

  return (
    <article className="border border-amber-200 dark:border-amber-800 rounded-lg p-4 bg-amber-50/50 dark:bg-amber-900/10">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 dark:text-white truncate">{submission.title}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{new Date(submission.createdAt).toLocaleString()}</div>
        </div>
        <Pill variant="warning">{t('submissions.statusNeedsChanges', { defaultValue: 'needs changes' })}</Pill>
      </header>

      <section className="mt-3 text-sm text-gray-700 dark:text-gray-300" aria-label={t('submissions.changesRequested', { defaultValue: 'Changes requested' })}>
        <div className="font-semibold mb-1">{t('submissions.changesRequested', { defaultValue: 'Changes requested' })}</div>
        {codes.length > 0 && (
          <ul className="list-disc pl-5 text-gray-600 dark:text-gray-400">
            {codes.map((c) => (
              <li key={c}>{codeToText(c)}</li>
            ))}
          </ul>
        )}
        {message && <div className="mt-2 text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{message}</div>}
        {!parsed && submission.moderatorNotes?.trim() && (
          <div className="mt-2 text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{submission.moderatorNotes}</div>
        )}
        <div className="mt-2">
          <AttemptsPill left={left} max={maxResubmits} />
        </div>
      </section>

      <form className="mt-4 grid grid-cols-1 gap-3" onSubmit={(e) => e.preventDefault()} aria-label={t('submissions.fixAndResubmit', { defaultValue: 'Fix & resubmit' })}>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            {t('submit.titleLabel', { defaultValue: 'Title' })}
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            {t('submit.tags', { defaultValue: 'Tags (optional)' })}
          </label>
          <TagInput
            tags={tags}
            onChange={(next) => setTags(next)}
            placeholder={t('submit.addTags', { defaultValue: 'Add tags to help categorize your meme...' })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            {t('submit.notes', { defaultValue: 'Notes (optional)' })}
          </label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>

        <div className="mt-1 flex gap-2">
          <Button
            type="button"
            disabled={!canResubmit}
            onClick={async () => {
              if (!canResubmit) return;
              setSaving(true);
              try {
                await api.post(`/submissions/${submission.id}/resubmit`, {
                  title: title.trim(),
                  notes: notes.trim() ? notes.trim() : null,
                  tags,
                });
                toast.success(t('submissions.resubmitted', { defaultValue: 'Resubmitted.' }));
                onUpdated();
              } catch {
                toast.error(t('submissions.failedToResubmit', { defaultValue: 'Failed to resubmit.' }));
              } finally {
                setSaving(false);
              }
            }}
            variant="primary"
          >
            {saving ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="h-4 w-4 border-white/40 border-t-white" />
                {t('common.loading', { defaultValue: 'Loading…' })}
              </span>
            ) : (
              t('submissions.fixAndResubmit', { defaultValue: 'Fix & resubmit' })
            )}
          </Button>
        </div>
      </form>
    </article>
  );
}




