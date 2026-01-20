import type { ReactElement, ReactNode } from 'react';

import { useHelpMode } from '@/contexts/HelpModeContext';
import { Tooltip } from '@/shared/ui/Tooltip/Tooltip';

export function HelpTooltip(props: { content: ReactNode; delayMs?: number; children: ReactElement }) {
  const { enabled } = useHelpMode();
  if (!enabled) return props.children;
  return (
    <Tooltip delayMs={props.delayMs ?? 1000} content={props.content}>
      {props.children}
    </Tooltip>
  );
}


