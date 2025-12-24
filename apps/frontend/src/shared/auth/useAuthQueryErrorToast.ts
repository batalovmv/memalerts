import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

type Options = {
  /**
   * If true, removes error params from URL after showing the toast (default true).
   */
  clearFromUrl?: boolean;
};

export function useAuthQueryErrorToast(options?: Options): void {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const clearFromUrl = options?.clearFromUrl ?? true;

  useEffect(() => {
    const error = searchParams.get('error');
    const reason = searchParams.get('reason');
    const details = searchParams.get('details');
    const provider = searchParams.get('provider');

    if (error !== 'auth_failed' && error !== 'auth_required') return;

    let errorMessage =
      error === 'auth_required'
        ? t('auth.authRequired', { defaultValue: 'Please sign in to continue.' })
        : t('auth.authFailed', { defaultValue: 'Authentication failed. Please try again.' });

    if (reason) {
      switch (reason) {
        case 'account_already_linked':
          errorMessage = t('auth.accountAlreadyLinked', {
            defaultValue: 'This account is already linked to another user.',
          });
          break;
        case 'provider_not_supported': {
          const prettyProvider = provider ? String(provider) : 'provider';
          errorMessage = t('auth.providerNotSupported', {
            defaultValue: `This provider is not supported yet: ${prettyProvider}.`,
            provider: prettyProvider,
          });
          break;
        }
        case 'no_session':
          errorMessage = t('auth.noSession', { defaultValue: 'Please sign in to link accounts.' });
          break;
        case 'no_client_id':
          errorMessage = 'Authentication error: Client ID not configured.';
          break;
        case 'no_callback_url':
          errorMessage = 'Authentication error: Callback URL not configured.';
          break;
        case 'no_code':
          errorMessage = 'Authentication error: No authorization code received.';
          break;
        case 'no_token':
          errorMessage = 'Authentication error: Failed to get access token.';
          break;
        case 'no_user':
          errorMessage = 'Authentication error: Failed to get user information.';
          break;
        case 'user_null':
          errorMessage = 'Authentication error: User creation failed.';
          break;
        case 'exception': {
          if (details) {
            try {
              const decoded = decodeURIComponent(details);
              errorMessage = `Authentication error: ${decoded}`;
            } catch {
              errorMessage = 'Authentication error: An unexpected error occurred.';
            }
          } else {
            errorMessage = 'Authentication error: An unexpected error occurred.';
          }
          break;
        }
        default:
          errorMessage = `Authentication failed: ${reason}`;
      }
    }

    toast.error(errorMessage);

    if (!clearFromUrl) return;

    const next = new URLSearchParams(searchParams);
    next.delete('error');
    next.delete('reason');
    next.delete('details');
    next.delete('provider');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams, clearFromUrl]);
}


