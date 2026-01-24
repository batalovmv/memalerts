import { useTranslation } from 'react-i18next';

import { HelpTooltip, Input } from '@/shared/ui';

type SubmitImportPanelProps = {
  sourceUrl: string;
  onSourceUrlChange: (next: string) => void;
  importLoading: boolean;
};

export function SubmitImportPanel({ sourceUrl, onSourceUrlChange, importLoading }: SubmitImportPanelProps) {
  const { t } = useTranslation();

  return (
    <div role="tabpanel" id="submit-modal-panel-import" aria-labelledby="submit-modal-tab-import">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('submit.memalertsUrl')}</label>
      <HelpTooltip content={t('help.submitModal.url', { defaultValue: 'Paste a direct link to the media file from Memealerts (cdns.memealerts.com).' })}>
        <Input
          key="submit-import-url"
          type="url"
          value={sourceUrl || ''}
          onChange={(e) => onSourceUrlChange(e.target.value)}
          required
          placeholder={t('submit.memalertsUrlPlaceholder', { defaultValue: 'https://cdns.memealerts.com/.../alert_orig.webm' })}
          disabled={importLoading}
        />
      </HelpTooltip>
      <div className="mt-2 p-3 bg-accent/10 rounded-xl ring-1 ring-accent/20">
        <p className="text-sm text-gray-700 dark:text-gray-300 font-medium mb-1">{t('submit.howToCopy')}</p>
        <ol className="text-sm text-gray-600 dark:text-gray-400 list-decimal list-inside space-y-1">
          {(t('submit.copyInstructions', { returnObjects: true }) as string[]).map((instruction: string, index: number) => (
            <li key={index}>{instruction}</li>
          ))}
        </ol>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          {t('submit.memalertsUrlExample', { defaultValue: 'Example: https://cdns.memealerts.com/p/.../alert_orig.webm' })}
        </p>
      </div>
    </div>
  );
}
