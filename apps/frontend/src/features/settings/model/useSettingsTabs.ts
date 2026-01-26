import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import type { SettingsTab } from '@/features/settings/model/types';
import type { UserMode } from '@/shared/lib/userMode';
import type { User } from '@memalerts/api-contracts';
import type { Location, NavigateFunction } from 'react-router-dom';

import { MORE_TABS, PRIMARY_TABS, TAB_QUERY_TABS, VIEWER_TABS } from '@/features/settings/model/constants';
import { focusSafely } from '@/shared/lib/a11y/focus';

type UseSettingsTabsParams = {
  user: User | null;
  authLoading: boolean;
  uiMode: UserMode;
  location: Location;
  navigate: NavigateFunction;
};

export function useSettingsTabs({ user, authLoading, uiMode, location, navigate }: UseSettingsTabsParams) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('settings');
  const tabsReactId = useId();
  const tabsIdBase = `settings-tabs-${tabsReactId.replace(/:/g, '')}`;

  const getTabButtonId = useCallback((tab: SettingsTab) => `${tabsIdBase}-tab-${tab}`, [tabsIdBase]);
  const getTabPanelId = useCallback((tab: SettingsTab) => `${tabsIdBase}-panel-${tab}`, [tabsIdBase]);

  const isStreamerAdmin = uiMode === 'streamer' && (user?.role === 'streamer' || user?.role === 'admin');
  const isMoreTabActive = MORE_TABS.includes(activeTab);

  const primaryTabs = useMemo(() => (isStreamerAdmin ? PRIMARY_TABS : []), [isStreamerAdmin]);
  const visibleTabs = useMemo(() => {
    const base = [...primaryTabs];
    if (isMoreTabActive) base.push(activeTab);
    return base;
  }, [activeTab, isMoreTabActive, primaryTabs]);

  const focusTabButton = useCallback(
    (tab: SettingsTab) => {
      const el = document.getElementById(getTabButtonId(tab));
      if (el instanceof HTMLElement) focusSafely(el);
    },
    [getTabButtonId],
  );

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, tab: SettingsTab) => {
      if (visibleTabs.length === 0) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      e.stopPropagation();

      const idx = visibleTabs.indexOf(tab);
      if (idx === -1) return;

      let next: SettingsTab = tab;
      if (e.key === 'Home') next = visibleTabs[0]!;
      if (e.key === 'End') next = visibleTabs[visibleTabs.length - 1]!;
      if (e.key === 'ArrowRight') next = visibleTabs[(idx + 1) % visibleTabs.length]!;
      if (e.key === 'ArrowLeft') next = visibleTabs[(idx - 1 + visibleTabs.length) % visibleTabs.length]!;

      setActiveTab(next);
      window.requestAnimationFrame(() => focusTabButton(next));
    },
    [focusTabButton, visibleTabs],
  );

  useEffect(() => {
    const maybeSubPath = location.pathname.replace(/^\/settings\/?/, '');
    const pathTab = (maybeSubPath.split('/')[0] || '').trim();
    if (pathTab === 'accounts') {
      setActiveTab((prev) => (prev === 'accounts' ? prev : 'accounts'));
      return;
    }
    if (pathTab === 'bot') {
      setActiveTab((prev) => (prev === 'bot' ? prev : 'bot'));
      return;
    }

    const tabParam = new URLSearchParams(location.search).get('tab');
    if (tabParam === 'submissions') {
      navigate('/dashboard?tab=submissions', { replace: true });
      return;
    }
    if (tabParam === 'memes') {
      navigate('/dashboard?panel=memes', { replace: true });
      return;
    }
    if (tabParam && TAB_QUERY_TABS.includes(tabParam as SettingsTab)) {
      setActiveTab((prev) => (prev === (tabParam as SettingsTab) ? prev : (tabParam as SettingsTab)));
    }
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    if (user && !isStreamerAdmin && activeTab !== 'beta' && activeTab !== 'accounts') {
      setActiveTab('beta');
    }
  }, [activeTab, isStreamerAdmin, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/', { replace: true });
      return;
    }
    if (uiMode !== 'streamer') {
      if (!VIEWER_TABS.includes(activeTab)) {
        navigate('/settings/accounts', { replace: true });
      }
    }
  }, [activeTab, authLoading, navigate, uiMode, user]);

  return {
    activeTab,
    setActiveTab,
    isStreamerAdmin,
    isMoreTabActive,
    visibleTabs,
    getTabButtonId,
    getTabPanelId,
    handleTabKeyDown,
  };
}

