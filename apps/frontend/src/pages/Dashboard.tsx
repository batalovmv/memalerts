import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { fetchUser } from '../store/slices/authSlice';
import { fetchMemes, activateMeme } from '../store/slices/memesSlice';
import UserMenu from '../components/UserMenu';
import toast from 'react-hot-toast';
import type { Meme } from '../types';

export default function Dashboard() {
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const { memes, loading: memesLoading } = useAppSelector((state) => state.memes);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user && user.channelId) {
      dispatch(fetchMemes({ channelId: user.channelId }));
    } else if (user && user.role === 'streamer') {
      // If user is streamer but no channelId, redirect to home
      navigate('/');
    } else if (user && user.role !== 'streamer') {
      // If user is not streamer, redirect to home
      navigate('/');
    }
  }, [user, dispatch, navigate]);


  const handleActivate = async (memeId: string): Promise<void> => {
    try {
      await dispatch(activateMeme(memeId)).unwrap();
      toast.success('Meme activated!');
      await dispatch(fetchUser()).unwrap();
      if (user) {
        await dispatch(fetchMemes({ channelId: user.channelId })).unwrap();
      }
    } catch (error) {
      toast.error('Failed to activate meme');
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
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-bold">Mem Alerts</h1>
            <UserMenu />
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {user.channelId && (
          <>
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2">Your Profile Link</h2>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center gap-4">
                  <input
                    type="text"
                    readOnly
                    value={`https://twitchmemes.ru/channel/${user.channel?.slug || ''}`}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 bg-gray-50"
                  />
                  <button
                    onClick={async () => {
                      const url = `https://twitchmemes.ru/channel/${user.channel?.slug || ''}`;
                      try {
                        await navigator.clipboard.writeText(url);
                        toast.success('Link copied to clipboard!');
                      } catch (error) {
                        toast.error('Failed to copy link');
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    Copy Link
                  </button>
                </div>
                <p className="text-sm text-gray-500 mt-2">
                  Share this link so others can submit memes and activate them on your channel!
                </p>
              </div>
            </div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2">Your Wallet</h2>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="text-3xl font-bold text-purple-600">
                  {user.wallets?.find(w => w.channelId === user.channelId)?.balance || 0} coins
                </div>
                <p className="text-gray-600 mt-2">
                  Redeem channel points on Twitch to earn coins!
                </p>
              </div>
            </div>
          </>
        )}

        <h2 className="text-2xl font-bold mb-4">Available Memes</h2>
        {memesLoading ? (
          <div className="text-center py-8">Loading memes...</div>
        ) : memes.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No memes available yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {memes.map((meme: Meme) => (
              <div key={meme.id} className="bg-white rounded-lg shadow overflow-hidden">
                <div className="p-4">
                  <h3 className="font-semibold text-lg mb-2">{meme.title}</h3>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm text-gray-600">
                      {meme.type.toUpperCase()}
                    </span>
                    <span className="text-lg font-bold text-purple-600">
                      {meme.priceCoins} coins
                    </span>
                  </div>
                  <button
                    onClick={() => handleActivate(meme.id)}
                    disabled={
                      !user.channelId || !user.wallets || 
                      (user.wallets.find(w => w.channelId === user.channelId)?.balance || 0) < meme.priceCoins
                    }
                    className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded transition-colors"
                  >
                    {!user.channelId || !user.wallets || 
                     (user.wallets.find(w => w.channelId === user.channelId)?.balance || 0) < meme.priceCoins
                      ? 'Insufficient coins'
                      : 'Activate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
