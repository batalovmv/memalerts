export type OverlayMode = 'queue' | 'simultaneous';

export interface Activation {
  id: string;
  memeId: string;
  type: string;
  fileUrl: string;
  playFileUrl?: string | null;
  durationMs: number;
  title: string;
  senderDisplayName?: string | null;
}

export interface QueuedActivation extends Activation {
  startTime: number;
  // Used when position=random
  xPct?: number;
  yPct?: number;
  // After first render, we may clamp the activation inside the viewport.
  // These are the desired center coordinates in px (used when position=random).
  xPx?: number;
  yPx?: number;
  layoutTick?: number;
  // Media aspect ratio (w/h). Used to keep original aspect ratio and normalize visual size.
  aspectRatio?: number;
  boxW?: number;
  boxH?: number;
  // Optional, derived from real media metadata (video/audio), preferred over durationMs when available.
  effectiveDurationMs?: number;
  // When we start fading out, keep the item briefly so OBS doesn't "stick" the last frame.
  isExiting?: boolean;
  // Auto-fit scale to keep the item inside viewport (used mainly for preview / extreme aspect ratios).
  fitScale?: number;
  // Per-item scale (supports fixed vs range).
  userScale?: number;
}

export interface OverlayConfig {
  overlayMode: OverlayMode;
  overlayShowSender: boolean;
  overlayMaxConcurrent: number;
  overlayStyleJson?: string | null;
}

export type OverlayPosition =
  | 'random'
  | 'center'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export type OverlayAnim = 'fade' | 'zoom' | 'slide-up' | 'pop' | 'lift' | 'none';

