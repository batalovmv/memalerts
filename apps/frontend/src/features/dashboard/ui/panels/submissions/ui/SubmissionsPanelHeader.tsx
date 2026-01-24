import { useTranslation } from 'react-i18next';

import type { SubmissionsPanelTab } from '@/features/dashboard/ui/panels/submissions/model/types';

import { PanelHeader } from '@/features/dashboard/ui/PanelHeader';
import { Pill, Spinner, Tooltip } from '@/shared/ui';

type SubmissionsPanelHeaderProps = {
  activeTab: SubmissionsPanelTab;
  pendingCount: number;
  myCount: number;
  submissionsLoading: boolean;
  mySubmissionsLoading: boolean;
  onTabChange: (tab: SubmissionsPanelTab) => void;
  onClose: () => void;
};

type TabButtonProps = {
  tab: SubmissionsPanelTab;
  label: string;
  count?: number;
  busy?: boolean;
  emphasis?: 'primary' | 'secondary';
  activeTab: SubmissionsPanelTab;
  onTabChange: (tab: SubmissionsPanelTab) => void;
};

function TabButton({ tab, label, count, busy, emphasis = 'primary', activeTab, onTabChange }: TabButtonProps) {
  const active = activeTab === tab;
  return (
    <button
      type="button"
      onClick={() => onTabChange(tab)}
      className={[
        'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
        emphasis === 'secondary'
          ? active
            ? 'bg-black/5 dark:bg-white/10 text-gray-900 dark:text-white'
            : 'text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10'
          : active
            ? 'bg-primary/10 text-primary'
            : 'text-gray-700 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10',
      ].join(' ')}
      aria-pressed={active}
    >
      <span>{label}</span>
      {busy ? <Spinner className="h-4 w-4" /> : null}
      {typeof count === 'number' && count > 0 ? (
        <Pill variant={tab === 'pending' ? 'danger' : 'neutral'} size="sm">
          {count}
        </Pill>
      ) : null}
    </button>
  );
}

export function SubmissionsPanelHeader({
  activeTab,
  pendingCount,
  myCount,
  submissionsLoading,
  mySubmissionsLoading,
  onTabChange,
  onClose,
}: SubmissionsPanelHeaderProps) {
  const { t } = useTranslation();

  return (
    <PanelHeader
      title={t('dashboard.submissionsPanel.title', { defaultValue: 'Submissions' })}
      meta={
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <TabButton
              tab="pending"
              label={t('dashboard.submissionsPanel.pendingTab', { defaultValue: 'Pending approvals' })}
              count={pendingCount}
              busy={activeTab === 'pending' && submissionsLoading}
              activeTab={activeTab}
              onTabChange={onTabChange}
            />
            <TabButton
              tab="mine"
              label={t('dashboard.submissionsPanel.myTab', { defaultValue: 'My submissions' })}
              count={myCount}
              busy={activeTab === 'mine' && mySubmissionsLoading}
              activeTab={activeTab}
              onTabChange={onTabChange}
            />
          </div>
          <Tooltip
            delayMs={300}
            content={
              <div className="text-xs text-gray-800 dark:text-gray-100 space-y-1">
                <div className="font-semibold">{t('dashboard.hotkeys.title', { defaultValue: 'Hotkeys' })}</div>
                <div>Enter — {t('dashboard.hotkeys.approve', { defaultValue: 'Approve focused' })}</div>
                <div>Backspace / Del — {t('dashboard.hotkeys.reject', { defaultValue: 'Reject focused' })}</div>
                <div>N — {t('dashboard.hotkeys.needsChanges', { defaultValue: 'Needs changes (notes)' })}</div>
                <div>←/→ — {t('dashboard.hotkeys.prev', { defaultValue: 'Previous / next item' })}</div>
                <div>Space — {t('dashboard.hotkeys.preview', { defaultValue: 'Play / pause preview' })}</div>
                <div>Esc — {t('dashboard.hotkeys.close', { defaultValue: 'Close modal' })}</div>
                <div>? — {t('dashboard.hotkeys.help', { defaultValue: 'Show hotkeys' })}</div>
              </div>
            }
          >
            <button
              type="button"
              className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-600 dark:text-gray-300 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
              aria-label={t('dashboard.hotkeys.title', { defaultValue: 'Hotkeys' })}
            >
              ?
            </button>
          </Tooltip>
        </div>
      }
      onClose={onClose}
    />
  );
}
