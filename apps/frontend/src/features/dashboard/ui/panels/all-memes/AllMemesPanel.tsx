import { useTranslation } from 'react-i18next';

import { PanelHeader } from '../../PanelHeader';

import { useAllMemesPanel } from './model/useAllMemesPanel';
import { AllMemesControls } from './ui/AllMemesControls';
import { AllMemesGrid } from './ui/AllMemesGrid';

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
              `${vm.memes.length}`
            )}
          </span>
        }
        onClose={onClose}
      />

      <div className="surface-body">
        <AllMemesControls
          query={vm.query}
          onQueryChange={vm.setQuery}
          searchScope={vm.searchScope}
          onSearchScopeChange={vm.setSearchScope}
          sortBy={vm.filters.sortBy}
          sortOrder={vm.filters.sortOrder}
          onSortChange={(sortBy, sortOrder) => vm.setFilters({ sortBy, sortOrder })}
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
        />
      </div>
    </section>
  );
}


