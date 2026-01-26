import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import type { DashboardCardId, ExpandCard } from '@/features/dashboard/types';
import type { MemeDetail } from '@memalerts/api-contracts';

import Header from '@/components/Header';
import { useHelpMode } from '@/contexts/HelpModeContext';
import { useDashboardBots } from '@/features/dashboard/model/useDashboardBots';
import { useDashboardModeration } from '@/features/dashboard/model/useDashboardModeration';
import { useDashboardSubmissions } from '@/features/dashboard/model/useDashboardSubmissions';
import { useDashboardSubmissionsControl } from '@/features/dashboard/model/useDashboardSubmissionsControl';
import { useMySubmissions } from '@/features/dashboard/model/useMySubmissions';
import { DashboardExpandedPanel } from '@/features/dashboard/ui/DashboardExpandedPanel';
import { DashboardHeader } from '@/features/dashboard/ui/DashboardHeader';
import { DashboardModals } from '@/features/dashboard/ui/DashboardModals';
import { DashboardPanels } from '@/features/dashboard/ui/DashboardPanels';
import { DashboardQuickActionsGrid } from '@/features/dashboard/ui/DashboardQuickActionsGrid';
import { BulkUploadPanel } from '@/features/dashboard/ui/panels/bulk-upload/BulkUploadPanel';
import { useAutoplayMemes } from '@/shared/lib/hooks';
import { Button, PageShell, Spinner } from '@/shared/ui';
import { useAppSelector } from '@/store/hooks';

const DEFAULT_DASHBOARD_ORDER: DashboardCardId[] = [
  'submit',
  'mySubmissions',
  'memes',
  'settings',
  'submissionsControl',
  'bots',
];

