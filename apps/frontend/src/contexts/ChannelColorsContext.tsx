import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useAppSelector } from '../store/hooks';
import { api } from '../lib/api';

interface ChannelColors {
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
}

interface ChannelData {
  id: string;
  slug: string;
  name: string;
  coinPerPointRatio: number;
  coinIconUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  rewardIdForCoins?: string | null;
  rewardEnabled?: boolean;
  rewardTitle?: string | null;
  rewardCost?: number | null;
  rewardCoins?: number | null;
  createdAt?: string;
  owner?: {
    id: string;
    displayName: string;
    profileImageUrl?: string | null;
  } | null;
  stats?: {
    memesCount: number;
    usersCount: number;
  };
}

interface ChannelColorsContextType {
  colors: ChannelColors;
  channelData: ChannelData | null;
  isLoading: boolean;
  refreshColors: () => Promise<void>;
  getChannelData: (slug: string) => Promise<ChannelData | null>;
  getCachedChannelData: (slug: string) => ChannelData | null;
}

const defaultColors: ChannelColors = {
  primaryColor: '#9333ea', // purple-600
  secondaryColor: '#7c3aed', // purple-700
  accentColor: '#a855f7', // purple-500
};

const ChannelColorsContext = createContext<ChannelColorsContextType | undefined>(undefined);

// Cache for channel data by slug
const channelDataCache = new Map<string, { data: ChannelData; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function ChannelColorsProvider({ children }: { children: ReactNode }) {
  const { user } = useAppSelector((state) => state.auth);
  const [colors, setColors] = useState<ChannelColors>(defaultColors);
  const [channelData, setChannelData] = useState<ChannelData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Get cached channel data or fetch it
  const getChannelData = useCallback(async (slug: string, includeMemes: boolean = false): Promise<ChannelData | null> => {
    // Check cache first
    const cached = channelDataCache.get(slug);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    try {
      // Use includeMemes=false for performance when memes are not needed
      const params = includeMemes ? '' : '?includeMemes=false';
      const data: ChannelData = await api.get(`/channels/${slug}${params}`);
      
      // Update cache
      channelDataCache.set(slug, { data, timestamp: Date.now() });
      
      return data;
    } catch (error) {
      console.warn(`Failed to fetch channel data for ${slug}:`, error);
      return null;
    }
  }, []);

  // Get cached channel data without fetching
  const getCachedChannelData = useCallback((slug: string): ChannelData | null => {
    const cached = channelDataCache.get(slug);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
    return null;
  }, []);

  const fetchChannelColors = async () => {
    if (!user?.channelId) {
      setColors(defaultColors);
      setChannelData(null);
      setIsLoading(false);
      return;
    }

    try {
      const slug = user.channel?.slug || '';
      const data = await getChannelData(slug);
      
      if (data) {
        setChannelData(data);
        setColors({
          primaryColor: data.primaryColor || defaultColors.primaryColor,
          secondaryColor: data.secondaryColor || defaultColors.secondaryColor,
          accentColor: data.accentColor || defaultColors.accentColor,
        });
      } else {
        setColors(defaultColors);
        setChannelData(null);
      }
    } catch (error) {
      // If error, use default colors
      console.warn('Failed to fetch channel colors, using defaults:', error);
      setColors(defaultColors);
      setChannelData(null);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchChannelColorsMemo = useCallback(() => {
    fetchChannelColors();
  }, [user?.channelId, user?.channel?.slug, getChannelData]);

  useEffect(() => {
    fetchChannelColorsMemo();
  }, [fetchChannelColorsMemo]);

  // Apply CSS variables for colors
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--primary-color', colors.primaryColor || defaultColors.primaryColor);
    root.style.setProperty('--secondary-color', colors.secondaryColor || defaultColors.secondaryColor);
    root.style.setProperty('--accent-color', colors.accentColor || defaultColors.accentColor);
  }, [colors]);

  return (
    <ChannelColorsContext.Provider value={{ 
      colors, 
      channelData,
      isLoading, 
      refreshColors: fetchChannelColors,
      getChannelData,
      getCachedChannelData
    }}>
      {children}
    </ChannelColorsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useChannelColors() {
  const context = useContext(ChannelColorsContext);
  if (context === undefined) {
    throw new Error('useChannelColors must be used within a ChannelColorsProvider');
  }
  return context;
}

