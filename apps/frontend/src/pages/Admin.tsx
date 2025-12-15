import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

interface Submission {
  id: string;
  title: string;
  type: string;
  fileUrlTemp: string;
  notes: string | null;
  status: string;
  submitter: {
    id: string;
    displayName: string;
  };
  createdAt: string;
}

interface Meme {
  id: string;
  title: string;
  type: string;
  fileUrl: string;
  priceCoins: number;
  durationMs: number;
  status: string;
}

export default function Admin() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [memes, setMemes] = useState<Meme[]>([]);
  const [activeTab, setActiveTab] = useState<'submissions' | 'memes' | 'settings'>('submissions');

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'streamer' && user.role !== 'admin'))) {
      navigate('/dashboard');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user && (user.role === 'streamer' || user.role === 'admin')) {
      loadSubmissions();
      loadMemes();
    }
  }, [user]);

  const loadSubmissions = async () => {
    try {
      const response = await api.get('/admin/submissions', {
        params: { status: 'pending' },
      });
      setSubmissions(response.data);
    } catch (error) {
      toast.error('Failed to load submissions');
    }
  };

  const loadMemes = async () => {
    try {
      const response = await api.get('/admin/memes');
      setMemes(response.data);
    } catch (error) {
      toast.error('Failed to load memes');
    }
  };

  const handleApprove = async (submissionId: string) => {
    const priceCoins = prompt('Enter price in coins:');
    const durationMs = prompt('Enter duration in milliseconds:');

    if (!priceCoins || !durationMs) return;

    try {
      await api.post(`/admin/submissions/${submissionId}/approve`, {
        priceCoins: parseInt(priceCoins),
        durationMs: parseInt(durationMs),
      });
      toast.success('Submission approved!');
      loadSubmissions();
      loadMemes();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to approve submission');
    }
  };

  const handleReject = async (submissionId: string) => {
    const moderatorNotes = prompt('Enter rejection reason:');
    if (!moderatorNotes) return;

    try {
      await api.post(`/admin/submissions/${submissionId}/reject`, {
        moderatorNotes,
      });
      toast.success('Submission rejected');
      loadSubmissions();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to reject submission');
    }
  };

  if (loading || !user) {
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
            <button
              onClick={() => navigate('/dashboard')}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Back to Dashboard
            </button>
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
          </div>
        </div>

        {activeTab === 'submissions' && (
          <div className="space-y-4">
            {submissions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No pending submissions</div>
            ) : (
              submissions.map((submission) => (
                <div key={submission.id} className="bg-white rounded-lg shadow p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-semibold text-lg">{submission.title}</h3>
                      <p className="text-sm text-gray-600">
                        By {submission.submitter.displayName} • {submission.type}
                      </p>
                      {submission.notes && (
                        <p className="text-sm text-gray-500 mt-2">{submission.notes}</p>
                      )}
                    </div>
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
            {memes.map((meme) => (
              <div key={meme.id} className="bg-white rounded-lg shadow p-4">
                <h3 className="font-semibold mb-2">{meme.title}</h3>
                <p className="text-sm text-gray-600 mb-2">
                  {meme.priceCoins} coins • {meme.durationMs}ms
                </p>
                <p className="text-xs text-gray-500">Status: {meme.status}</p>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-gray-600">Channel settings coming soon...</p>
          </div>
        )}
      </main>
    </div>
  );
}


