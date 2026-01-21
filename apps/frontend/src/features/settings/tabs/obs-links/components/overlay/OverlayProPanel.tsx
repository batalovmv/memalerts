import { OverlayProGlassSender } from './OverlayProGlassSender';
import { OverlayProLayoutAnimation } from './OverlayProLayoutAnimation';
import { OverlayProShadowBorder } from './OverlayProShadowBorder';

import type { ObsLinkFormState } from '../../hooks/useObsLinkForm';
import type { OverlayPreviewState } from '../../hooks/useOverlayPreview';


type OverlayProPanelProps = {
  overlayForm: ObsLinkFormState;
  preview: OverlayPreviewState;
};

export function OverlayProPanel({ overlayForm, preview }: OverlayProPanelProps) {
  const { obsUiMode } = overlayForm;
  return (
    <div className={obsUiMode === 'pro' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'hidden'}>
      <OverlayProLayoutAnimation overlayForm={overlayForm} preview={preview} />
      <OverlayProShadowBorder overlayForm={overlayForm} />
      <OverlayProGlassSender overlayForm={overlayForm} />
    </div>
  );
}
