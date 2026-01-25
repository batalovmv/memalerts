import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PanelHeader } from '../../PanelHeader';

import { useAllMemesPanel } from './model/useAllMemesPanel';
import { AllMemesControls } from './ui/AllMemesControls';
import { AllMemesGrid } from './ui/AllMemesGrid';
import { StarterMemesPanel } from './ui/StarterMemesPanel';

import type { Meme } from '@/types';

import { cn } from '@/shared/lib/cn';
import { Spinner } from '@/shared/ui';

export type AllMemesPanelProps = {
  isOpen: boolean;
  channelId: string;
  autoplayPreview: 'autoplayMuted' | 'hoverWithSound';
  onClose: () => void;
  onSelectMeme: (meme: Meme) => void;
};

export function AllMemesPanel({ isOpen, channelId, autoplayPreview, onClose, onSelectMeme }: AllMemesPanelProps) {
  const { t } = useTranslation();
  // Dashboard is owner/admin-only context; request fileHash when backend allows it.
  const vm = useAllMemesPanel({ isOpen, channelId, includeFileHash: true });
  const [starterDismissed, setStarterDismissed] = useState(false);

  const starterDismissKey = useMemo(
    () => (channelId ? `memalerts:starterMemesDismissed:${channelId}` : 'memalerts:starterMemesDismissed'),
    [channelId],
  );

  useEffect(() => {
    if (!channelId || typeof window === 'undefined') return;
    try {
      setStarterDismissed(window.localStorage.getItem(starterDismissKey) === '1');
    } catch {
      setStarterDismissed(false);
    }
  }, [channelId, starterDismissKey]);

  const handleDismissStarter = useCallback(() => {
    setStarterDismissed(true);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(starterDismissKey, '1');
    } catch {
      // ignore storage errors
    }
  }, [starterDismissKey]);

  const showStarterPanel = useMemo(() => {
    if (starterDismissed || vm.loading) return false;
    if (typeof vm.totalCount === 'number') {
      return vm.totalCount === 0;
    }
    return vm.memes.length === 0;
  }, [starterDismissed, vm.loading, vm.memes.length, vm.totalCount]);

  return (
    <section
      className={cn(isOpen ? 'block' : 'hidden', 'surface max-w-6xl mx-auto')}
      aria-label={t('dashboard.allMemesTitle', { defaultValue: 'All memes' })}
    >
      <PanelHeader
        title={t('dashboard.allMemesTitle', { defaultValue: 'All memes' })}
        meta={
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {vm.loading ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="h-4 w-4" />
                {t('common.loading')}
              </span>
            ) : (
              `${vm.memes.length}${typeof vm.totalCount === 'number' ? ` / ${vm.totalCount}` : ''}`
            )}
          </span>
        }
        onClose={onClose}
      />

      <div className="surface-body">
        {showStarterPanel ? (
          <StarterMemesPanel
            channelId={channelId}
            isOpen={isOpen}
            onImported={() => void vm.reload()}
            onDismiss={handleDismissStarter}
          />
        ) : null}

        <AllMemesControls
          query={vm.query}
          onQueryChange={vm.setQuery}
          status={vm.filters.status}
          onStatusChange={(status) => vm.setFilters({ ...vm.filters, status })}
          sortOrder={vm.filters.sortOrder}
          onSortOrderChange={(sortOrder) => vm.setFilters({ ...vm.filters, sortOrder })}
        />

        <AllMemesGrid
          memes={vm.memes}
          loading={vm.loading}
          loadingMore={vm.loadingMore}
          error={vm.error}
          onRetry={vm.reload}
          loadMoreRef={vm.loadMoreRef}
          autoplayPreview={autoplayPreview}
          onSelectMeme={onSelectMeme}
          showEmptyState={!showStarterPanel}
        />
      </div>
    </section>
  );
}

