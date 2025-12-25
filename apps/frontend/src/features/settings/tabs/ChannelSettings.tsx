import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { resolvePublicUrl } from '@/lib/urls';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';
import { SavedOverlay, SavingOverlay } from '@/shared/ui/StatusOverlays';
import { useChannelColors } from '@/contexts/ChannelColorsContext';
import { useAutoplayMemes } from '@/hooks/useAutoplayMemes';
import { useAppSelector } from '@/store/hooks';

// Channel Settings Component (Colors only)
export function ChannelSettings() {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const { getChannelData, getCachedChannelData } = useChannelColors();
  const { autoplayMemesEnabled, setAutoplayMemesEnabled } = useAutoplayMemes();
  const [settings, setSettings] = useState({
    primaryColor: '',
    secondaryColor: '',
    accentColor: '',
  });
  const [loading, setLoading] = useState(false);
  const [savedPulse, setSavedPulse] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedRef = useRef<string | null>(null);
  const settingsLoadedRef = useRef<string | null>(null); // Track which channel's settings were loaded

  const loadSettings = useCallback(async () => {
    if (!user?.channel?.slug) return;
    
    // Skip if already loaded for this channel
    if (settingsLoadedRef.current === user.channel.slug) {
      return;
    }
    
    try {
      // Check cache first
      const cached = getCachedChannelData(user.channel.slug);
      if (cached) {
        const nextSettings = {
          primaryColor: cached.primaryColor || '',
          secondaryColor: cached.secondaryColor || '',
          accentColor: cached.accentColor || '',
        };
        setSettings({
          primaryColor: nextSettings.primaryColor,
          secondaryColor: nextSettings.secondaryColor,
          accentColor: nextSettings.accentColor,
        });
        settingsLoadedRef.current = user.channel.slug;
        // Seed lastSaved to prevent immediate auto-save right after initial load.
        lastSavedRef.current = JSON.stringify({
          primaryColor: nextSettings.primaryColor || null,
          secondaryColor: nextSettings.secondaryColor || null,
          accentColor: nextSettings.accentColor || null,
          autoplayMemesEnabled,
        });
        return;
      }

      // If not in cache, fetch it
      const channelData = await getChannelData(user.channel.slug);
      if (channelData) {
        const nextSettings = {
          primaryColor: channelData.primaryColor || '',
          secondaryColor: channelData.secondaryColor || '',
          accentColor: channelData.accentColor || '',
        };
        setSettings({
          primaryColor: nextSettings.primaryColor,
          secondaryColor: nextSettings.secondaryColor,
          accentColor: nextSettings.accentColor,
        });
        settingsLoadedRef.current = user.channel.slug;
        // Seed lastSaved to prevent immediate auto-save right after initial load.
        lastSavedRef.current = JSON.stringify({
          primaryColor: nextSettings.primaryColor || null,
          secondaryColor: nextSettings.secondaryColor || null,
          accentColor: nextSettings.accentColor || null,
          autoplayMemesEnabled,
        });
      }
    } catch (error) {
      settingsLoadedRef.current = null; // Reset on error to allow retry
    }
  }, [user?.channel?.slug, getChannelData, getCachedChannelData, autoplayMemesEnabled]);

  useEffect(() => {
    // Load current settings
    if (user?.channelId && user?.channel?.slug) {
      loadSettings();
    } else {
      settingsLoadedRef.current = null; // Reset when user/channel changes
    }
  }, [loadSettings, user?.channelId, user?.channel?.slug]);

  // Auto-save channel design settings (no explicit Save button).
  useEffect(() => {
    if (!user?.channelId) return;
    if (!settingsLoadedRef.current) return; // don't save before initial load

    const payload = JSON.stringify({
      primaryColor: settings.primaryColor || null,
      secondaryColor: settings.secondaryColor || null,
      accentColor: settings.accentColor || null,
    });

    // Skip if nothing changed from last saved.
    if (payload === lastSavedRef.current) return;

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        const startedAt = Date.now();
        try {
          setLoading(true);
          const { api } = await import('@/lib/api');
          await api.patch('/streamer/channel/settings', {
            primaryColor: settings.primaryColor || null,
            secondaryColor: settings.secondaryColor || null,
            accentColor: settings.accentColor || null,
          });
          lastSavedRef.current = payload;
        } catch (error: unknown) {
          const apiError = error as { response?: { data?: { error?: string } } };
          toast.error(apiError.response?.data?.error || t('admin.failedToSaveSettings') || 'Failed to save settings');
        } finally {
          await ensureMinDuration(startedAt, 1000);
          setLoading(false);
          setSavedPulse(true);
          window.setTimeout(() => setSavedPulse(false), 700);
        }
      })();
    }, 350);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [
    settings.primaryColor,
    settings.secondaryColor,
    settings.accentColor,
    user?.channelId,
    t,
  ]);

  // Note: lastSavedRef is seeded during initial loadSettings to avoid immediate autosave.

  const profileUrl = user?.channel?.slug ? resolvePublicUrl(`/channel/${user.channel.slug}`) : '';

  return (
    <div className="surface p-6 relative">
      {loading && <SavingOverlay label={t('admin.saving', { defaultValue: 'Saving…' })} />}
      {savedPulse && !loading && <SavedOverlay label={t('admin.saved', { defaultValue: 'Saved' })} />}
      <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('admin.channelDesign', 'Оформление')}</h2>

      {/* Preferences */}
      <div className={`mb-6 pb-6 ${loading ? 'pointer-events-none opacity-60' : ''}`}>
        <h3 className="text-lg font-semibold mb-3 dark:text-white">
          {t('admin.preferences', 'Предпочтения')}
        </h3>
        <div className="flex items-start justify-between gap-4 glass p-4">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.autoplayMemesTitle', { defaultValue: 'Autoplay memes' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.autoplayMemesDescription', { defaultValue: 'When enabled, meme previews autoplay (muted) on pages with many memes.' })}
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={autoplayMemesEnabled}
              onChange={(e) => setAutoplayMemesEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
          </label>
        </div>
      </div>
      
      {/* Profile Link Section */}
      {profileUrl && (
        <div className="mb-6 pb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('admin.profileLink')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={profileUrl}
              className="flex-1 rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm text-sm"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(profileUrl);
                  toast.success(t('toast.linkCopied'));
                } catch (error) {
                  toast.error(t('toast.failedToCopyLink'));
                }
              }}
              className="p-2 rounded-lg hover:bg-white/70 dark:hover:bg-white/10 transition-colors glass-btn bg-white/40 dark:bg-white/5"
              title={t('dashboard.copyLink')}
            >
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('dashboard.shareLinkDescription')}
          </p>
        </div>
      )}

      <div className={`space-y-4 ${loading ? 'pointer-events-none opacity-60' : ''}`}>
        <div>
          <h3 className="text-lg font-semibold mb-4 dark:text-white">{t('admin.colorCustomization')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.primaryColor')}
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.primaryColor || '#9333ea'}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                  className="w-16 h-10 rounded glass-btn bg-white/40 dark:bg-white/5"
                />
                <input
                  type="text"
                  value={settings.primaryColor}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                  placeholder="#9333ea"
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="flex-1 rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.secondaryColor')}
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.secondaryColor || '#4f46e5'}
                  onChange={(e) => setSettings({ ...settings, secondaryColor: e.target.value })}
                  className="w-16 h-10 rounded glass-btn bg-white/40 dark:bg-white/5"
                />
                <input
                  type="text"
                  value={settings.secondaryColor}
                  onChange={(e) => setSettings({ ...settings, secondaryColor: e.target.value })}
                  placeholder="#4f46e5"
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="flex-1 rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.accentColor')}
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.accentColor || '#ec4899'}
                  onChange={(e) => setSettings({ ...settings, accentColor: e.target.value })}
                  className="w-16 h-10 rounded glass-btn bg-white/40 dark:bg-white/5"
                />
                <input
                  type="text"
                  value={settings.accentColor}
                  onChange={(e) => setSettings({ ...settings, accentColor: e.target.value })}
                  placeholder="#ec4899"
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="flex-1 rounded-lg px-3 py-2 bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm"
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {t('admin.colorsVisibleToVisitors')}
          </p>
        </div>

        {/* Removed persistent Saved label; we show overlays instead to avoid noise. */}
      </div>
    </div>
  );
}


