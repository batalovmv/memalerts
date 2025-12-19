import { ReactNode } from 'react';

interface ChannelThemeProviderProps {
  channelSlug?: string; // Optional, kept for future use
  children: ReactNode;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
}

const defaultColors = {
  primaryColor: '#9333ea',
  secondaryColor: '#7c3aed',
  accentColor: '#a855f7',
};

export default function ChannelThemeProvider({
  children,
  primaryColor,
  secondaryColor,
  accentColor,
}: ChannelThemeProviderProps) {
  // Применяем цвета через inline styles к контейнеру
  const themeStyles = {
    '--primary-color': primaryColor || defaultColors.primaryColor,
    '--secondary-color': secondaryColor || defaultColors.secondaryColor,
    '--accent-color': accentColor || defaultColors.accentColor,
  } as React.CSSProperties;

  return (
    <div style={themeStyles} className="channel-theme">
      {children}
    </div>
  );
}

