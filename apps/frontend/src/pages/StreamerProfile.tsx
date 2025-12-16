import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { activateMeme } from '../store/slices/memesSlice';
import { api } from '../lib/api';
import Header from '../components/Header';
import MemeCard from '../components/MemeCard';
import MemeModal from '../components/MemeModal';
import SubmitModal from '../components/SubmitModal';
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
  owner?: {
    id: string;
    displayName: string;
    profileImageUrl?: string | null;
  } | null;
  stats: {
    memesCount: number;
    usersCount: number;
  };
}

export default function StreamerProfile() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);

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
          toast.error(t('toast.channelNotFound'));
          navigate('/');
        } else {
          toast.error(error.response?.data?.error || t('toast.failedToLoadChannel'));
        }
        setLoading(false);
      }
    };

    loadChannelData();
  }, [slug, user, navigate]);

  const handleActivate = async (memeId: string): Promise<void> => {
    if (!user) {
      toast.error(t('toast.pleaseLogInToActivate'));
      navigate('/');
      return;
    }

    try {
      await dispatch(activateMeme(memeId)).unwrap();
      toast.success(t('toast.memeActivated'));
      
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
      toast.error(error.message || t('toast.failedToActivate'));
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
  const isOwner = !!(user && user.channelId === channelInfo?.id);

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
      <Header 
        channelSlug={slug}
        channelId={channelInfo?.id}
        primaryColor={channelInfo?.primaryColor}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Channel Header */}
        <div className="mb-8 border-b border-secondary/30 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Avatar */}
              {channelInfo.owner?.profileImageUrl ? (
                <img 
                  src={channelInfo.owner.profileImageUrl} 
                  alt={channelInfo.owner.displayName}
                  className="w-20 h-20 rounded-lg object-cover border-2 border-secondary/30"
                />
              ) : (
                <div className="w-20 h-20 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-2xl border-2 border-secondary/30">
                  {channelInfo.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="text-4xl font-bold mb-2 dark:text-white">{channelInfo.name}</h1>
                <div className="mt-4 flex gap-4 text-sm">
                  <span className="text-accent font-semibold">{channelInfo.stats.memesCount} {t('profile.memes')}</span>
                  <span className="text-accent font-semibold">{channelInfo.stats.usersCount} {t('profile.users')}</span>
                </div>
              </div>
            </div>
            {/* Submit Meme Button - only show when logged in and not owner */}
            {user && !isOwner && (
              <button
                onClick={() => setIsSubmitModalOpen(true)}
                className="flex items-center gap-2 bg-primary hover:bg-secondary text-white font-semibold py-2 px-4 rounded-lg transition-colors border border-secondary/30"
                title={t('profile.submitMeme')}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>{t('profile.submitMeme')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Memes List */}
        <h2 className="text-2xl font-bold mb-4 dark:text-white">{t('profile.availableMemes')}</h2>
        {channelInfo.memes.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">{t('profile.noMemes')}</div>
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
                isOwner={isOwner}
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
          isOwner={isOwner}
          mode="viewer"
          onActivate={handleActivate}
          walletBalance={wallet?.balance}
        />
      )}

      {/* Submit Modal */}
      <SubmitModal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        channelSlug={slug}
        channelId={channelInfo?.id}
      />
    </div>
  );
}

