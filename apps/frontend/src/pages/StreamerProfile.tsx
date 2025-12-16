import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { activateMeme } from '../store/slices/memesSlice';
import { api } from '../lib/api';
import UserMenu from '../components/UserMenu';
import toast from 'react-hot-toast';
import type { Meme, Wallet } from '../types';

interface ChannelInfo {
  id: string;
  slug: string;
  name: string;
  coinPerPointRatio: number;
  createdAt: string;
  memes: Meme[];
  stats: {
    memesCount: number;
    usersCount: number;
  };
}

export default function StreamerProfile() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) {
      navigate('/');
      return;
    }

    const loadChannelData = async () => {
      try {
        // Load channel info and memes
        const channelResponse = await api.get<ChannelInfo>(`/channels/${slug}`);
        setChannelInfo(channelResponse.data);
        
        // If user is logged in, load their wallet for this channel
        if (user) {
          try {
            const walletResponse = await api.get<Wallet>(`/channels/${slug}/wallet`);
            setWallet(walletResponse.data);
          } catch (error: any) {
            // If wallet doesn't exist, it will be created with 0 balance
            if (error.response?.status === 404) {
              setWallet({
                id: '',
                userId: user.id,
                channelId: channelResponse.data.id,
                balance: 0,
              });
            }
          }
        }
      } catch (error: any) {
        console.error('Error loading channel:', error);
        if (error.response?.status === 404) {
          toast.error('Channel not found');
          navigate('/');
        } else {
          toast.error('Failed to load channel');
        }
      } finally {
        setLoading(false);
      }
    };

    loadChannelData();
  }, [slug, user, navigate]);

  const handleActivate = async (memeId: string): Promise<void> => {
    if (!user) {
      toast.error('Please log in to activate memes');
      navigate('/');
      return;
    }

    try {
      await dispatch(activateMeme(memeId)).unwrap();
      toast.success('Meme activated!');
      
      // Refresh wallet balance
      if (slug) {
        try {
          const walletResponse = await api.get<Wallet>(`/channels/${slug}/wallet`);
          setWallet(walletResponse.data);
        } catch (error) {
          console.error('Error refreshing wallet:', error);
        }
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to activate meme');
    }
  };

  const handleSubmitMeme = () => {
    if (slug) {
      navigate(`/submit?channelSlug=${slug}`);
    } else {
      navigate('/submit');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (!channelInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-red-600">Channel not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-bold">Mem Alerts</h1>
            {user && <UserMenu />}
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Channel Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">{channelInfo.name}</h1>
          <p className="text-gray-600">@{channelInfo.slug}</p>
          <div className="mt-4 flex gap-4 text-sm text-gray-500">
            <span>{channelInfo.stats.memesCount} memes</span>
            <span>{channelInfo.stats.usersCount} users</span>
          </div>
        </div>

        {/* User Wallet (if logged in) */}
        {user && wallet && (
          <div className="mb-6">
            <h2 className="text-2xl font-bold mb-2">Your Balance</h2>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-3xl font-bold text-purple-600">
                {wallet.balance} coins
              </div>
              <p className="text-gray-600 mt-2">
                Redeem channel points on Twitch to earn coins!
              </p>
            </div>
          </div>
        )}

        {/* Submit Meme Button */}
        {user && (
          <div className="mb-6">
            <button
              onClick={handleSubmitMeme}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
            >
              Submit a Meme
            </button>
          </div>
        )}

        {/* Memes List */}
        <h2 className="text-2xl font-bold mb-4">Available Memes</h2>
        {memesLoading ? (
          <div className="text-center py-8">Loading memes...</div>
        ) : channelInfo.memes.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No memes available yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {channelInfo.memes.map((meme: Meme) => (
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
                  {user ? (
                    <button
                      onClick={() => handleActivate(meme.id)}
                      disabled={!wallet || wallet.balance < meme.priceCoins}
                      className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded transition-colors"
                    >
                      {!wallet || wallet.balance < meme.priceCoins
                        ? 'Insufficient coins'
                        : 'Activate'}
                    </button>
                  ) : (
                    <button
                      onClick={() => navigate('/')}
                      className="w-full bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded transition-colors"
                    >
                      Log in to activate
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

