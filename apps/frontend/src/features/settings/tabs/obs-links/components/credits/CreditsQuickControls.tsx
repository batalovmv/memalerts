import { useTranslation } from 'react-i18next';

import type { CreditsBackgroundMode, CreditsScrollDirection, CreditsTextAlign } from '../../types';
import type { CreditsSettingsState } from '../../hooks/useCreditsSettings';

import { Button } from '@/shared/ui';

type CreditsQuickControlsProps = {
  creditsSettings: CreditsSettingsState;
};

export function CreditsQuickControls({ creditsSettings }: CreditsQuickControlsProps) {
  const { t } = useTranslation();
  const {
    loadingCreditsSettings,
    savingCreditsSettings,
    creditsShowDonors,
    setCreditsShowDonors,
    creditsShowChatters,
    setCreditsShowChatters,
    creditsSectionsOrder,
    setCreditsSectionsOrder,
    creditsTitleText,
    setCreditsTitleText,
    creditsDonorsTitleText,
    setCreditsDonorsTitleText,
    creditsChattersTitleText,
    setCreditsChattersTitleText,
    creditsShowNumbers,
    setCreditsShowNumbers,
    creditsShowAvatars,
    setCreditsShowAvatars,
    creditsAvatarSize,
    setCreditsAvatarSize,
    creditsAvatarRadius,
    setCreditsAvatarRadius,
    creditsFontFamily,
    setCreditsFontFamily,
    creditsFontSize,
    setCreditsFontSize,
    creditsTextAlign,
    setCreditsTextAlign,
    creditsBackgroundMode,
    setCreditsBackgroundMode,
    creditsBgOpacity,
    setCreditsBgOpacity,
    creditsBlur,
    setCreditsBlur,
    creditsScrollSpeed,
    setCreditsScrollSpeed,
    creditsScrollDirection,
    setCreditsScrollDirection,
    creditsLoop,
    setCreditsLoop,
    creditsUiMode,
    setCreditsUiMode,
    applyCreditsPreset,
  } = creditsSettings;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl overflow-hidden border border-white/20 dark:border-white/10">
          <button
            type="button"
            className={`px-3 py-2 text-sm font-semibold ${creditsUiMode === 'quick' ? 'bg-primary text-white' : 'bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white'}`}
            onClick={() => setCreditsUiMode('quick')}
          >
            {t('admin.obsUiBasic', { defaultValue: 'Basic' })}
          </button>
          <button
            type="button"
            className={`px-3 py-2 text-sm font-semibold border-l border-white/20 dark:border-white/10 ${creditsUiMode === 'advanced' ? 'bg-primary text-white' : 'bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white'}`}
            onClick={() => setCreditsUiMode('advanced')}
          >
            {t('admin.obsUiPro', { defaultValue: 'Pro' })}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyCreditsPreset('minimal')}>
            {t('admin.creditsPresetMinimal', { defaultValue: 'Minimal' })}
          </Button>
          <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyCreditsPreset('classic')}>
            {t('admin.creditsPresetClassic', { defaultValue: 'Classic' })}
          </Button>
          <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyCreditsPreset('neon')}>
            {t('admin.creditsPresetNeon', { defaultValue: 'Neon' })}
          </Button>
          <Button type="button" size="sm" variant="secondary" className="glass-btn" onClick={() => applyCreditsPreset('fullscreen')}>
            {t('admin.creditsPresetFullscreen', { defaultValue: 'Fullscreen' })}
          </Button>
        </div>
      </div>

      {/* Quick controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="glass p-3">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">
              {t('admin.creditsQuickTitles', { defaultValue: 'Заголовки' })}
            </div>
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                  {t('admin.creditsTitleText', { defaultValue: 'Верхний заголовок' })}
                </label>
                <input
                  value={creditsTitleText}
                  onChange={(e) => setCreditsTitleText(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                  placeholder="Credits"
                  disabled={loadingCreditsSettings || savingCreditsSettings}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                    {t('admin.creditsDonorsTitleText', { defaultValue: 'Заголовок донатов' })}
                  </label>
                  <input
                    value={creditsDonorsTitleText}
                    onChange={(e) => setCreditsDonorsTitleText(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                    placeholder="Donors"
                    disabled={loadingCreditsSettings || savingCreditsSettings}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                    {t('admin.creditsChattersTitleText', { defaultValue: 'Заголовок чата' })}
                  </label>
                  <input
                    value={creditsChattersTitleText}
                    onChange={(e) => setCreditsChattersTitleText(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                    placeholder="Chatters"
                    disabled={loadingCreditsSettings || savingCreditsSettings}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="glass p-3">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">
              {t('admin.creditsQuickList', { defaultValue: 'Список' })}
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                <input
                  type="checkbox"
                  checked={creditsShowNumbers}
                  onChange={(e) => setCreditsShowNumbers(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                  disabled={loadingCreditsSettings || savingCreditsSettings}
                />
                {t('admin.creditsShowNumbers', { defaultValue: 'Нумерация (1. 2. 3.)' })}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                <input
                  type="checkbox"
                  checked={creditsShowAvatars}
                  onChange={(e) => setCreditsShowAvatars(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                  disabled={loadingCreditsSettings || savingCreditsSettings}
                />
                {t('admin.creditsShowAvatars', { defaultValue: 'Аватары (если есть)' })}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                    {t('admin.creditsAvatarSize', { defaultValue: 'Размер аватара' })}
                  </label>
                  <input
                    type="number"
                    min={12}
                    max={96}
                    step={1}
                    value={creditsAvatarSize}
                    onChange={(e) => setCreditsAvatarSize(Number(e.target.value) || 12)}
                    className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                    disabled={loadingCreditsSettings || savingCreditsSettings || !creditsShowAvatars}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                    {t('admin.creditsAvatarRadius', { defaultValue: 'Скругление' })}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    step={1}
                    value={creditsAvatarRadius}
                    onChange={(e) => setCreditsAvatarRadius(Number(e.target.value) || 0)}
                    className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                    disabled={loadingCreditsSettings || savingCreditsSettings || !creditsShowAvatars}
                  />
                  <div className="text-[11px] text-gray-600 dark:text-gray-300 mt-1">
                    {t('admin.creditsAvatarRadiusHint', { defaultValue: '999 = круг' })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="glass p-3">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">
              {t('admin.creditsQuickSections', { defaultValue: 'Секции' })}
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                <input
                  type="checkbox"
                  checked={creditsShowDonors}
                  onChange={(e) => setCreditsShowDonors(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                  disabled={loadingCreditsSettings || savingCreditsSettings}
                />
                {t('admin.creditsShowDonors', { defaultValue: 'Донаты (DonationAlerts)' })}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                <input
                  type="checkbox"
                  checked={creditsShowChatters}
                  onChange={(e) => setCreditsShowChatters(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                  disabled={loadingCreditsSettings || savingCreditsSettings}
                />
                {t('admin.creditsShowChatters', { defaultValue: 'Чат (Twitch)' })}
              </label>
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                  {t('admin.creditsSectionsOrder', { defaultValue: 'Порядок' })}
                </label>
                <select
                  value={creditsSectionsOrder[0] === 'donors' ? 'donors-first' : 'chatters-first'}
                  onChange={(e) => {
                    const v = String(e.target.value || '');
                    setCreditsSectionsOrder(v === 'chatters-first' ? ['chatters', 'donors'] : ['donors', 'chatters']);
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                  disabled={loadingCreditsSettings || savingCreditsSettings}
                >
                  <option value="donors-first">{t('admin.creditsOrderDonorsFirst', { defaultValue: 'Донаты  Чат' })}</option>
                  <option value="chatters-first">{t('admin.creditsOrderChattersFirst', { defaultValue: 'Чат  Донаты' })}</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.fontFamily', { defaultValue: 'Шрифт' })}</label>
            <select
              value={creditsFontFamily}
              onChange={(e) => setCreditsFontFamily(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
              disabled={loadingCreditsSettings || savingCreditsSettings}
            >
              <option value="system">System</option>
              <option value="Inter">Inter (Google)</option>
              <option value="Roboto">Roboto (Google)</option>
              <option value="Montserrat">Montserrat (Google)</option>
              <option value="Poppins">Poppins (Google)</option>
              <option value="Oswald">Oswald (Google)</option>
              <option value="Raleway">Raleway (Google)</option>
              <option value="Nunito">Nunito (Google)</option>
              <option value="Playfair Display">Playfair Display (Google)</option>
              <option value="JetBrains Mono">JetBrains Mono (Google)</option>
            </select>
            <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.creditsGoogleFontsHint', { defaultValue: 'Google Fonts подгружаются автоматически в оверлее (без загрузки файлов).' })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{t('admin.fontSize', { defaultValue: 'Размер' })}</label>
              <input
                type="number"
                min={10}
                max={96}
                step={0.5}
                value={creditsFontSize}
                onChange={(e) => setCreditsFontSize(Number(e.target.value) || 10)}
                className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                disabled={loadingCreditsSettings || savingCreditsSettings}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                {t('admin.creditsTextAlign', { defaultValue: 'Выравнивание' })}
              </label>
              <select
                value={creditsTextAlign}
                onChange={(e) => setCreditsTextAlign(e.target.value as CreditsTextAlign)}
                className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                disabled={loadingCreditsSettings || savingCreditsSettings}
              >
                <option value="left">{t('admin.alignLeft', { defaultValue: 'Left' })}</option>
                <option value="center">{t('admin.alignCenter', { defaultValue: 'Center' })}</option>
                <option value="right">{t('admin.alignRight', { defaultValue: 'Right' })}</option>
              </select>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="glass p-3">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">
              {t('admin.creditsQuickBackground', { defaultValue: 'Фон' })}
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                  {t('admin.creditsBackgroundMode', { defaultValue: 'Режим фона' })}
                </label>
                <select
                  value={creditsBackgroundMode}
                  onChange={(e) => setCreditsBackgroundMode(e.target.value as CreditsBackgroundMode)}
                  className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                  disabled={loadingCreditsSettings || savingCreditsSettings}
                >
                  <option value="transparent">{t('admin.creditsBackgroundModeTransparent', { defaultValue: 'Прозрачный' })}</option>
                  <option value="card">{t('admin.creditsBackgroundModeCard', { defaultValue: 'Карточка' })}</option>
                  <option value="full">{t('admin.creditsBackgroundModeFull', { defaultValue: 'На весь экран' })}</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                    {t('admin.creditsBgOpacity', { defaultValue: 'Прозрачность' })}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={0.85}
                    step={0.01}
                    value={creditsBgOpacity}
                    onChange={(e) => setCreditsBgOpacity(parseFloat(e.target.value))}
                    className="w-full"
                    disabled={creditsBackgroundMode === 'transparent' || loadingCreditsSettings || savingCreditsSettings}
                  />
                  <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">{Math.round(creditsBgOpacity * 100)}%</div>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
                    {t('admin.creditsBlur', { defaultValue: 'Blur' })}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    step={1}
                    value={creditsBlur}
                    onChange={(e) => setCreditsBlur(Number(e.target.value) || 0)}
                    className="w-full"
                    disabled={creditsBackgroundMode === 'transparent' || loadingCreditsSettings || savingCreditsSettings}
                  />
                  <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">{creditsBlur}px</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
              {t('admin.creditsScrollSpeed', { defaultValue: 'Скорость прокрутки (px/s)' })}
            </label>
            <input
              type="number"
              min={8}
              max={600}
              value={creditsScrollSpeed}
              onChange={(e) => setCreditsScrollSpeed(Number(e.target.value) || 8)}
              className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
              disabled={loadingCreditsSettings || savingCreditsSettings}
            />
          </div>
          <div className="glass p-3">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                <input
                  type="checkbox"
                  checked={creditsLoop}
                  onChange={(e) => setCreditsLoop(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 dark:border-white/10 bg-white/60 dark:bg-white/10"
                  disabled={loadingCreditsSettings || savingCreditsSettings}
                />
                {t('admin.creditsLoop', { defaultValue: 'Loop' })}
              </label>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {t('admin.creditsScrollDirection', { defaultValue: 'Направление' })}: {creditsScrollDirection === 'up' ? '' : ''}
              </div>
            </div>
            <div className="mt-2">
              <select
                value={creditsScrollDirection}
                onChange={(e) => setCreditsScrollDirection(e.target.value as CreditsScrollDirection)}
                className="w-full px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-white/20 dark:border-white/10 text-gray-900 dark:text-white"
                disabled={loadingCreditsSettings || savingCreditsSettings}
              >
                <option value="up">{t('admin.creditsScrollDirectionUp', { defaultValue: 'Вверх' })}</option>
                <option value="down">{t('admin.creditsScrollDirectionDown', { defaultValue: 'Вниз' })}</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
