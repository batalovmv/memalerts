export type BorderPreset = 'custom' | 'glass' | 'glow' | 'frosted';
export type BorderMode = 'solid' | 'gradient';
export type GlassPreset = 'ios' | 'clear' | 'prism';
export type SenderFontFamily =
  | 'system'
  | 'inter'
  | 'roboto'
  | 'montserrat'
  | 'poppins'
  | 'oswald'
  | 'raleway'
  | 'nunito'
  | 'playfair'
  | 'jetbrains-mono'
  | 'mono'
  | 'serif';
export type UrlPosition =
  | 'random'
  | 'center'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';
export type UrlAnim = 'fade' | 'zoom' | 'slide-up' | 'pop' | 'lift' | 'none';
export type AnimEasingPreset = 'ios' | 'smooth' | 'snappy' | 'linear' | 'custom';
export type ScaleMode = 'fixed' | 'range';
export type SenderStroke = 'none' | 'glass' | 'solid';
export type CreditsTextAlign = 'left' | 'center' | 'right';
export type CreditsBackgroundMode = 'transparent' | 'card' | 'full';
export type CreditsScrollDirection = 'up' | 'down';
export type CreditsAnchorX = 'left' | 'center' | 'right';
export type CreditsAnchorY = 'top' | 'center' | 'bottom';
export type CreditsTitleTransform = 'none' | 'uppercase' | 'lowercase';

export type PreviewMeme = {
  fileUrl: string;
  type: string;
  title?: string;
};

export const SENDER_FONT_FAMILIES: ReadonlyArray<SenderFontFamily> = [
  'system',
  'inter',
  'roboto',
  'montserrat',
  'poppins',
  'oswald',
  'raleway',
  'nunito',
  'playfair',
  'jetbrains-mono',
  'mono',
  'serif',
];

export function isSenderFontFamily(v: string): v is SenderFontFamily {
  return (SENDER_FONT_FAMILIES as ReadonlyArray<string>).includes(v);
}

export const URL_POSITIONS: ReadonlyArray<UrlPosition> = [
  'random',
  'center',
  'top',
  'bottom',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

export function isUrlPosition(v: string): v is UrlPosition {
  return (URL_POSITIONS as ReadonlyArray<string>).includes(v);
}

export const URL_ANIMS: ReadonlyArray<UrlAnim> = ['fade', 'zoom', 'slide-up', 'pop', 'lift', 'none'];

export function isUrlAnim(v: string): v is UrlAnim {
  return (URL_ANIMS as ReadonlyArray<string>).includes(v);
}

export function toRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  if (Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

export function getNumber(obj: Record<string, unknown> | null, key: string): number | undefined {
  const v = obj?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
