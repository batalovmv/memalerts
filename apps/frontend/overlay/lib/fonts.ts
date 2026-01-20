export type GoogleFontFamily =
  | 'Inter'
  | 'Roboto'
  | 'Montserrat'
  | 'Poppins'
  | 'Oswald'
  | 'Raleway'
  | 'Nunito'
  | 'Playfair Display'
  | 'JetBrains Mono';

export const GOOGLE_FONTS_CURATED: Array<{ label: string; family: GoogleFontFamily; weights: number[] }> = [
  { label: 'Inter', family: 'Inter', weights: [400, 600, 700, 800] },
  { label: 'Roboto', family: 'Roboto', weights: [400, 500, 700, 900] },
  { label: 'Montserrat', family: 'Montserrat', weights: [400, 600, 700, 800] },
  { label: 'Poppins', family: 'Poppins', weights: [400, 600, 700, 800] },
  { label: 'Oswald', family: 'Oswald', weights: [400, 500, 600, 700] },
  { label: 'Raleway', family: 'Raleway', weights: [400, 600, 700, 800] },
  { label: 'Nunito', family: 'Nunito', weights: [400, 600, 700, 800] },
  { label: 'Playfair Display', family: 'Playfair Display', weights: [400, 600, 700, 800] },
  { label: 'JetBrains Mono', family: 'JetBrains Mono', weights: [400, 600, 700] },
];

const injectedKeys = new Set<string>();

function toGoogleFontsCss2FamilyParam(family: string, weights: number[]): string {
  const w = Array.from(new Set(weights.map((n) => Math.round(n)).filter((n) => Number.isFinite(n))))
    .filter((n) => n >= 100 && n <= 1000)
    .sort((a, b) => a - b)
    .slice(0, 3); // safety: avoid loading too many weights
  const fam = encodeURIComponent(String(family || '').trim());
  if (!fam) return '';
  if (w.length === 0) return `family=${fam}`;
  return `family=${fam}:wght@${w.join(';')}`;
}

function ensureLink(rel: string, href: string, crossOrigin?: string) {
  const id = `memalerts-font-${rel}-${href}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = rel;
  link.href = href;
  if (crossOrigin) link.crossOrigin = crossOrigin;
  document.head.appendChild(link);
}

/**
 * Loads Google Fonts CSS2 stylesheet for the given family + weights.
 * - No user file uploads
 * - Curated list only (callers should validate)
 * - Weights capped (<=3) to keep overlay light for OBS
 */
export function ensureGoogleFontLoaded(args: { family: string; weights: number[] }) {
  if (typeof document === 'undefined') return;
  const family = String(args.family || '').trim();
  if (!family) return;

  const key = `${family}|${args.weights.join(',')}`;
  if (injectedKeys.has(key)) return;
  injectedKeys.add(key);

  ensureLink('preconnect', 'https://fonts.googleapis.com');
  ensureLink('preconnect', 'https://fonts.gstatic.com', 'anonymous');

  const famParam = toGoogleFontsCss2FamilyParam(family, args.weights || []);
  if (!famParam) return;
  const href = `https://fonts.googleapis.com/css2?${famParam}&display=swap`;
  ensureLink('stylesheet', href);
}


