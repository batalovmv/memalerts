import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Header from '@/components/Header';
import { getStoredUserMode, setStoredUserMode } from '@/shared/lib/userMode';
import { PageShell, Spinner } from '@/shared/ui';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchUser } from '@/store/slices/authSlice';

export default function PostLogin() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user, loading } = useAppSelector((s) => s.auth);

  const [choiceVisible, setChoiceVisible] = useState(false);

  const ownChannelSlug = user?.channel?.slug ?? null;
  const canUseStreamerUi = Boolean(user && (user.role === 'streamer' || user.role === 'admin') && user.channelId);
  const canOpenOwnProfile = Boolean(user && user.channelId && ownChannelSlug);

  const storedMode = useMemo(() => getStoredUserMode(), []);

  useEffect(() => {
    // After hard redirect from OAuth, make sure /me is loaded.
    if (!user && !loading) {
      dispatch(fetchUser());
    }
  }, [dispatch, loading, user]);

  useEffect(() => {
    if (!user) return;

    // If user can't be a streamer (no channel/role), no choice is needed.
    if (!canUseStreamerUi) {
      if (canOpenOwnProfile && ownChannelSlug) {
        navigate(`/channel/${ownChannelSlug}`, { replace: true });
        return;
      }
      navigate('/search', { replace: true });
      return;
    }

    // If user has a remembered preference, auto-redirect.
    if (storedMode === 'streamer') {
      navigate('/dashboard', { replace: true });
      return;
    }
    if (storedMode === 'viewer') {
      if (canOpenOwnProfile && ownChannelSlug) {
        navigate(`/channel/${ownChannelSlug}`, { replace: true });
        return;
      }
      navigate('/search', { replace: true });
      return;
    }

    setChoiceVisible(true);
  }, [canOpenOwnProfile, canUseStreamerUi, navigate, ownChannelSlug, storedMode, user]);

  if (!user || (loading && !choiceVisible)) {
    return (
      <PageShell header={<Header />} containerClassName="max-w-2xl">
        <div className="min-h-[40vh] flex items-center justify-center gap-3 text-gray-600 dark:text-gray-300">
          <Spinner className="h-5 w-5" />
          <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
        </div>
      </PageShell>
    );
  }

  if (!choiceVisible) {
    // We already navigated; keep UI minimal.
    return null;
  }

  return (
    <PageShell header={<Header />} containerClassName="max-w-2xl">
      <div className="surface p-6">
        <h1 className="text-2xl font-bold dark:text-white">
          {t('auth.chooseModeTitle', { defaultValue: 'Where do you want to go?' })}
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {t('auth.chooseModeHint', {
            defaultValue:
              'You can switch later from the avatar menu. We will remember your choice on this device.',
          })}
        </p>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            className="glass p-4 rounded-xl ring-1 ring-black/5 dark:ring-white/10 hover:bg-white/60 dark:hover:bg-white/10 transition-colors text-left"
            onClick={() => {
              setStoredUserMode('streamer');
              navigate('/dashboard');
            }}
          >
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('auth.modeStreamer', { defaultValue: 'Streamer dashboard' })}
            </div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {t('auth.modeStreamerHint', { defaultValue: 'Approve submissions, manage bots and settings.' })}
            </div>
          </button>

          <button
            type="button"
            className="glass p-4 rounded-xl ring-1 ring-black/5 dark:ring-white/10 hover:bg-white/60 dark:hover:bg-white/10 transition-colors text-left"
            onClick={() => {
              setStoredUserMode('viewer');
              if (canOpenOwnProfile && ownChannelSlug) {
                navigate(`/channel/${ownChannelSlug}`);
              } else {
                navigate('/search');
              }
            }}
          >
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('auth.modeViewer', { defaultValue: 'Viewer mode' })}
            </div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {t('auth.modeViewerHint', { defaultValue: 'Open a public profile to browse and submit memes.' })}
            </div>
          </button>
        </div>
      </div>
    </PageShell>
  );
}