const DashboardPage = memo(function DashboardPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const { enabled: helpEnabled, setEnabled: setHelpEnabled } = useHelpMode();

  const [submissionsPanelTab, setSubmissionsPanelTab] = useState<'pending' | 'mine'>('pending');
  const [selectedMeme, setSelectedMeme] = useState<MemeDetail | null>(null);
  const [isMemeModalOpen, setIsMemeModalOpen] = useState(false);
  const { autoplayMemesEnabled } = useAutoplayMemes();
  const submissionsPanelRef = useRef<HTMLDivElement>(null);
  const memesPanelRef = useRef<HTMLDivElement>(null);
  const [expandedCard, setExpandedCard] = useState<ExpandCard>(null);


  const panel = (searchParams.get('panel') || '').toLowerCase();
  const legacyTab = searchParams.get('tab');
  const activePanel = panel === 'submissions' || panel === 'memes' ? panel : null;
  const isPanelOpen = activePanel !== null;
  const {
    submissions,
    submissionsLoading,
    submissionsLoadingMore,
    submissionsTotal,
    submissionsError,
    pendingFilters,
    setPendingFilters,
    pendingSubmissionsCount,
    loadMorePending,
    retryPending,
    refreshPending,
  } = useDashboardSubmissions({ user });
  const { mySubmissions, mySubmissionsLoading, loadMySubmissions } = useMySubmissions({
    user,
    shouldAutoLoad: activePanel === 'submissions' && submissionsPanelTab === 'mine',
  });
  const { botsLoaded, botsLoading, visibleBots, anyBotEnabled, allBotsEnabled, toggleAllBots } = useDashboardBots({ user });
  const {
    memesCount,
    submissionsEnabled,
    submissionsOnlyWhenLive,
    autoApproveEnabled,
    savingSubmissionsSettings,
    savingAutoApprove,
    memeCatalogMode,
    savingMemeCatalogMode,
    submissionsControl,
    submissionsControlStatus,
    rotatingSubmissionsControl,
    setSubmissionsEnabled,
    setSubmissionsOnlyWhenLive,
    setAutoApproveEnabled,
    setMemeCatalogMode,
    saveSubmissionSettings,
    saveAutoApproveEnabled,
    saveMemeCatalogMode,
    rotateSubmissionsControlLink,
  } = useDashboardSubmissionsControl({ user });
  const {
    approveModal,
    rejectModal,
    needsChangesModal,
    bulkModal,
    priceCoins,
    approveTags,
    rejectReason,
    needsChangesPreset,
    needsChangesText,
    bulkPriceCoins,
    bulkRejectReason,
    bulkNeedsChangesPreset,
    bulkNeedsChangesText,
    bulkActionLoading,
    needsChangesRemainingResubmits,
    bulkCount,
    bulkCheckboxBase,
    setPriceCoins,
    setApproveTags,
    setRejectReason,
    setNeedsChangesPreset,
    setNeedsChangesText,
    setBulkPriceCoins,
    setBulkRejectReason,
    setBulkNeedsChangesPreset,
    setBulkNeedsChangesText,
    openApproveModal,
    openRejectModal,
    openNeedsChangesModal,
    openBulkModalFor,
    closeApproveModal,
    closeRejectModal,
    closeNeedsChangesModal,
    closeBulkModal,
    handleApprove,
    handleReject,
    handleNeedsChanges,
    handleBulkConfirm,
  } = useDashboardModeration({ submissions, refreshPending });

  const setPanel = useCallback((next: 'submissions' | 'memes' | null, replace = false) => {
    const nextParams = new URLSearchParams(searchParams);
    // Back-compat: remove older tab param
    nextParams.delete('tab');
    if (next) nextParams.set('panel', next);
    else nextParams.delete('panel');
    setSearchParams(nextParams, { replace });
  }, [searchParams, setSearchParams]);

  const scrollToPanelIfMobile = useCallback((next: 'submissions' | 'memes') => {
    const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    if (!isMobile) return;
    const target = next === 'submissions' ? submissionsPanelRef.current : memesPanelRef.current;
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // When panel is opened via URL (e.g. from Header bell), auto-scroll on mobile.
  useEffect(() => {
    if (panel === 'submissions') scrollToPanelIfMobile('submissions');
    if (panel === 'memes') scrollToPanelIfMobile('memes');
  }, [panel, scrollToPanelIfMobile]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  // Removed role restrictions - Dashboard is accessible to all users

  // Back-compat: if someone navigates to /dashboard?tab=submissions, open the submissions panel.
  // This must work even when Dashboard is already mounted (e.g. via Header bell click).
  useEffect(() => {
    const tabValue = (legacyTab || '').toLowerCase();
    if (tabValue === 'submissions' && panel !== 'submissions') {
      setPanel('submissions', true);
    }
  }, [legacyTab, panel, setPanel]);

  const myChannelMemesCount = memesCount ?? 0;
  const isStreamerAdmin = user?.role === 'streamer' || user?.role === 'admin';
  const effectiveCardOrder: DashboardCardId[] = isStreamerAdmin
    ? DEFAULT_DASHBOARD_ORDER
    : (['submit', 'mySubmissions', 'memes', 'settings'] as DashboardCardId[]);
  const memesCountText = memesCount === null ? '…' : String(myChannelMemesCount);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-700 dark:text-gray-200">
          <Spinner className="h-5 w-5" />
          <div className="text-base font-semibold">{t('common.loading', { defaultValue: 'Loading…' })}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageShell header={<Header />}>
        <div className="section-gap">
          <DashboardHeader helpEnabled={helpEnabled} onChangeHelpEnabled={setHelpEnabled} />

          {user.channelId ? (
            <>
              <DashboardQuickActionsGrid
                cardOrder={effectiveCardOrder}
                expandedCard={expandedCard}
                helpEnabled={helpEnabled}
                isMemesOpen={panel === 'memes'}
                isStreamerAdmin={isStreamerAdmin}
                memesCountText={memesCountText}
                pendingSubmissionsCount={pendingSubmissionsCount}
                submissionsEnabled={submissionsEnabled}
                anyBotEnabled={anyBotEnabled}
                onOpenSubmit={() => setIsSubmitModalOpen(true)}
                onOpenMySubmissions={() => {
                  setSubmissionsPanelTab('mine');
                  if (panel !== 'submissions') scrollToPanelIfMobile('submissions');
                  setPanel('submissions');
                }}
                onToggleMemes={() => {
                  const next = panel === 'memes' ? null : 'memes';
                  if (next) scrollToPanelIfMobile('memes');
                  setPanel(next);
                }}
                onOpenSettings={() => navigate('/settings?tab=settings')}
                onToggleSubmissionsControl={() => setExpandedCard((v) => (v === 'submissionsControl' ? null : 'submissionsControl'))}
                onToggleBots={() => setExpandedCard((v) => (v === 'bots' ? null : 'bots'))}
              />

              <div className="mt-6">
                <BulkUploadPanel />
              </div>

              {/* Expanded panel renders OUTSIDE the grid so the grid stays compact (cards 5/6 swap positions naturally). */}
              {(user.role === 'streamer' || user.role === 'admin') && (
                <DashboardExpandedPanel
                  expandedCard={expandedCard}
                  helpEnabled={helpEnabled}
                  submissionsEnabled={submissionsEnabled}
                  submissionsOnlyWhenLive={submissionsOnlyWhenLive}
                  autoApproveEnabled={autoApproveEnabled}
                  savingSubmissionsSettings={savingSubmissionsSettings}
                  savingAutoApprove={savingAutoApprove}
                  onToggleSubmissionsEnabled={(next) => {
                    setSubmissionsEnabled(next);
                    void saveSubmissionSettings({ submissionsEnabled: next }, 'enabled');
                  }}
                  onToggleOnlyWhenLive={(next) => {
                    setSubmissionsOnlyWhenLive(next);
                    void saveSubmissionSettings({ submissionsOnlyWhenLive: next }, 'onlyWhenLive');
                  }}
                  onToggleAutoApprove={(next) => {
                    setAutoApproveEnabled(next);
                    void saveAutoApproveEnabled(next);
                  }}
                  memeCatalogMode={memeCatalogMode}
                  savingMemeCatalogMode={savingMemeCatalogMode}
                  onChangeMemeCatalogMode={(nextMode) => {
                    setMemeCatalogMode(nextMode);
                    void saveMemeCatalogMode(nextMode);
                  }}
                  submissionsControl={submissionsControl}
                  submissionsControlStatus={submissionsControlStatus}
                  rotatingSubmissionsControl={rotatingSubmissionsControl}
                  onRotateSubmissionsControl={() => void rotateSubmissionsControlLink()}
                  botsLoading={botsLoading}
                  botsLoaded={botsLoaded}
                  visibleBots={visibleBots}
                  anyBotEnabled={anyBotEnabled}
                  allBotsEnabled={allBotsEnabled}
                  onToggleAllBots={(nextEnabled) => void toggleAllBots(nextEnabled)}
                  onClose={() => setExpandedCard(null)}
                />
              )}

              {/* Expandable panels */}
              <DashboardPanels
                panel={activePanel}
                isPanelOpen={isPanelOpen}
                submissionsPanelRef={submissionsPanelRef}
                memesPanelRef={memesPanelRef}
                submissionsPanelProps={{
                  activeTab: submissionsPanelTab,
                  onTabChange: (nextTab) => {
                    setSubmissionsPanelTab(nextTab);
                    if (nextTab === 'mine') {
                      // Ensure we load as soon as user selects the tab.
                      void loadMySubmissions();
                    }
                  },
                  helpEnabled,
                  submissions,
                  submissionsLoading,
                  submissionsLoadingMore,
                  pendingError: submissionsError,
                  pendingCount: pendingSubmissionsCount,
                  total: submissionsTotal,
                  pendingFilters,
                  onPendingFiltersChange: setPendingFilters,
                  onClose: () => setPanel(null),
                  onLoadMorePending: loadMorePending,
                  onRetryPending: retryPending,
                  onApprove: openApproveModal,
                  onReject: openRejectModal,
                  onNeedsChanges: openNeedsChangesModal,
                  onBulkAction: openBulkModalFor,
                  mySubmissions,
                  mySubmissionsLoading,
                  onRefreshMySubmissions: () => void loadMySubmissions({ force: true }),
                }}
                memesPanelProps={{
                  channelId: user.channelId,
                  autoplayPreview: autoplayMemesEnabled ? 'autoplayMuted' : 'hoverWithSound',
                  onClose: () => setPanel(null),
                  onSelectMeme: (meme) => {
                    setSelectedMeme(meme);
                    setIsMemeModalOpen(true);
                  },
                }}
              />
            </>
          ) : (
            <div className="surface p-6">
              <div className="text-base font-semibold text-gray-900 dark:text-white">
                {t('dashboard.noChannelTitle', { defaultValue: "You're not a streamer yet" })}
              </div>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                {t('dashboard.noChannel', { defaultValue: "You don't have a channel yet. You can still browse memes and request beta access." })}
              </p>
              <div className="mt-5 flex flex-col sm:flex-row gap-3">
                <Button type="button" variant="secondary" onClick={() => navigate('/search')}>
                  {t('dashboard.browseMemes', { defaultValue: 'Browse memes' })}
                </Button>
                <Button type="button" variant="primary" onClick={() => navigate('/settings?tab=beta')}>
                  {t('dashboard.requestBeta', { defaultValue: 'Request beta access' })}
                </Button>
              </div>
            </div>
          )}
        </div>
      </PageShell>

      <DashboardModals
        channelId={user.channelId}
        channelSlug={user.channel?.slug}
        isSubmitModalOpen={isSubmitModalOpen}
        onCloseSubmitModal={() => setIsSubmitModalOpen(false)}
        isMemeModalOpen={isMemeModalOpen}
        selectedMeme={selectedMeme}
        onCloseMemeModal={() => {
          setIsMemeModalOpen(false);
          setSelectedMeme(null);
        }}
        approveModalOpen={approveModal.open}
        approveSubmission={submissions.find((s) => s.id === approveModal.submissionId) || null}
        priceCoins={priceCoins}
        onPriceCoinsChange={setPriceCoins}
        approveTags={approveTags}
        onApproveTagsChange={setApproveTags}
        onCloseApproveModal={closeApproveModal}
        onApprove={handleApprove}
        needsChangesModalOpen={needsChangesModal.open}
        needsChangesRemainingResubmits={needsChangesRemainingResubmits}
        needsChangesPreset={needsChangesPreset}
        onNeedsChangesPresetChange={setNeedsChangesPreset}
        needsChangesText={needsChangesText}
        onNeedsChangesTextChange={setNeedsChangesText}
        onCloseNeedsChangesModal={closeNeedsChangesModal}
        onSendNeedsChanges={handleNeedsChanges}
        rejectModalOpen={rejectModal.open}
        rejectReason={rejectReason}
        onRejectReasonChange={setRejectReason}
        onCloseRejectModal={closeRejectModal}
        onReject={handleReject}
        bulkModalOpen={bulkModal.open}
        bulkAction={bulkModal.action}
        bulkCount={bulkCount}
        bulkActionLoading={bulkActionLoading}
        bulkPriceCoins={bulkPriceCoins}
        onBulkPriceCoinsChange={setBulkPriceCoins}
        bulkRejectReason={bulkRejectReason}
        onBulkRejectReasonChange={setBulkRejectReason}
        bulkNeedsChangesPreset={bulkNeedsChangesPreset}
        onBulkNeedsChangesPresetChange={setBulkNeedsChangesPreset}
        bulkNeedsChangesText={bulkNeedsChangesText}
        onBulkNeedsChangesTextChange={setBulkNeedsChangesText}
        bulkCheckboxClassName={bulkCheckboxBase}
        onBulkConfirm={() => void handleBulkConfirm()}
        onCloseBulkModal={closeBulkModal}
      />
    </>
  );
});

export default DashboardPage;



