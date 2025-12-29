import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo, useRef } from 'react';

import { api } from '../lib/api';
import { useAppSelector } from '../store/hooks';

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
  overlayMode?: 'queue' | 'simultaneous';
  overlayShowSender?: boolean;
  overlayMaxConcurrent?: number;
  coinIconUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  rewardIdForCoins?: string | null;
  rewardEnabled?: boolean;
  rewardTitle?: string | null;
  rewardCost?: number | null;
  rewardCoins?: number | null;
  // Reward coins for approved submissions (split by source kind).
  // Back-compat: older backend returns only `submissionRewardCoins`.
  submissionRewardCoinsUpload?: number;
  submissionRewardCoinsPool?: number;
  submissionRewardCoins?: number;
  submissionsEnabled?: boolean;
  submissionsOnlyWhenLive?: boolean;
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
  getChannelData: (slug: string, includeMemes?: boolean, forceRefresh?: boolean) => Promise<ChannelData | null>;
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
  const colorsLoadedRef = useRef<string | null>(null); // Track which channel's colors were loaded

  // Get cached channel data or fetch it
  const getChannelData = useCallback(async (slug: string, includeMemes: boolean = false, forceRefresh: boolean = false): Promise<ChannelData | null> => {
    const cacheKey = (slug || '').trim().toLowerCase();
    // Check cache first
    if (!forceRefresh) {
      const cached = channelDataCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }
    }

    try {
      // Use includeMemes=false for performance when memes are not needed
      const params = includeMemes ? '' : '?includeMemes=false';
      const data: ChannelData = await api.get(`/channels/${slug}${params}`, {
        timeout: 15000, // 15 seconds timeout
      });
      
      // Update cache
      channelDataCache.set(cacheKey, { data, timestamp: Date.now() });
      
      return data;
    } catch (error) {
      return null;
    }
  }, []);

  // Get cached channel data without fetching
  const getCachedChannelData = useCallback((slug: string): ChannelData | null => {
    const cacheKey = (slug || '').trim().toLowerCase();
    const cached = channelDataCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
    return null;
  }, []);

  const fetchChannelColors = useCallback(async () => {
    if (!user?.channelId) {
      setColors(defaultColors);
      setChannelData(null);
      setIsLoading(false);
      colorsLoadedRef.current = null;
      return;
    }

    const slug = user.channel?.slug || '';
    
    // Skip if already loaded for this channel
    if (colorsLoadedRef.current === slug) {
      return;
    }

    try {
      setIsLoading(true);
      const data = await getChannelData(slug, false, true);
      
      if (data) {
        setChannelData(data);
        setColors({
          primaryColor: data.primaryColor || defaultColors.primaryColor,
          secondaryColor: data.secondaryColor || defaultColors.secondaryColor,
          accentColor: data.accentColor || defaultColors.accentColor,
        });
        colorsLoadedRef.current = slug; // Mark as loaded
      } else {
        setColors(defaultColors);
        setChannelData(null);
        colorsLoadedRef.current = slug; // Mark as loaded (even if no data)
      }
    } catch (error) {
      // If error, use default colors
      setColors(defaultColors);
      setChannelData(null);
      colorsLoadedRef.current = null; // Reset on error to allow retry
    } finally {
      setIsLoading(false);
    }
  }, [user?.channelId, user?.channel?.slug, getChannelData]);

  useEffect(() => {
    fetchChannelColors();
  }, [fetchChannelColors]);

  // Note: Colors are no longer applied globally here.
  // They are applied only on public channel pages via ChannelThemeProvider.

  const value = useMemo(
    () => ({
      colors,
      channelData,
      isLoading,
      refreshColors: fetchChannelColors,
      getChannelData,
      getCachedChannelData,
    }),
    [colors, channelData, isLoading, fetchChannelColors, getChannelData, getCachedChannelData],
  );

  return <ChannelColorsContext.Provider value={value}>{children}</ChannelColorsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useChannelColors() {
  const context = useContext(ChannelColorsContext);
  if (context === undefined) {
    throw new Error('useChannelColors must be used within a ChannelColorsProvider');
  }
  return context;
}

