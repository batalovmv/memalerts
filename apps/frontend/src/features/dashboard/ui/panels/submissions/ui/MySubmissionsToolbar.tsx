import { useTranslation } from 'react-i18next';

import { IconButton, Tooltip } from '@/shared/ui';

type MySubmissionsToolbarProps = {
  helpEnabled?: boolean;
  mySubmissionsLoading: boolean;
  onRefreshMySubmissions: () => void;
};

function RefreshIcon(props: { spinning?: boolean }) {
  const { spinning } = props;
  return (
    <svg className={`w-5 h-5 ${spinning ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006.34 6.34M4 15a8 8 0 0013.66 2.66" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12a9 9 0 1018 0 9 9 0 00-18 0z" />
    </svg>
  );
}

function ChannelIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function MySubmissionsToolbar({ helpEnabled, mySubmissionsLoading, onRefreshMySubmissions }: MySubmissionsToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-end gap-2">
      {helpEnabled ? (
        <Tooltip
          delayMs={1000}
          content={t('dashboard.help.refreshMySubmissions', {
            defaultValue: 'Refresh the list of your submissions (use if the list looks outdated).',
          })}
        >
          <IconButton
            type="button"
            variant="secondary"
            onClick={onRefreshMySubmissions}
            disabled={mySubmissionsLoading}
            aria-label={t('common.retry', { defaultValue: 'Повторить' })}
            icon={<RefreshIcon spinning={mySubmissionsLoading} />}
          />
        </Tooltip>
      ) : (
        <IconButton
          type="button"
          variant="secondary"
          onClick={onRefreshMySubmissions}
          disabled={mySubmissionsLoading}
          aria-label={t('common.retry', { defaultValue: 'Повторить' })}
          icon={<RefreshIcon spinning={mySubmissionsLoading} />}
        />
      )}

      {helpEnabled ? (
        <Tooltip
          delayMs={1000}
          content={t('dashboard.help.historyComingSoon', { defaultValue: 'Submission history will appear here later (coming soon).' })}
        >
          <span className="inline-flex">
            <IconButton
              type="button"
              variant="secondary"
              disabled={true}
              aria-label={t('dashboard.submissionsPanel.historyTab', { defaultValue: 'История' })}
              icon={<HistoryIcon />}
            />
          </span>
        </Tooltip>
      ) : (
        <IconButton
          type="button"
          variant="secondary"
          disabled={true}
          aria-label={t('dashboard.submissionsPanel.historyTab', { defaultValue: 'История' })}
          icon={<HistoryIcon />}
        />
      )}

      {helpEnabled ? (
        <Tooltip
          delayMs={1000}
          content={t('dashboard.help.channelTabComingSoon', {
            defaultValue: 'A dedicated “channel submissions” view will appear here later (coming soon).',
          })}
        >
          <span className="inline-flex">
            <IconButton
              type="button"
              variant="secondary"
              disabled={true}
              aria-label={t('dashboard.submissionsPanel.channelTab', { defaultValue: 'Заявки канала' })}
              icon={<ChannelIcon />}
            />
          </span>
        </Tooltip>
      ) : (
        <IconButton
          type="button"
          variant="secondary"
          disabled={true}
          aria-label={t('dashboard.submissionsPanel.channelTab', { defaultValue: 'Заявки канала' })}
          icon={<ChannelIcon />}
        />
      )}
    </div>
  );
}
