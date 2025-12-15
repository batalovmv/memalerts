import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { fetchSubmissions, approveSubmission, rejectSubmission } from '../store/slices/submissionsSlice';
import { fetchMemes } from '../store/slices/memesSlice';
import toast from 'react-hot-toast';
import type { Meme } from '../types';

type TabType = 'submissions' | 'memes' | 'settings';

export default function Admin() {
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const { submissions, loading: submissionsLoading } = useAppSelector((state) => state.submissions);
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
    const moderatorNotes = prompt('Enter rejection reason:');
    if (!moderatorNotes) return;

    try {
      await dispatch(rejectSubmission({ submissionId, moderatorNotes })).unwrap();
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
            {submissionsLoading ? (
              <div className="text-center py-8">Loading submissions...</div>
            ) : submissions.length === 0 ? (
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
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-gray-600">Channel settings coming soon...</p>
          </div>
        )}
      </main>
    </div>
  );
}
