import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';

export function BetaAccessManagement() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<Array<Record<string, unknown>>>([]);
  const [grantedUsers, setGrantedUsers] = useState<Array<Record<string, unknown>>>([]);
  const [revokedUsers, setRevokedUsers] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [grantedLoading, setGrantedLoading] = useState(true);
  const [revokedLoading, setRevokedLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const requestsLoadedRef = useRef(false);
  const grantedLoadedRef = useRef(false);
  const revokedLoadedRef = useRef(false);

  const loadRequests = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && requestsLoadedRef.current) return; // Prevent duplicate requests
    
    try {
      setLoading(true);
      requestsLoadedRef.current = true;
      const requests = await api.get<Array<Record<string, unknown>>>('/owner/beta/requests');
      setRequests(requests);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      requestsLoadedRef.current = false; // Reset on error to allow retry
      toast.error(apiError.response?.data?.error || t('toast.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadGrantedUsers = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && grantedLoadedRef.current) return; // Prevent duplicate requests

    try {
      setGrantedLoading(true);
      grantedLoadedRef.current = true;
      const users = await api.get<Array<Record<string, unknown>>>('/owner/beta/users');
      setGrantedUsers(users);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      grantedLoadedRef.current = false; // Reset on error to allow retry
      toast.error(apiError.response?.data?.error || t('toast.failedToLoad'));
    } finally {
      setGrantedLoading(false);
    }
  }, [t]);

  const loadRevokedUsers = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && revokedLoadedRef.current) return; // Prevent duplicate requests

    try {
      setRevokedLoading(true);
      revokedLoadedRef.current = true;
      const revoked = await api.get<Array<Record<string, unknown>>>('/owner/beta/users/revoked');
      setRevokedUsers(revoked);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      revokedLoadedRef.current = false; // Reset on error to allow retry
      toast.error(apiError.response?.data?.error || t('toast.failedToLoad'));
    } finally {
      setRevokedLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadRequests();
    loadGrantedUsers();
    loadRevokedUsers();
  }, [loadRequests, loadGrantedUsers, loadRevokedUsers]);

  const handleApprove = async (requestId: string) => {
    try {
      await api.post(`/owner/beta/requests/${requestId}/approve`);
      toast.success(t('toast.betaAccessApproved'));
      await Promise.all([
        loadRequests({ force: true }),
        loadGrantedUsers({ force: true }),
        loadRevokedUsers({ force: true }),
      ]);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('toast.failedToApprove'));
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      await api.post(`/owner/beta/requests/${requestId}/reject`);
      toast.success(t('toast.betaAccessRejected'));
      await Promise.all([
        loadRequests({ force: true }),
        loadGrantedUsers({ force: true }),
        loadRevokedUsers({ force: true }),
      ]);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('toast.failedToReject'));
    }
  };

  const handleRevoke = async (targetUserId: string, displayName?: string) => {
    const label = displayName ? `@${displayName}` : targetUserId;
    const confirmed = window.confirm(t('admin.betaAccessRevokeConfirm', { user: label }));
    if (!confirmed) return;

    try {
      await api.post(`/owner/beta/users/${targetUserId}/revoke`);
      toast.success(t('toast.betaAccessRevoked'));
      await Promise.all([
        loadRequests({ force: true }),
        loadGrantedUsers({ force: true }),
        loadRevokedUsers({ force: true }),
      ]);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('toast.failedToRevoke'));
    }
  };

  const handleRestore = async (targetUserId: string, displayName?: string) => {
    const label = displayName ? `@${displayName}` : targetUserId;
    const confirmed = window.confirm(t('admin.betaAccessRestoreConfirm', { user: label }));
    if (!confirmed) return;

    try {
      await api.post(`/owner/beta/users/${targetUserId}/restore`);
      toast.success(t('toast.betaAccessRestored'));
      await Promise.all([
        loadRequests({ force: true }),
        loadGrantedUsers({ force: true }),
        loadRevokedUsers({ force: true }),
      ]);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('toast.failedToRestore'));
    }
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold ${colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  if (loading) {
    return <div className="text-center py-8">{t('common.loading')}</div>;
  }

  const filteredGrantedUsers = grantedUsers.filter((u: Record<string, unknown>) => {
    const user = u as { displayName?: string; twitchUserId?: string };
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      (user.displayName || '').toLowerCase().includes(q) ||
      (user.twitchUserId || '').toLowerCase().includes(q)
    );
  });

  const filteredRevokedUsers = revokedUsers.filter((r: Record<string, unknown>) => {
    const row = r as { user?: { displayName?: string; twitchUserId?: string } };
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      (row.user?.displayName || '').toLowerCase().includes(q) ||
      (row.user?.twitchUserId || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold dark:text-white">{t('admin.betaAccessRequests')}</h2>
      
      {requests.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          {t('admin.noBetaAccessRequests')}
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((request: Record<string, unknown>) => {
            const r = request as { id: string; status: string; requestedAt: string; approvedAt?: string; user?: { displayName: string; twitchUserId: string } };
            return (
            <div key={r.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {r.user?.displayName || 'Unknown User'}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {r.user?.twitchUserId || 'N/A'}
                  </div>
                </div>
                {getStatusBadge(r.status)}
              </div>
              
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                <div>Requested: {new Date(r.requestedAt).toLocaleString()}</div>
                {r.approvedAt && (
                  <div>Processed: {new Date(r.approvedAt).toLocaleString()}</div>
                )}
              </div>

              {r.status === 'pending' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(r.id)}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded transition-colors"
                  >
                    {t('admin.approve')}
                  </button>
                  <button
                    onClick={() => handleReject(r.id)}
                    className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
                  >
                    {t('admin.reject')}
                  </button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h3 className="text-xl font-bold dark:text-white">{t('admin.betaAccessGranted')}</h3>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('admin.searchUsers', 'Search users...')}
            className="w-full max-w-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
        </div>

        {grantedLoading ? (
          <div className="text-center py-6">{t('common.loading')}</div>
        ) : filteredGrantedUsers.length === 0 ? (
          <div className="text-center py-6 text-gray-500 dark:text-gray-400">
            {t('admin.noGrantedBetaUsers')}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredGrantedUsers.map((u: Record<string, unknown>) => {
              const user = u as { id: string; displayName: string; twitchUserId?: string; role?: string; hasBetaAccess?: boolean };
              return (
                <div key={user.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-white">{user.displayName || user.id}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {user.twitchUserId || 'N/A'}{user.role ? ` • ${user.role}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 rounded text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        {t('admin.betaAccessGrantedBadge', 'granted')}
                      </span>
                      <button
                        onClick={() => handleRevoke(user.id, user.displayName)}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
                      >
                        {t('admin.revoke', 'Revoke')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h3 className="text-xl font-bold dark:text-white">{t('admin.betaAccessRevoked')}</h3>
        </div>

        {revokedLoading ? (
          <div className="text-center py-6">{t('common.loading')}</div>
        ) : filteredRevokedUsers.length === 0 ? (
          <div className="text-center py-6 text-gray-500 dark:text-gray-400">
            {t('admin.noRevokedBetaUsers')}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRevokedUsers.map((row: Record<string, unknown>) => {
              const r = row as {
                id: string;
                approvedAt?: string | null;
                user: { id: string; displayName: string; twitchUserId?: string; role?: string };
              };
              return (
                <div key={r.user.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-white">{r.user.displayName || r.user.id}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {r.user.twitchUserId || 'N/A'}{r.user.role ? ` • ${r.user.role}` : ''}
                      </div>
                      {r.approvedAt && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {t('admin.revokedAt', { defaultValue: 'Revoked:' })} {new Date(r.approvedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 rounded text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                        {t('admin.betaAccessRevokedBadge', { defaultValue: 'revoked' })}
                      </span>
                      <button
                        onClick={() => handleRestore(r.user.id, r.user.displayName)}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded transition-colors"
                      >
                        {t('admin.restore', { defaultValue: 'Restore' })}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


