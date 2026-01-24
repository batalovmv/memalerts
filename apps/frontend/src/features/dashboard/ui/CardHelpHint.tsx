import { useTranslation } from 'react-i18next';

import { Tooltip } from '@/shared/ui';

type CardHelpHintProps = {
  enabled: boolean;
  text: string;
};

export function CardHelpHint({ enabled, text }: CardHelpHintProps) {
  const { t } = useTranslation();
  if (!enabled) return null;
  return (
    <Tooltip delayMs={1000} content={text}>
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-500 dark:text-gray-300 bg-black/5 dark:bg-white/10"
        aria-label={t('dashboard.help.cardHint', { defaultValue: 'Help' })}
        role="img"
      >
        ?
      </span>
    </Tooltip>
  );
}
