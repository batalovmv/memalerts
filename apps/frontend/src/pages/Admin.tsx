import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { fetchSubmissions, approveSubmission, rejectSubmission } from '../store/slices/submissionsSlice';
import { fetchMemes } from '../store/slices/memesSlice';
import UserMenu from '../components/UserMenu';
import VideoPreview from '../components/VideoPreview';
import toast from 'react-hot-toast';
import type { Meme } from '../types';

type TabType = 'submissions' | 'memes' | 'settings' | 'wallets' | 'promotions' | 'statistics';

export default function Admin() {
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const { submissions, loading: submissionsLoading, error: submissionsError } = useAppSelector((state) => state.submissions);
  const { memes } = useAppSelector((state) => state.memes);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('submissions');

  useEffect(() => {
    if (!authLoading && (!user || (user.role !== 'streamer' && user.role !== 'admin'))) {
      navigate('/dashboard');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user && (user.role === 'streamer' || user.role === 'admin')) {
      dispatch(fetchSubmissions({ status: 'pending' }));
      dispatch(fetchMemes({ channelId: user.channelId }));
    }
  }, [user, dispatch]);

  const handleApprove = async (submissionId: string): Promise<void> => {
    const priceCoinsStr = prompt('Enter price in coins:');
    const durationMsStr = prompt('Enter duration in milliseconds:');

    if (!priceCoinsStr || !durationMsStr) return;

    const priceCoins = parseInt(priceCoinsStr, 10);
    const durationMs = parseInt(durationMsStr, 10);

    if (isNaN(priceCoins) || isNaN(durationMs)) {
      toast.error('Invalid input');
      return;
    }

    try {
      await dispatch(approveSubmission({ submissionId, priceCoins, durationMs })).unwrap();
      toast.success('Submission approved!');
      dispatch(fetchSubmissions({ status: 'pending' }));
      if (user) {
        dispatch(fetchMemes({ channelId: user.channelId }));
      }
    } catch (error) {
      toast.error('Failed to approve submission');
    }
  };

  const handleReject = async (submissionId: string): Promise<void> => {
    try {
      await dispatch(rejectSubmission({ submissionId, moderatorNotes: null })).unwrap();
      toast.success('Submission rejected');
      dispatch(fetchSubmissions({ status: 'pending' }));
    } catch (error) {
      toast.error('Failed to reject submission');
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-bold">Admin Panel</h1>
            <UserMenu />
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex gap-4 border-b">
            <button
              onClick={() => setActiveTab('submissions')}
              className={`pb-2 px-4 ${
                activeTab === 'submissions'
                  ? 'border-b-2 border-purple-600 text-purple-600'
                  : 'text-gray-600'
              }`}
            >
              Pending Submissions ({submissions.length})
            </button>
            <button
              onClick={() => setActiveTab('memes')}
              className={`pb-2 px-4 ${
                activeTab === 'memes'
                  ? 'border-b-2 border-purple-600 text-purple-600'
                  : 'text-gray-600'
              }`}
            >
              All Memes ({memes.length})
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`pb-2 px-4 ${
                activeTab === 'settings'
                  ? 'border-b-2 border-purple-600 text-purple-600'
                  : 'text-gray-600'
              }`}
            >
              Channel Settings
            </button>
            {user?.role === 'admin' && (
              <button
                onClick={() => setActiveTab('wallets')}
                className={`pb-2 px-4 ${
                  activeTab === 'wallets'
                    ? 'border-b-2 border-purple-600 text-purple-600'
                    : 'text-gray-600'
                }`}
              >
                Wallet Management
              </button>
            )}
            <button
              onClick={() => setActiveTab('promotions')}
              className={`pb-2 px-4 ${
                activeTab === 'promotions'
                  ? 'border-b-2 border-purple-600 text-purple-600'
                  : 'text-gray-600'
              }`}
            >
              Promotions
            </button>
            <button
              onClick={() => setActiveTab('statistics')}
              className={`pb-2 px-4 ${
                activeTab === 'statistics'
                  ? 'border-b-2 border-purple-600 text-purple-600'
                  : 'text-gray-600'
              }`}
            >
              Statistics
            </button>
          </div>
        </div>

        {activeTab === 'submissions' && (
          <div className="space-y-4">
            {submissionsLoading ? (
              <div className="text-center py-8">Loading submissions...</div>
            ) : submissionsError ? (
              <div className="text-center py-8">
                <p className="text-red-600 dark:text-red-400 mb-4">{submissionsError}</p>
                <button
                  onClick={() => dispatch(fetchSubmissions({ status: 'pending' }))}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
                >
                  Retry
                </button>
              </div>
            ) : submissions.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <p>No pending submissions</p>
                <p className="text-sm mt-2">All submissions have been reviewed.</p>
              </div>
            ) : (
              submissions.map((submission) => (
                <div key={submission.id} className="bg-white rounded-lg shadow p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">{submission.title}</h3>
                      <p className="text-sm text-gray-600">
                        By {submission.submitter.displayName} • {submission.type}
                      </p>
                      {submission.notes && (
                        <p className="text-sm text-gray-500 mt-2">{submission.notes}</p>
                      )}
                      {submission.tags && submission.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {submission.tags.map((tagItem, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs"
                            >
                              {tagItem.tag.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Video Preview */}
                  <div className="mb-4">
                    <VideoPreview 
                      src={submission.fileUrlTemp} 
                      title={submission.title}
                      className="w-full"
                    />
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(submission.id)}
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleReject(submission.id)}
                      className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'memes' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {memes.map((meme: Meme) => (
              <div key={meme.id} className="bg-white rounded-lg shadow p-4">
                <h3 className="font-semibold mb-2">{meme.title}</h3>
                <p className="text-sm text-gray-600 mb-2">
                  {meme.priceCoins} coins • {meme.durationMs}ms
                </p>
                {meme.status && (
                  <p className="text-xs text-gray-500">Status: {meme.status}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'settings' && (
          <ChannelSettings />
        )}

        {activeTab === 'wallets' && user?.role === 'admin' && (
          <WalletManagement />
        )}

        {activeTab === 'promotions' && (
          <PromotionManagement />
        )}

        {activeTab === 'statistics' && (
          <ChannelStatistics />
        )}
      </main>
    </div>
  );
}

// Wallet Management Component (Admin only)
function WalletManagement() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');

  useEffect(() => {
    fetchWallets();
  }, []);

  const fetchWallets = async () => {
    try {
      setLoading(true);
      const { api } = await import('../lib/api');
      const response = await api.get('/admin/wallets');
      setWallets(response.data);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to load wallets');
    } finally {
      setLoading(false);
    }
  };

  const handleAdjust = async (userId: string, channelId: string) => {
    const amount = parseInt(adjustAmount, 10);
    if (isNaN(amount) || amount === 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    try {
      setAdjusting(`${userId}-${channelId}`);
      const { api } = await import('../lib/api');
      await api.post(`/admin/wallets/${userId}/${channelId}/adjust`, { amount });
      toast.success(`Balance ${amount > 0 ? 'increased' : 'decreased'} by ${Math.abs(amount)}`);
      setAdjustAmount('');
      fetchWallets();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to adjust balance');
    } finally {
      setAdjusting(null);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading wallets...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">All Wallets</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">User</th>
                <th className="text-left p-2">Channel</th>
                <th className="text-left p-2">Balance</th>
                <th className="text-left p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {wallets.map((wallet) => (
                <tr key={wallet.id} className="border-b">
                  <td className="p-2">{wallet.user.displayName}</td>
                  <td className="p-2">{wallet.channel.name}</td>
                  <td className="p-2 font-bold">{wallet.balance} coins</td>
                  <td className="p-2">
                    <div className="flex gap-2 items-center">
                      <input
                        type="number"
                        value={adjusting === `${wallet.userId}-${wallet.channelId}` ? adjustAmount : ''}
                        onChange={(e) => setAdjustAmount(e.target.value)}
                        placeholder="Amount"
                        className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
                        disabled={adjusting !== null && adjusting !== `${wallet.userId}-${wallet.channelId}`}
                      />
                      <button
                        onClick={() => handleAdjust(wallet.userId, wallet.channelId)}
                        disabled={adjusting !== null}
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-3 py-1 rounded text-sm"
                      >
                        {adjusting === `${wallet.userId}-${wallet.channelId}` ? 'Adjusting...' : 'Adjust'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {wallets.length === 0 && (
          <div className="text-center py-8 text-gray-500">No wallets found</div>
        )}
      </div>
    </div>
  );
}

// Channel Settings Component
function ChannelSettings() {
  const { user } = useAppSelector((state) => state.auth);
  const [settings, setSettings] = useState({
    rewardIdForCoins: '',
    coinPerPointRatio: '1.0',
    primaryColor: '',
    secondaryColor: '',
    accentColor: '',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load current settings
    if (user?.channelId) {
      loadSettings();
    }
  }, [user?.channelId]);

  const loadSettings = async () => {
    try {
      const { api } = await import('../lib/api');
      const response = await api.get('/channels/' + user?.channel?.slug);
      if (response.data) {
        setSettings({
          rewardIdForCoins: response.data.rewardIdForCoins || '',
          coinPerPointRatio: String(response.data.coinPerPointRatio || '1.0'),
          primaryColor: response.data.primaryColor || '',
          secondaryColor: response.data.secondaryColor || '',
          accentColor: response.data.accentColor || '',
        });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { api } = await import('../lib/api');
      await api.patch('/admin/channel/settings', {
        rewardIdForCoins: settings.rewardIdForCoins || null,
        coinPerPointRatio: parseFloat(settings.coinPerPointRatio) || 1.0,
        primaryColor: settings.primaryColor || null,
        secondaryColor: settings.secondaryColor || null,
        accentColor: settings.accentColor || null,
      });
      toast.success('Settings saved!');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold mb-4">Channel Settings</h2>
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Reward ID for Coins
          </label>
          <input
            type="text"
            value={settings.rewardIdForCoins}
            onChange={(e) => setSettings({ ...settings, rewardIdForCoins: e.target.value })}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2"
            placeholder="Twitch reward ID"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Coins per Point Ratio
          </label>
          <input
            type="number"
            step="0.1"
            value={settings.coinPerPointRatio}
            onChange={(e) => setSettings({ ...settings, coinPerPointRatio: e.target.value })}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2"
          />
        </div>

        <div className="border-t pt-4 mt-4">
          <h3 className="text-lg font-semibold mb-4">Color Customization</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Primary Color
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.primaryColor || '#9333ea'}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                  className="w-16 h-10 rounded border border-gray-300 dark:border-gray-600"
                />
                <input
                  type="text"
                  value={settings.primaryColor}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                  placeholder="#9333ea"
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Secondary Color
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.secondaryColor || '#4f46e5'}
                  onChange={(e) => setSettings({ ...settings, secondaryColor: e.target.value })}
                  className="w-16 h-10 rounded border border-gray-300 dark:border-gray-600"
                />
                <input
                  type="text"
                  value={settings.secondaryColor}
                  onChange={(e) => setSettings({ ...settings, secondaryColor: e.target.value })}
                  placeholder="#4f46e5"
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Accent Color
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.accentColor || '#ec4899'}
                  onChange={(e) => setSettings({ ...settings, accentColor: e.target.value })}
                  className="w-16 h-10 rounded border border-gray-300 dark:border-gray-600"
                />
                <input
                  type="text"
                  value={settings.accentColor}
                  onChange={(e) => setSettings({ ...settings, accentColor: e.target.value })}
                  placeholder="#ec4899"
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2"
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            These colors will be visible to visitors on your channel profile page
          </p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
        >
          {loading ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}

// Channel Statistics Component
function ChannelStatistics() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const { api } = await import('../lib/api');
      const response = await api.get('/admin/stats/channel');
      setStats(response.data);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading statistics...</div>;
  }

  if (!stats) {
    return <div className="text-center py-8 text-gray-500">No statistics available</div>;
  }

  return (
    <div className="space-y-6">
      {/* Overall Stats */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">Overall Statistics</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-purple-50 rounded-lg">
            <p className="text-3xl font-bold text-purple-600">{stats.overall.totalActivations}</p>
            <p className="text-sm text-gray-600">Total Activations</p>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <p className="text-3xl font-bold text-green-600">{stats.overall.totalCoinsSpent}</p>
            <p className="text-sm text-gray-600">Total Coins Spent</p>
          </div>
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <p className="text-3xl font-bold text-blue-600">{stats.overall.totalMemes}</p>
            <p className="text-sm text-gray-600">Total Memes</p>
          </div>
        </div>
      </div>

      {/* Top Users */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">Top Users by Spending</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">User</th>
                <th className="text-left p-2">Activations</th>
                <th className="text-left p-2">Total Coins</th>
              </tr>
            </thead>
            <tbody>
              {stats.userSpending.map((item: any) => (
                <tr key={item.user.id} className="border-b">
                  <td className="p-2">{item.user.displayName}</td>
                  <td className="p-2">{item.activationsCount}</td>
                  <td className="p-2 font-bold text-purple-600">{item.totalCoinsSpent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Memes */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">Most Popular Memes</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Meme</th>
                <th className="text-left p-2">Activations</th>
                <th className="text-left p-2">Total Coins</th>
              </tr>
            </thead>
            <tbody>
              {stats.memePopularity.map((item: any, index: number) => (
                <tr key={item.meme?.id || index} className="border-b">
                  <td className="p-2">{item.meme?.title || 'Unknown'}</td>
                  <td className="p-2">{item.activationsCount}</td>
                  <td className="p-2 font-bold text-purple-600">{item.totalCoinsSpent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Promotion Management Component
function PromotionManagement() {
  const [promotions, setPromotions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    discountPercent: '',
    startDate: '',
    endDate: '',
  });

  useEffect(() => {
    fetchPromotions();
  }, []);

  const fetchPromotions = async () => {
    try {
      setLoading(true);
      setError(null);
      const { api } = await import('../lib/api');
      const response = await api.get('/admin/promotions');
      setPromotions(response.data);
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || 'Failed to load promotions';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { api } = await import('../lib/api');
      await api.post('/admin/promotions', {
        name: formData.name,
        discountPercent: parseFloat(formData.discountPercent),
        startDate: new Date(formData.startDate).toISOString(),
        endDate: new Date(formData.endDate).toISOString(),
      });
      toast.success('Promotion created!');
      setShowCreateForm(false);
      setFormData({ name: '', discountPercent: '', startDate: '', endDate: '' });
      fetchPromotions();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create promotion');
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      const { api } = await import('../lib/api');
      await api.patch(`/admin/promotions/${id}`, { isActive: !currentActive });
      toast.success(`Promotion ${!currentActive ? 'activated' : 'deactivated'}`);
      fetchPromotions();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to update promotion');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this promotion?')) return;
    try {
      const { api } = await import('../lib/api');
      await api.delete(`/admin/promotions/${id}`);
      toast.success('Promotion deleted');
      fetchPromotions();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to delete promotion');
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading promotions...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <button
          onClick={fetchPromotions}
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
          <h2 className="text-2xl font-bold">Promotions</h2>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded"
          >
            {showCreateForm ? 'Cancel' : 'Create Promotion'}
          </button>
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreate} className="mb-6 p-4 bg-gray-50 rounded-lg space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
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
                Discount Percent (0-100)
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="datetime-local"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
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
              Create
            </button>
          </form>
        )}

        <div className="space-y-4">
          {promotions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No promotions yet</div>
          ) : (
            promotions.map((promo) => {
              const startDate = new Date(promo.startDate);
              const endDate = new Date(promo.endDate);
              const isCurrentlyActive = promo.isActive && now >= startDate && now <= endDate;
              
              return (
                <div
                  key={promo.id}
                  className={`p-4 border rounded-lg ${
                    isCurrentlyActive ? 'border-green-500 bg-green-50' : 'border-gray-300'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg">{promo.name}</h3>
                      <p className="text-purple-600 font-bold">{promo.discountPercent}% discount</p>
                      <p className="text-sm text-gray-600">
                        {startDate.toLocaleString()} - {endDate.toLocaleString()}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            promo.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {promo.isActive ? 'Active' : 'Inactive'}
                        </span>
                        {isCurrentlyActive && (
                          <span className="px-2 py-1 rounded text-xs bg-green-200 text-green-900">
                            Currently Running
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleToggleActive(promo.id, promo.isActive)}
                        className={`px-3 py-1 rounded text-sm ${
                          promo.isActive
                            ? 'bg-yellow-600 hover:bg-yellow-700'
                            : 'bg-green-600 hover:bg-green-700'
                        } text-white`}
                      >
                        {promo.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => handleDelete(promo.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
                      >
                        Delete
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
