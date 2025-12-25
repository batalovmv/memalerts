import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { Button, Card, Input } from '@/shared/ui';

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
        <Button
          onClick={() => {
            promotionsLoadedRef.current = false; // Reset to allow reload
            fetchPromotions();
          }}
          variant="primary"
        >
          Retry
        </Button>
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="surface p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{t('admin.promotions')}</h2>
          <Button
            onClick={() => setShowCreateForm(!showCreateForm)}
            variant={showCreateForm ? 'secondary' : 'primary'}
          >
            {showCreateForm ? t('common.cancel') : t('admin.createPromotion')}
          </Button>
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreate} className="mb-6 p-4 glass rounded-xl space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('admin.name')}</label>
              <Input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('admin.discountPercent')}
              </label>
              <Input
                type="number"
                value={formData.discountPercent}
                onChange={(e) => setFormData({ ...formData, discountPercent: e.target.value })}
                required
                min="0"
                max="100"
                step="0.1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('admin.startDate')}</label>
                <Input
                  type="datetime-local"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('admin.endDate')}</label>
                <Input
                  type="datetime-local"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  required
                />
              </div>
            </div>
            <Button type="submit" variant="success">
              {t('admin.create')}
            </Button>
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
                <Card
                  key={p.id}
                  className={`p-4 ${isCurrentlyActive ? 'ring-2 ring-emerald-500/25' : ''}`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg text-gray-900 dark:text-white">{p.name}</h3>
                      <p className="text-accent font-bold">
                        {p.discountPercent}% {t('admin.discount', { defaultValue: 'discount' })}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {startDate.toLocaleString()} - {endDate.toLocaleString()}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <span
                        className={`px-2 py-1 rounded-lg text-xs font-semibold ring-1 ${
                          p.isActive
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 ring-emerald-500/20'
                            : 'bg-black/5 dark:bg-white/10 text-gray-700 dark:text-gray-200 ring-black/5 dark:ring-white/10'
                        }`}
                      >
                        {p.isActive ? t('admin.active') : t('admin.inactive')}
                      </span>
                      {isCurrentlyActive && (
                        <span className="px-2 py-1 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 ring-1 ring-emerald-500/25">
                          {t('admin.currentlyRunning')}
                        </span>
                      )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleToggleActive(p.id, p.isActive)}
                        variant={p.isActive ? 'warning' : 'success'}
                        size="sm"
                      >
                        {p.isActive ? t('admin.deactivate') : t('admin.activate')}
                      </Button>
                      <Button onClick={() => handleDelete(p.id)} variant="danger" size="sm">
                        {t('common.delete')}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}


