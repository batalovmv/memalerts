import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SettingsTab } from '@/features/settings/model/types';
import type { User } from '@/types';
import type { ReactNode } from 'react';

import { getSettingsTabLabel } from '@/features/settings/model/tabLabels';
import { focusSafely, getFocusableElements } from '@/shared/lib/a11y/focus';
import { IconButton } from '@/shared/ui';

type SettingsMoreMenuProps = {
  activeTab: SettingsTab;
  isMoreTabActive: boolean;
  isStreamerAdmin: boolean;
  user: User;
  onSelectTab: (tab: SettingsTab) => void;
};

type MenuItemSpec = {
  tab: SettingsTab;
  label: string;
  icon: ReactNode;
  visible: boolean;
};

export function SettingsMoreMenu({ activeTab, isMoreTabActive, isStreamerAdmin, user, onSelectTab }: SettingsMoreMenuProps) {
  const { t } = useTranslation();
  const menuReactId = useId();
  const menuId = `settings-more-menu-${menuReactId.replace(/:/g, '')}`;
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const openedByKeyboardRef = useRef(false);
  const openFocusIntentRef = useRef<'first' | 'last'>('first');

  const menuItemIconClass = 'w-4 h-4';
  const MenuIcon = (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
  const StatsIcon = (
    <svg className={menuItemIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5m0 14h16" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 15l3-3 3 3 6-6" />
    </svg>
  );
  const PromoIcon = (
    <svg className={menuItemIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h10l1 5-1 5H7l1-5-1-5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 7l1 10" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 7l1 10" />
    </svg>
  );
  const WalletIcon = (
    <svg className={menuItemIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18v12H3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7l2-3h14l2 3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 13h5" />
    </svg>
  );
  const TicketIcon = (
    <svg className={menuItemIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12" />
    </svg>
  );
  const BetaIcon = (
    <svg className={menuItemIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" />
    </svg>
  );
  const AccountsIcon = (
    <svg className={menuItemIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 21a8 8 0 0 0-16 0" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 13a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
    </svg>
  );

  useEffect(() => {
    if (!isOpen) return;
    if (!openedByKeyboardRef.current) return;
    const popup = popupRef.current;
    if (!popup) return;

    const raf = window.requestAnimationFrame(() => {
      const items = getFocusableElements(popup);
      if (items.length === 0) return;
      focusSafely(openFocusIntentRef.current === 'last' ? items[items.length - 1] : items[0]);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isOpen]);

  const closeMenu = () => setIsOpen(false);

  const GroupLabel = ({ children }: { children: ReactNode }) => (
    <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase text-gray-500 dark:text-gray-400">
      {children}
    </div>
  );

  const renderMenuItem = ({ tab, icon, label, visible }: MenuItemSpec) => {
    if (!visible) return null;
    const isActive = activeTab === tab;
    return (
      <button
        key={tab}
        onClick={() => {
          onSelectTab(tab);
          closeMenu();
        }}
        className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors rounded-md mx-1 flex items-center gap-2 ${
          isActive ? 'bg-primary/10 text-primary' : 'text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10'
        }`}
        type="button"
        role="menuitem"
      >
        <span className={isActive ? 'text-primary' : 'text-gray-500 dark:text-gray-400'}>{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
      </button>
    );
  };

  const insightsItems: MenuItemSpec[] = [
    { tab: 'statistics', label: t('admin.statistics'), icon: StatsIcon, visible: true },
    { tab: 'promotions', label: t('admin.promotions'), icon: PromoIcon, visible: true },
  ];

  const accountItems: MenuItemSpec[] = [
    { tab: 'accounts', label: t('settings.accounts', { defaultValue: 'Accounts' }), icon: AccountsIcon, visible: true },
    { tab: 'beta', label: t('admin.betaAccess'), icon: BetaIcon, visible: true },
  ];

  const adminItems: MenuItemSpec[] = [
    {
      tab: 'wallets',
      label: t('admin.walletManagement', { defaultValue: 'Wallet management' }),
      icon: WalletIcon,
      visible: user?.role === 'admin' || isStreamerAdmin,
    },
    {
      tab: 'entitlements',
      label: t('admin.entitlements', { defaultValue: 'Entitlements' }),
      icon: TicketIcon,
      visible: user?.role === 'admin',
    },
    {
      tab: 'ownerMemeAssets',
      label: getSettingsTabLabel(t, 'ownerMemeAssets'),
      icon: TicketIcon,
      visible: user?.role === 'admin',
    },
    {
      tab: 'ownerModerators',
      label: getSettingsTabLabel(t, 'ownerModerators'),
      icon: TicketIcon,
      visible: user?.role === 'admin',
    },
    {
      tab: 'ownerAiStatus',
      label: getSettingsTabLabel(t, 'ownerAiStatus'),
      icon: TicketIcon,
      visible: user?.role === 'admin',
    },
    {
      tab: 'ownerTagModeration',
      label: getSettingsTabLabel(t, 'ownerTagModeration'),
      icon: TicketIcon,
      visible: user?.role === 'admin',
    },
  ];

  return (
    <>
      <IconButton
        ref={buttonRef}
        onClick={() => {
          openedByKeyboardRef.current = false;
          setIsOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (!isOpen) return;
            e.preventDefault();
            e.stopPropagation();
            closeMenu();
            focusSafely(buttonRef.current);
            return;
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openedByKeyboardRef.current = true;
            openFocusIntentRef.current = e.key === 'ArrowUp' ? 'last' : 'first';
            setIsOpen(true);
          }
        }}
        className={`rounded-lg ${
          isMoreTabActive || isOpen ? 'bg-black/5 dark:bg-white/10 text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'
        }`}
        variant="ghost"
        type="button"
        aria-label={t('admin.more', { defaultValue: 'More' })}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        icon={MenuIcon}
      />

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} aria-hidden="true" />
          <div
            id={menuId}
            ref={popupRef}
            role="menu"
            aria-label={t('admin.more', { defaultValue: 'More' })}
            className="absolute right-0 top-full mt-1 w-60 glass rounded-xl shadow-xl ring-1 ring-black/5 dark:ring-white/10 py-2 z-50"
            onKeyDownCapture={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeMenu();
                focusSafely(buttonRef.current);
                return;
              }

              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
              const popup = popupRef.current;
              if (!popup) return;
              const items = getFocusableElements(popup);
              if (items.length === 0) return;

              const active = document.activeElement;
              const currentIndex = active instanceof HTMLElement ? items.indexOf(active) : -1;

              e.preventDefault();
              if (e.key === 'Home') {
                focusSafely(items[0]);
                return;
              }
              if (e.key === 'End') {
                focusSafely(items[items.length - 1]);
                return;
              }

              const nextIndex =
                e.key === 'ArrowDown'
                  ? (currentIndex + 1 + items.length) % items.length
                  : (currentIndex - 1 + items.length) % items.length;
              focusSafely(items[nextIndex] ?? items[0]);
            }}
          >
            <GroupLabel>{t('settings.moreGroups.insightsGrowth', { defaultValue: 'Insights & growth' })}</GroupLabel>
            <div className="px-1 py-1">{insightsItems.map(renderMenuItem)}</div>
            <div className="border-t border-black/5 dark:border-white/10 my-1" />

            <GroupLabel>{t('settings.moreGroups.accountAccess', { defaultValue: 'Account & access' })}</GroupLabel>
            <div className="px-1 py-1">{accountItems.map(renderMenuItem)}</div>
            <div className="border-t border-black/5 dark:border-white/10 my-1" />

            <GroupLabel>{t('settings.moreGroups.adminOwner', { defaultValue: 'Admin / owner' })}</GroupLabel>
            <div className="px-1 py-1">{adminItems.map(renderMenuItem)}</div>
          </div>
        </>
      )}
    </>
  );
}
