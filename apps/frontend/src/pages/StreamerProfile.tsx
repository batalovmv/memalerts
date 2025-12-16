import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { activateMeme } from '../store/slices/memesSlice';
import { api } from '../lib/api';
import UserMenu from '../components/UserMenu';
import MemeCard from '../components/MemeCard';
import MemeModal from '../components/MemeModal';
import toast from 'react-hot-toast';
import type { Meme, Wallet } from '../types';

interface ChannelInfo {
  id: string;
  slug: string;
  name: string;
  coinPerPointRatio: number;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
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
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

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
            const walletResponse = await api.get<Wallet>(`/channels/${slug}/wallet`, {
              timeout: 10000, // 10 second timeout
            });
            setWallet(walletResponse.data);
          } catch (error: any) {
            // If wallet doesn't exist or times out, set default wallet
            if (error.response?.status === 404 || error.code === 'ECONNABORTED' || error.response?.status === 504 || error.response?.status === 500) {
              setWallet({
                id: '',
                userId: user.id,
                channelId: channelResponse.data.id,
                balance: 0,
              });
            }
            // Don't show error for wallet - it's not critical for page display
            console.warn('Failed to load wallet:', error);
          }
        }
        
        setLoading(false);
      } catch (error: any) {
        console.error('Error loading channel:', error);
        if (error.response?.status === 404) {
          toast.error('Channel not found');
          navigate('/');
        } else {
          toast.error(error.response?.data?.error || 'Failed to load channel');
        }
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

  // Check if current user is the owner of this channel
  const isOwner = user && user.channelId === channelInfo?.id;

  // Apply custom colors if available
  const customStyles: Record<string, string> = {};
  if (channelInfo?.primaryColor) {
    customStyles['--primary-color'] = channelInfo.primaryColor;
  }
  if (channelInfo?.secondaryColor) {
    customStyles['--secondary-color'] = channelInfo.secondaryColor;
  }
  if (channelInfo?.accentColor) {
    customStyles['--accent-color'] = channelInfo.accentColor;
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900" style={customStyles}>
      <nav className="bg-white dark:bg-gray-800 shadow-sm" style={{
        backgroundColor: channelInfo?.primaryColor ? (document.documentElement.classList.contains('dark') ? undefined : channelInfo.primaryColor) : undefined,
      }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-bold dark:text-white" style={{
              color: channelInfo?.primaryColor && !document.documentElement.classList.contains('dark') ? '#ffffff' : undefined,
            }}>Mem Alerts</h1>
            {user && <UserMenu />}
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Channel Header */}
        <div className="mb-8 border-b border-secondary/30 pb-4">
          <h1 className="text-4xl font-bold mb-2 dark:text-white">{channelInfo.name}</h1>
          <p className="text-gray-600 dark:text-gray-400">@{channelInfo.slug}</p>
          <div className="mt-4 flex gap-4 text-sm">
            <span className="text-accent font-semibold">{channelInfo.stats.memesCount} memes</span>
            <span className="text-accent font-semibold">{channelInfo.stats.usersCount} users</span>
          </div>
        </div>

        {/* User Wallet (if logged in) */}
        {user && wallet && (
          <div className="mb-6">
            <h2 className="text-2xl font-bold mb-2 dark:text-white">Your Balance</h2>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-secondary/20">
              <div className="text-3xl font-bold text-accent">
                {wallet.balance} coins
              </div>
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                Redeem channel points on Twitch to earn coins!
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mb-6 flex flex-wrap gap-4">
          {isOwner ? (
            <button
              onClick={() => navigate('/admin')}
              className="bg-primary hover:bg-secondary text-white font-semibold py-2 px-6 rounded-lg transition-colors"
            >
              Manage Channel
            </button>
          ) : (
            user && (
              <button
                onClick={handleSubmitMeme}
                className="bg-primary hover:bg-secondary text-white font-semibold py-2 px-6 rounded-lg transition-colors"
              >
                Submit a Meme
              </button>
            )
          )}
        </div>

        {/* Memes List */}
        <h2 className="text-2xl font-bold mb-4 dark:text-white">Available Memes</h2>
        {channelInfo.memes.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">No memes available yet.</div>
        ) : (
          <div 
            className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-0"
            style={{ columnGap: 0 }}
          >
            {channelInfo.memes.map((meme: Meme) => (
              <MemeCard
                key={meme.id}
                meme={meme}
                onClick={() => {
                  setSelectedMeme(meme);
                  setIsModalOpen(true);
                }}
                isOwner={false}
              />
            ))}
          </div>
        )}
      </main>

      {/* Meme Modal */}
      {isModalOpen && selectedMeme && (
        <MemeModal
          meme={selectedMeme}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedMeme(null);
          }}
          onUpdate={() => {
            // Refresh wallet if needed
            if (slug && user) {
              api.get<Wallet>(`/channels/${slug}/wallet`).then(response => {
                setWallet(response.data);
              }).catch(() => {});
            }
          }}
          isOwner={false}
          mode="viewer"
          onActivate={handleActivate}
          walletBalance={wallet?.balance}
        />
      )}
    </div>
  );
}

