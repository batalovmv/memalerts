import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';

import { LinksList } from './components/LinksList';
import { useObsLinks } from './hooks/useObsLinks';

const LinkEditor = lazy(() => import('./components/LinkEditor'));
const CreditsEditor = lazy(() => import('./components/CreditsEditor'));

export function ObsLinksSettings() {
  const { t } = useTranslation();
  const {
    overlayKind,
    setOverlayKind,
    creditsEnabled,
    overlayForm,
    overlaySettings,
    creditsSettings,
    creditsSession,
    preview,
    overlayUrlWithDefaults,
    creditsUrlWithDefaults,
  } = useObsLinks();

  const {
    overlayToken,
    loadingToken,
    rotatingOverlayToken,
    handleRotateOverlayToken,
  } = overlaySettings;
  const {
    creditsToken,
    loadingCreditsToken,
    rotatingCreditsToken,
    handleRotateCreditsToken,
  } = creditsSettings;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.obsLinksTitle', { defaultValue: 'OBS links' })}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        {t('admin.obsLinksDescription', { defaultValue: 'Copy the overlay link and paste it into OBS as a Browser Source. The overlay will show activated memes in real time.' })}
      </p>

      <div className="space-y-6">
        <LinksList
          overlayKind={overlayKind}
          setOverlayKind={setOverlayKind}
          creditsEnabled={creditsEnabled}
          overlayUrlWithDefaults={overlayUrlWithDefaults}
          creditsUrlWithDefaults={creditsUrlWithDefaults}
          overlayToken={overlayToken}
          creditsToken={creditsToken}
          loadingToken={loadingToken}
          loadingCreditsToken={loadingCreditsToken}
          rotatingOverlayToken={rotatingOverlayToken}
          rotatingCreditsToken={rotatingCreditsToken}
          onRotateOverlayToken={handleRotateOverlayToken}
          onRotateCreditsToken={handleRotateCreditsToken}
        />

        {overlayKind === 'memes' ? (
          <Suspense
            fallback={<div className="glass p-4 text-sm text-gray-700 dark:text-gray-200">{t('common.loading', { defaultValue: 'Loading:' })}</div>}
          >
            <LinkEditor overlayForm={overlayForm} overlaySettings={overlaySettings} preview={preview} />
          </Suspense>
        ) : (
          <Suspense
            fallback={<div className="glass p-4 text-sm text-gray-700 dark:text-gray-200">{t('common.loading', { defaultValue: 'Loading:' })}</div>}
          >
            <CreditsEditor creditsSettings={creditsSettings} creditsSession={creditsSession} preview={preview} />
          </Suspense>
        )}

        <div className="glass p-4">
          <div className="font-semibold text-gray-900 dark:text-white mb-2">
            {t('admin.obsHowToTitle', { defaultValue: 'How to add in OBS' })}
          </div>
          <ol className="list-decimal list-inside text-sm text-gray-700 dark:text-gray-200 space-y-1">
            <li>{t('admin.obsHowToStep1', { defaultValue: 'Add a new Browser Source.' })}</li>
            <li>{t('admin.obsHowToStep2', { defaultValue: 'Paste the Overlay URL.' })}</li>
            <li>{t('admin.obsHowToStep3', { defaultValue: 'Set Width/Height (e.g. 1920Г—1080) and enable вЂњShutdown source when not visibleвЂќ if you want.' })}</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
