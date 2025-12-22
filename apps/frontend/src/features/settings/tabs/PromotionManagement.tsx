import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

export function PromotionManagement() {
  const { t } = useTranslation();
  const [promotions, setPromotions] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const promotionsLoadedRef = useRef(false);
  const [formData, setFormData] = useState({
    name: '',
    discountPercent: '',
    startDate: '',
    endDate: '',
  });

  const fetchPromotions = useCallback(async () => {
    if (promotionsLoadedRef.current) return; // Prevent duplicate requests
    
    try {
      setLoading(true);
      setError(null);
      promotionsLoadedRef.current = true;
      const { api } = await import('@/lib/api');
      const promotions = await api.get<Array<Record<string, unknown>>>('/streamer/promotions');
      setPromotions(promotions);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const errorMessage = apiError.response?.data?.error || 'Failed to load promotions';
      promotionsLoadedRef.current = false; // Reset on error to allow retry
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPromotions();
  }, [fetchPromotions]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { api } = await import('@/lib/api');
      await api.post('/streamer/promotions', {
        name: formData.name,
        discountPercent: parseFloat(formData.discountPercent),
        startDate: new Date(formData.startDate).toISOString(),
        endDate: new Date(formData.endDate).toISOString(),
      });
      toast.success(t('admin.promotionCreated'));
      setShowCreateForm(false);
      setFormData({ name: '', discountPercent: '', startDate: '', endDate: '' });
      promotionsLoadedRef.current = false; // Reset to allow reload
      fetchPromotions();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToCreatePromotion') || 'Failed to create promotion');
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      const { api } = await import('@/lib/api');
      await api.patch(`/streamer/promotions/${id}`, { isActive: !currentActive });
      toast.success(!currentActive ? t('admin.promotionActivated') : t('admin.promotionDeactivated'));
      promotionsLoadedRef.current = false; // Reset to allow reload
      fetchPromotions();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToUpdatePromotion') || 'Failed to update promotion');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('admin.deletePromotion'))) return;
    try {
      const { api } = await import('@/lib/api');
      await api.delete(`/streamer/promotions/${id}`);
      toast.success(t('admin.promotionDeleted'));
      promotionsLoadedRef.current = false; // Reset to allow reload
      fetchPromotions();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToDeletePromotion') || 'Failed to delete promotion');
    }
  };

  if (loading) {
    return <div className="text-center py-8">{t('admin.loadingPromotions')}</div>;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <button
          onClick={() => {
            promotionsLoadedRef.current = false; // Reset to allow reload
            fetchPromotions();
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">{t('admin.promotions')}</h2>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-primary hover:bg-secondary text-white px-4 py-2 rounded transition-colors"
          >
            {showCreateForm ? t('common.cancel') : t('admin.createPromotion')}
          </button>
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreate} className="mb-6 p-4 bg-gray-50 rounded-lg space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.name')}</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.discountPercent')}
              </label>
              <input
                type="number"
                value={formData.discountPercent}
                onChange={(e) => setFormData({ ...formData, discountPercent: e.target.value })}
                required
                min="0"
                max="100"
                step="0.1"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.startDate')}</label>
                <input
                  type="datetime-local"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.endDate')}</label>
                <input
                  type="datetime-local"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>
            <button
              type="submit"
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
            >
              {t('admin.create')}
            </button>
          </form>
        )}

        <div className="space-y-4">
          {promotions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">{t('admin.noPromotions')}</div>
          ) : (
            promotions.map((promo) => {
              const p = promo as { id: string; name: string; discountPercent: number; startDate: string | number | Date; endDate: string | number | Date; isActive: boolean };
              const startDate = new Date(p.startDate);
              const endDate = new Date(p.endDate);
              const isCurrentlyActive = p.isActive && now >= startDate && now <= endDate;
              
              return (
                <div
                  key={p.id}
                  className={`p-4 border rounded-lg ${
                    isCurrentlyActive ? 'border-green-500 bg-green-50' : 'border-gray-300'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg">{p.name}</h3>
                      <p className="text-accent font-bold">{p.discountPercent}% discount</p>
                      <p className="text-sm text-gray-600">
                        {startDate.toLocaleString()} - {endDate.toLocaleString()}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <span
                        className={`px-2 py-1 rounded text-xs ${
                          p.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {p.isActive ? t('admin.active') : t('admin.inactive')}
                      </span>
                      {isCurrentlyActive && (
                        <span className="px-2 py-1 rounded text-xs bg-green-200 text-green-900">
                          {t('admin.currentlyRunning')}
                        </span>
                      )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleToggleActive(p.id, p.isActive)}
                        className={`px-3 py-1 rounded text-sm ${
                          p.isActive
                            ? 'bg-yellow-600 hover:bg-yellow-700'
                            : 'bg-green-600 hover:bg-green-700'
                        } text-white`}
                      >
                        {p.isActive ? t('admin.deactivate') : t('admin.activate')}
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}


