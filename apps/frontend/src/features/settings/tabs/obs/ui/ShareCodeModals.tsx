import toast from 'react-hot-toast';

type TFn = (key: string, opts?: any) => string;

export function ShareCodeModals(props: {
  t: TFn;
  exportOpen: boolean;
  importOpen: boolean;
  exportCode: string;
  importText: string;
  setImportText: (v: string) => void;
  onApplyImport: () => void;
  onCloseExport: () => void;
  onCloseImport: () => void;
  onClearImportAndClose: () => void;
}) {
  const { t, exportOpen, importOpen, exportCode, importText, setImportText, onApplyImport, onCloseExport, onCloseImport, onClearImportAndClose } =
    props;

  return (
    <>
      {exportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 modal-backdrop-in"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onCloseExport();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('admin.overlayShareExportTitle', { defaultValue: 'Export settings' })}
            className="relative w-full max-w-2xl glass p-5 rounded-2xl border border-white/20 dark:border-white/10 shadow-2xl modal-pop-in"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t('admin.overlayShareExportTitle', { defaultValue: 'Export settings' })}
                </div>
                <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                  {t('admin.overlayShareExportHint', { defaultValue: 'Copy the code and share it (or save it).' })}
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg p-2 text-gray-600 hover:text-gray-900 dark:text-gray-200 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10"
                onClick={onCloseExport}
                aria-label={t('common.close', { defaultValue: 'Close' })}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                {t('admin.overlayShareCode', { defaultValue: 'Code' })}
              </div>
              <textarea
                value={exportCode}
                readOnly
                className="w-full h-28 rounded-xl px-3 py-2 bg-white/70 dark:bg-white/10 text-gray-900 dark:text-white font-mono text-xs focus:outline-none"
              />
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  className="glass-btn px-4 py-2 text-sm font-semibold bg-primary text-white border border-primary/30"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(exportCode);
                      toast.success(t('admin.copied', { defaultValue: 'Copied' }));
                    } catch {
                      toast.error(t('admin.copyFailed', { defaultValue: 'Copy failed' }));
                    }
                  }}
                >
                  {t('admin.copyCode', { defaultValue: 'Copy code' })}
                </button>
                <button
                  type="button"
                  className="glass-btn px-4 py-2 text-sm font-semibold bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white border border-white/20 dark:border-white/10"
                  onClick={onCloseExport}
                >
                  {t('common.close', { defaultValue: 'Close' })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 modal-backdrop-in"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onCloseImport();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('admin.overlayShareImportTitle', { defaultValue: 'Import settings' })}
            className="relative w-full max-w-2xl glass p-5 rounded-2xl border border-white/20 dark:border-white/10 shadow-2xl modal-pop-in"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t('admin.overlayShareImportTitle', { defaultValue: 'Import settings' })}
                </div>
                <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                  {t('admin.overlayShareImportHint', { defaultValue: 'Paste the code and click “Apply”.' })}
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg p-2 text-gray-600 hover:text-gray-900 dark:text-gray-200 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10"
                onClick={onCloseImport}
                aria-label={t('common.close', { defaultValue: 'Close' })}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mt-4">
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={t('admin.overlayShareImportPlaceholder', { defaultValue: 'MA1....' })}
                className="w-full h-28 rounded-xl px-3 py-2 bg-white/70 dark:bg-white/10 text-gray-900 dark:text-white font-mono text-xs focus:outline-none"
              />
            </div>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                className="glass-btn px-4 py-2 text-sm font-semibold bg-primary text-white border border-primary/30 disabled:opacity-50"
                onClick={onApplyImport}
                disabled={!importText.trim()}
              >
                {t('admin.overlayShareApply', { defaultValue: 'Apply' })}
              </button>
              <button
                type="button"
                className="glass-btn px-4 py-2 text-sm font-semibold bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white border border-white/20 dark:border-white/10"
                onClick={onClearImportAndClose}
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


