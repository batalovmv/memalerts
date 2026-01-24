import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type GlobalErrorKind = 'api' | 'render';

type GlobalErrorPayload = {
  kind: GlobalErrorKind;
  message: string;
  requestId?: string | null;
  status?: number | null;
  path?: string | null;
  method?: string | null;
  ts?: string;
};

function isBeta(): boolean {
  return window.location.hostname.includes('beta.');
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ignore and fallback
  }

  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', 'true');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    el.style.top = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export default function GlobalErrorBanner() {
  const { t } = useTranslation();
  const [err, setErr] = useState<GlobalErrorPayload | null>(null);
  const [openDetails, setOpenDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  const showIdInline = useMemo(() => isBeta(), []);

  useEffect(() => {
    const onApiError = (e: Event) => {
      const ce = e as CustomEvent<GlobalErrorPayload>;
      if (!ce?.detail) return;
      setErr(ce.detail);
      setOpenDetails(false);
      setCopied(false);
    };
    window.addEventListener('memalerts:globalError', onApiError as EventListener);
    return () => {
      window.removeEventListener('memalerts:globalError', onApiError as EventListener);
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  if (!err) return null;

  const id = err.requestId || null;
  const title =
    err.kind === 'render'
      ? t('common.unexpectedError', { defaultValue: 'Unexpected error' })
      : t('common.requestFailed', { defaultValue: 'Request failed' });

  const onCopyId = async () => {
    if (!id) return;
    const ok = await copyToClipboard(id);
    setCopied(ok);
    if (ok) {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="fixed left-0 right-0 bottom-0 z-50">
      <div className="mx-auto max-w-4xl px-4 pb-safe">
        <div className="mb-4 rounded-xl border border-red-200/70 bg-white/95 shadow-lg backdrop-blur dark:border-red-900/40 dark:bg-zinc-900/95">
          <div className="flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-red-700 dark:text-red-300">{title}</div>
              <div className="mt-1 text-sm text-gray-800 dark:text-gray-200 break-words">
                {err.message || t('common.error', { defaultValue: 'Error' })}
              </div>

              {id && showIdInline && (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                  <div className="select-text">
                    {t('common.errorId', { defaultValue: 'Error ID' })}: <span className="font-mono">{id}</span>
                  </div>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
                    onClick={onCopyId}
                  >
                    {copied ? t('common.copied', { defaultValue: 'Copied' }) : t('common.copyId', { defaultValue: 'Copy ID' })}
                  </button>
                </div>
              )}

              {id && !showIdInline && (
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-gray-700 underline decoration-gray-400/70 underline-offset-2 dark:text-gray-300"
                  onClick={() => setOpenDetails((v) => !v)}
                >
                  {openDetails ? t('common.hideDetails', { defaultValue: 'Hide details' }) : t('common.details', { defaultValue: 'Details' })}
                </button>
              )}

              {openDetails && id && !showIdInline && (
                <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:bg-white/5 dark:text-gray-300 select-text">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      {t('common.errorId', { defaultValue: 'Error ID' })}: <span className="font-mono">{id}</span>
                    </div>
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10 select-none"
                      onClick={onCopyId}
                    >
                      {copied ? t('common.copied', { defaultValue: 'Copied' }) : t('common.copyId', { defaultValue: 'Copy ID' })}
                    </button>
                  </div>
                  {(err.method || err.path || err.status) && (
                    <div className="mt-1 font-mono opacity-80">
                      {err.method ? `${err.method} ` : ''}
                      {err.path ? err.path : ''}
                      {typeof err.status === 'number' ? ` (${err.status})` : ''}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
              onClick={() => setErr(null)}
            >
              {t('common.close', { defaultValue: 'Close' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



