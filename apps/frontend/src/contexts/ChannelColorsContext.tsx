import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAppSelector } from '../store/hooks';
import { api } from '../lib/api';

interface ChannelColors {
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
}

interface ChannelColorsContextType {
  colors: ChannelColors;
  isLoading: boolean;
  refreshColors: () => Promise<void>;
}

const defaultColors: ChannelColors = {
  primaryColor: '#9333ea', // purple-600
  secondaryColor: '#7c3aed', // purple-700
  accentColor: '#a855f7', // purple-500
};

const ChannelColorsContext = createContext<ChannelColorsContextType | undefined>(undefined);

export function ChannelColorsProvider({ children }: { children: ReactNode }) {
  const { user } = useAppSelector((state) => state.auth);
  const [colors, setColors] = useState<ChannelColors>(defaultColors);
  const [isLoading, setIsLoading] = useState(true);

  const fetchChannelColors = async () => {
    if (!user?.channelId) {
      setColors(defaultColors);
      setIsLoading(false);
      return;
    }

    try {
      // Try to get channel colors from user's channel
      const response = await api.get(`/channels/${user.channel?.slug || ''}`);
      const channelData = response.data;
      
      setColors({
        primaryColor: channelData.primaryColor || defaultColors.primaryColor,
        secondaryColor: channelData.secondaryColor || defaultColors.secondaryColor,
        accentColor: channelData.accentColor || defaultColors.accentColor,
      });
    } catch (error) {
      // If error, use default colors
      console.warn('Failed to fetch channel colors, using defaults:', error);
      setColors(defaultColors);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchChannelColors();
  }, [user?.channelId, user?.channel?.slug]);

  // Apply CSS variables for colors
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--primary-color', colors.primaryColor || defaultColors.primaryColor);
    root.style.setProperty('--secondary-color', colors.secondaryColor || defaultColors.secondaryColor);
    root.style.setProperty('--accent-color', colors.accentColor || defaultColors.accentColor);
  }, [colors]);

  return (
    <ChannelColorsContext.Provider value={{ colors, isLoading, refreshColors: fetchChannelColors }}>
      {children}
    </ChannelColorsContext.Provider>
  );
}

export function useChannelColors() {
  const context = useContext(ChannelColorsContext);
  if (context === undefined) {
    throw new Error('useChannelColors must be used within a ChannelColorsProvider');
  }
  return context;
}

