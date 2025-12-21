import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';

type OverlayMode = 'queue' | 'simultaneous';

interface Activation {
  id: string;
  memeId: string;
  type: string;
  fileUrl: string;
  durationMs: number;
  title: string;
  senderDisplayName?: string | null;
}

interface QueuedActivation extends Activation {
  startTime: number;
  // Used when position=random
  xPct?: number;
  yPct?: number;
  // After first render, we may clamp the activation inside the viewport.
  // These are the desired center coordinates in px (used when position=random).
  xPx?: number;
  yPx?: number;
  layoutTick?: number;
  // Optional, derived from real media metadata (video/audio), preferred over durationMs when available.
  effectiveDurationMs?: number;
  // When we start fading out, keep the item briefly so OBS doesn't "stick" the last frame.
  isExiting?: boolean;
}

interface OverlayConfig {
  overlayMode: OverlayMode;
  overlayShowSender: boolean;
  overlayMaxConcurrent: number;
}

type OverlayPosition =
  | 'random'
  | 'center'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function clampFloat(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

type OverlayAnim = 'fade' | 'zoom' | 'slide-up' | 'none';

export default function OverlayView() {
  const { channelSlug, token } = useParams<{ channelSlug?: string; token?: string }>();
  const [searchParams] = useSearchParams();
  const socketRef = useRef<Socket | null>(null);

  const [config, setConfig] = useState<OverlayConfig>({
    overlayMode: 'queue',
    overlayShowSender: false,
    overlayMaxConcurrent: 3,
  });

  // Unlimited mode should not require a user-configured limit, but we still need a hard cap
  // to prevent OBS/browser from melting down if spammed.
  const SIMULTANEOUS_HARD_CAP = 500;

  const [queue, setQueue] = useState<QueuedActivation[]>([]);
  const [active, setActive] = useState<QueuedActivation[]>([]);
  const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const ackSentRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const fadeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const scale = parseFloat(searchParams.get('scale') || '1');
  const position = (searchParams.get('position') || 'random').toLowerCase() as OverlayPosition;
  const volume = parseFloat(searchParams.get('volume') || '1');
  const demo = searchParams.get('demo') === '1';
  const previewUrlParam = String(searchParams.get('previewUrl') || '').trim();
  const previewTypeParam = String(searchParams.get('previewType') || '').trim().toLowerCase();

  // Appearance / animation params (iPhone-ish defaults).
  const radius = clampInt(parseInt(String(searchParams.get('radius') || ''), 10), 0, 48);
  const shadow = clampInt(parseInt(String(searchParams.get('shadow') || ''), 10), 0, 120);
  const blur = clampInt(parseInt(String(searchParams.get('blur') || ''), 10), 0, 30);
  const border = clampInt(parseInt(String(searchParams.get('border') || ''), 10), 0, 4);
  const bgOpacity = clampFloat(parseFloat(String(searchParams.get('bgOpacity') || '')), 0, 0.65);
  const anim = (String(searchParams.get('anim') || 'fade').toLowerCase() as OverlayAnim) || 'fade';
  const enterMs = clampInt(parseInt(String(searchParams.get('enterMs') || ''), 10), 0, 1200);
  const exitMs = clampInt(parseInt(String(searchParams.get('exitMs') || ''), 10), 0, 1200);

  const safeScale = useMemo(() => {
    const s = Number.isFinite(scale) ? scale : 1;
    // Keep within a sane range; prevents accidental huge overlays.
    return Math.min(2.5, Math.max(0.25, s));
  }, [scale]);

  const isProbablyOBS = useMemo(() => {
    const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
    // Heuristic: OBS Browser Source typically includes "OBS" in the UA.
    return /obs/i.test(ua);
  }, []);

  const mutedByDefault = useMemo(() => {
    // In OBS: allow sound (controlled by volume).
    // In normal browsers: autoplay-with-sound is often blocked and can cause "stuck frame" UX,
    // so we default to muted for reliability.
    return !isProbablyOBS;
  }, [isProbablyOBS]);

  const getMediaUrl = (fileUrl: string): string => {
    const v = (fileUrl || '').trim();
    if (!v) return '';
    if (v.startsWith('http://') || v.startsWith('https://')) return v;

    // Beta deployment serves API/socket on beta domain, but uploads may live on production domain.
    // Keep this consistent with the web app preview logic.
    const isBeta = typeof window !== 'undefined' && window.location.hostname.includes('beta.');
    if (isBeta && v.startsWith('/uploads/')) {
      return `https://twitchmemes.ru${v}`;
    }

    // In prod deployments, overlay is same-origin with the site (relative paths).
    if (import.meta.env.PROD) return v.startsWith('/') ? v : `/${v}`;

    // Dev fallback: use VITE_API_URL or localhost backend.
    const devBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    return v.startsWith('/') ? `${devBase}${v}` : `${devBase}/${v}`;
  };

  useEffect(() => {
    const overlayToken = String(token || '').trim();
    const slug = String(channelSlug || '').trim();
    if (!overlayToken && !slug) return;

    const envUrl = import.meta.env.VITE_API_URL;
    // In production/beta deployments, always use same-origin to avoid cross-environment calls.
    // In local dev, allow VITE_API_URL override or fallback to localhost.
    const apiUrl = import.meta.env.PROD ? window.location.origin : (envUrl || 'http://localhost:3001');
    const newSocket = io(apiUrl, {
      transports: ['websocket'],
    });

    newSocket.on('connect', () => {
      if (overlayToken) {
        newSocket.emit('join:overlay', { token: overlayToken });
      } else if (slug) {
        // Back-compat only; new OBS links should use tokenized route.
        newSocket.emit('join:channel', slug);
      }
    });

    newSocket.on('overlay:config', (incoming: Partial<OverlayConfig> | null | undefined) => {
      const overlayMode = incoming?.overlayMode === 'simultaneous' ? 'simultaneous' : 'queue';
      const overlayShowSender = Boolean(incoming?.overlayShowSender);
      const overlayMaxConcurrent = clampInt(Number(incoming?.overlayMaxConcurrent ?? 3), 1, SIMULTANEOUS_HARD_CAP);
      setConfig({ overlayMode, overlayShowSender, overlayMaxConcurrent });
    });

    newSocket.on('activation:new', (activation: Activation) => {
      setQueue((prev) => [
        ...prev,
        {
          ...activation,
          startTime: Date.now(),
        },
      ]);
    });

    socketRef.current = newSocket;

    return () => {
      socketRef.current = null;
      newSocket.disconnect();
    };
  }, [channelSlug, token]);

  const maxActive = useMemo(() => {
    if (config.overlayMode === 'queue') return 1;
    // In simultaneous mode, respect server-configured maxConcurrent (with a hard cap for safety).
    const n = clampInt(Number(config.overlayMaxConcurrent ?? 3), 1, SIMULTANEOUS_HARD_CAP);
    return n;
  }, [config.overlayMaxConcurrent, config.overlayMode]);

  const pickRandomPosition = useCallback((): { xPct: number; yPct: number } => {
    // Safe margin in % to reduce clipping risk. Increase margin when scale grows.
    // This isn't perfect (we don't know exact media aspect), but reduces "going off-screen" in OBS.
    const baseMargin = 12;
    const margin = Math.min(24, Math.max(10, Math.round(baseMargin * safeScale)));
    const xPct = margin + Math.random() * (100 - margin * 2);
    const yPct = margin + Math.random() * (100 - margin * 2);
    return { xPct, yPct };
  }, [safeScale]);

  const emitAckDoneOnce = useCallback((activationId: string) => {
    const id = String(activationId || '').trim();
    if (!id) return;
    if (ackSentRef.current.has(id)) return;
    ackSentRef.current.add(id);
    socketRef.current?.emit('activation:ackDone', { activationId: id });
  }, []);

  const doneActivation = useCallback((activationId: string) => {
    const id = String(activationId || '').trim();
    if (!id) return;

    emitAckDoneOnce(id);

    // Clear any pending fallback timer.
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }

    // Mark as exiting first (fade-out), then remove after a short delay.
    setActive((prev) => prev.map((a) => (a.id === id ? { ...a, isExiting: true } : a)));
    const existingFade = fadeTimersRef.current.get(id);
    if (existingFade) clearTimeout(existingFade);
    const fadeTimer = setTimeout(() => {
      fadeTimersRef.current.delete(id);
      setActive((prev) => prev.filter((a) => a.id !== id));
    }, 220);
    fadeTimersRef.current.set(id, fadeTimer);
  }, [emitAckDoneOnce]);

  const updateFallbackTimer = useCallback((activationId: string, durationMs: number) => {
    const id = String(activationId || '').trim();
    if (!id) return;
    const duration = clampInt(Number(durationMs ?? 0), 800, 120000);
    const fallbackMs = clampInt(duration + 900, 1200, 130000);

    const old = timersRef.current.get(id);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => doneActivation(id), fallbackMs);
    timersRef.current.set(id, timer);
  }, [doneActivation]);

  // Start as many as allowed when queue/config/active changes.
  useEffect(() => {
    if (queue.length === 0) return;
    if (active.length >= maxActive) return;

    const available = maxActive - active.length;
    const toStartRaw = queue.slice(0, available);
    if (toStartRaw.length === 0) return;

    const toStart = toStartRaw.map((a) => {
      if (position === 'random') {
        const { xPct, yPct } = pickRandomPosition();
        return { ...a, xPct, yPct };
      }
      return a;
    });

    setQueue((prev) => prev.slice(toStartRaw.length));
    setActive((prev) => [...prev, ...toStart]);
  }, [active.length, maxActive, pickRandomPosition, position, queue]);

  // Clamp random-position activations so they never get clipped by the OBS canvas.
  // We do this after render using the actual DOM rect (covers unknown aspect ratios and scale).
  useEffect(() => {
    if (position !== 'random') return;
    if (active.length === 0) return;
    if (typeof window === 'undefined') return;

    const requestedPad = parseInt(String(searchParams.get('pad') || ''), 10);
    const padding = clampInt(Number.isFinite(requestedPad) ? requestedPad : 80, 0, 400); // px safe area around the edges
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (vw <= padding * 2 || vh <= padding * 2) return;

    setActive((prev) => {
      let changed = false;
      const next = prev.map((a) => {
        if (!a?.id) return a;
        if (a.isExiting) return a;
        const el = itemRefs.current.get(a.id);
        if (!el) return a;

        const rect = el.getBoundingClientRect();
        if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return a;

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const minX = padding + rect.width / 2;
        const maxX = vw - padding - rect.width / 2;
        const minY = padding + rect.height / 2;
        const maxY = vh - padding - rect.height / 2;

        const clampedX = Math.min(maxX, Math.max(minX, centerX));
        const clampedY = Math.min(maxY, Math.max(minY, centerY));

        // Only update if we are actually out of bounds by more than 1px.
        if (Math.abs(clampedX - centerX) > 1 || Math.abs(clampedY - centerY) > 1) {
          changed = true;
          return { ...a, xPx: clampedX, yPx: clampedY };
        }

        return a;
      });

      return changed ? next : prev;
    });
  }, [active, position, searchParams]);

  // Ensure per-activation fallback timers exist while active (prevents "stuck" videos in OBS).
  useEffect(() => {
    const activeIds = new Set(active.map((a) => a.id));

    // Clear timers for activations that are no longer active.
    for (const [id, timer] of timersRef.current.entries()) {
      if (!activeIds.has(id)) {
        clearTimeout(timer);
        timersRef.current.delete(id);
      }
    }
    for (const [id, timer] of fadeTimersRef.current.entries()) {
      if (!activeIds.has(id)) {
        clearTimeout(timer);
        fadeTimersRef.current.delete(id);
      }
    }

    // Add timers for newly-active items.
    for (const a of active) {
      if (!a?.id) continue;
      if (timersRef.current.has(a.id)) continue;
      const duration = clampInt(Number(a.effectiveDurationMs ?? a.durationMs ?? 0), 1000, 120000);
      // Extra grace to allow media decode / buffering.
      const fallbackMs = clampInt(duration + 1000, 1500, 130000);
      const timer = setTimeout(() => doneActivation(a.id), fallbackMs);
      timersRef.current.set(a.id, timer);
    }
  }, [active, doneActivation]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
      for (const timer of fadeTimersRef.current.values()) clearTimeout(timer);
      fadeTimersRef.current.clear();
      ackSentRef.current.clear();
    };
  }, []);

  const getPositionStyles = useCallback(
    (item: QueuedActivation): React.CSSProperties => {
      const base: React.CSSProperties = {
        position: 'fixed',
        zIndex: 9999,
        pointerEvents: 'none',
        // Default; overridden per-position below when needed.
        transformOrigin: 'center',
      };

      // Clamp size to feel like an overlay (not a full web page).
      // Since scale applies via transform, reduce pre-scale bounds to keep the final size within viewport.
      const preScaleMaxVw = Math.max(16, Math.min(50, 42 / safeScale));
      const preScaleMaxVh = Math.max(16, Math.min(50, 42 / safeScale));
      const sizeClamp: React.CSSProperties = {
        maxWidth: `${preScaleMaxVw}vw`,
        maxHeight: `${preScaleMaxVh}vh`,
      };

      switch (position) {
        case 'random':
          return {
            ...base,
            ...sizeClamp,
            top: Number.isFinite(item?.yPx) ? `${item.yPx}px` : `${item?.yPct ?? 50}%`,
            left: Number.isFinite(item?.xPx) ? `${item.xPx}px` : `${item?.xPct ?? 50}%`,
            transform: `translate(-50%, -50%) scale(${safeScale})`,
          };
        case 'center':
          return {
            ...base,
            ...sizeClamp,
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) scale(${safeScale})`,
          };
        case 'top':
          return {
            ...base,
            ...sizeClamp,
            top: '24px',
            left: '50%',
            transform: `translateX(-50%) scale(${safeScale})`,
          };
        case 'bottom':
          return {
            ...base,
            ...sizeClamp,
            bottom: '24px',
            left: '50%',
            transform: `translateX(-50%) scale(${safeScale})`,
          };
        case 'top-left':
          return {
            ...base,
            ...sizeClamp,
            top: '24px',
            left: '24px',
            transformOrigin: 'top left',
            transform: `scale(${safeScale})`,
          };
        case 'top-right':
          return {
            ...base,
            ...sizeClamp,
            top: '24px',
            right: '24px',
            transformOrigin: 'top right',
            transform: `scale(${safeScale})`,
          };
        case 'bottom-left':
          return {
            ...base,
            ...sizeClamp,
            bottom: '24px',
            left: '24px',
            transformOrigin: 'bottom left',
            transform: `scale(${safeScale})`,
          };
        case 'bottom-right':
          return {
            ...base,
            ...sizeClamp,
            bottom: '24px',
            right: '24px',
            transformOrigin: 'bottom right',
            transform: `scale(${safeScale})`,
          };
        default:
          return {
            ...base,
            ...sizeClamp,
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) scale(${safeScale})`,
          };
      }
    },
    [position, safeScale]
  );

  const cardStyle = useMemo<React.CSSProperties>(() => {
    const effectiveRadius = radius || 20;
    const effectiveShadow = shadow || 70;
    const effectiveBlur = blur || 6;
    const effectiveBorder = border || 2;
    const effectiveBgOpacity = Number.isFinite(bgOpacity) ? bgOpacity : 0.18;
    // Premium/Apple-ish defaults: a bit slower and smoother.
    const effectiveEnterMs = Number.isFinite(enterMs) ? enterMs : 420;
    const effectiveExitMs = Number.isFinite(exitMs) ? exitMs : 320;
    return {
      borderRadius: effectiveRadius,
      overflow: 'hidden',
      border: `${effectiveBorder}px solid rgba(255,255,255,0.38)`,
      outline: '1px solid rgba(0,0,0,0.35)',
      boxShadow: `0 22px ${effectiveShadow}px rgba(0,0,0,0.60)`,
      background: `rgba(0,0,0,${effectiveBgOpacity})`,
      backdropFilter: `blur(${effectiveBlur}px)`,
      opacity: 1,
      willChange: 'transform, opacity',
      transition: `opacity ${Math.max(0, effectiveExitMs)}ms ease, transform ${Math.max(0, effectiveExitMs)}ms ease`,
      animation:
        anim === 'none'
          ? undefined
          : anim === 'zoom'
            ? `memalertsZoomIn ${Math.max(0, effectiveEnterMs)}ms cubic-bezier(0.22, 1, 0.36, 1)`
            : anim === 'slide-up'
              ? `memalertsSlideUp ${Math.max(0, effectiveEnterMs)}ms cubic-bezier(0.22, 1, 0.36, 1)`
              : `memalertsFadeIn ${Math.max(0, effectiveEnterMs)}ms ease`,
    };
  }, [anim, bgOpacity, blur, border, enterMs, exitMs, radius, shadow]);

  const mediaStyle = useMemo<React.CSSProperties>(() => {
    return {
      display: 'block',
      width: '100%',
      height: '100%',
      maxWidth: '100%',
      maxHeight: '100%',
      objectFit: 'contain',
      background: 'rgba(0,0,0,0.35)',
    };
  }, []);

  const badgeStyle = useMemo<React.CSSProperties>(() => {
    return {
      marginTop: 10,
      alignSelf: 'center',
      padding: '7px 12px',
      fontSize: 13,
      lineHeight: 1.2,
      color: 'rgba(255,255,255,0.92)',
      background: 'rgba(0,0,0,0.62)',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: 999,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '48vw',
    };
  }, []);

  const demoItem: QueuedActivation | null = useMemo(() => {
    if (!demo) return null;
    return {
      id: '__demo__',
      memeId: '__demo__',
      type: previewTypeParam || 'demo',
      fileUrl: previewUrlParam || '',
      durationMs: 4000,
      title: 'DEMO',
      senderDisplayName: 'Viewer123',
      startTime: Date.now(),
      xPct: 50,
      yPct: 50,
    };
  }, [demo, previewTypeParam, previewUrlParam]);

  const renderItems = active.length > 0 ? active : demoItem ? [demoItem] : [];
  if (renderItems.length === 0) return null;

  return (
    <>
      <style>
        {`
          @keyframes memalertsFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes memalertsZoomIn {
            from { opacity: 0; transform: scale(0.92); }
            to { opacity: 1; transform: scale(1); }
          }
          @keyframes memalertsSlideUp {
            from { opacity: 0; transform: translateY(24px) scale(0.98); }
            to { opacity: 1; transform: translateY(0px) scale(1); }
          }
        `}
      </style>
      {renderItems.map((item) => (
        <div
          key={item.id}
          style={getPositionStyles(item)}
          ref={(el) => {
            itemRefs.current.set(item.id, el);
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
            <div
              style={{
                ...cardStyle,
                opacity: item.isExiting ? 0 : 1,
                transform:
                  anim === 'zoom'
                    ? item.isExiting
                      ? 'scale(0.96)'
                      : undefined
                    : anim === 'slide-up'
                      ? item.isExiting
                        ? 'translateY(14px) scale(0.99)'
                        : undefined
                      : undefined,
              }}
            >
            {(item.type === 'image' || item.type === 'gif') && (
              <img
                src={getMediaUrl(item.fileUrl)}
                alt={item.title}
                style={mediaStyle}
                onLoad={() => {
                  // Trigger clamp recalculation after media loads (size becomes known).
                  setActive((prev) => prev.map((a) => (a.id === item.id ? { ...a, layoutTick: (a.layoutTick ?? 0) + 1 } : a)));
                }}
              />
            )}

            {item.type === 'video' && (
              <video
                src={getMediaUrl(item.fileUrl)}
                autoPlay
                playsInline
                muted={mutedByDefault || volume <= 0}
                style={mediaStyle}
                onLoadedData={(e) => {
                  e.currentTarget.volume = Math.min(1, Math.max(0, volume));
                }}
                onLoadedMetadata={(e) => {
                  const dur = e.currentTarget.duration;
                  if (Number.isFinite(dur) && dur > 0) {
                    const ms = Math.round(dur * 1000);
                    setActive((prev) => prev.map((a) => (a.id === item.id ? { ...a, effectiveDurationMs: ms } : a)));
                    updateFallbackTimer(item.id, ms);
                  }
                  // Trigger clamp recalculation (video intrinsic size becomes known).
                  setActive((prev) => prev.map((a) => (a.id === item.id ? { ...a, layoutTick: (a.layoutTick ?? 0) + 1 } : a)));
                }}
                onError={() => doneActivation(item.id)}
                onStalled={() => doneActivation(item.id)}
                onEnded={() => doneActivation(item.id)}
              />
            )}

            {item.type === 'audio' && (
              <audio
                src={getMediaUrl(item.fileUrl)}
                autoPlay
                muted={mutedByDefault || volume <= 0}
                onLoadedData={(e) => {
                  e.currentTarget.volume = Math.min(1, Math.max(0, volume));
                }}
                onLoadedMetadata={(e) => {
                  const dur = (e.currentTarget as HTMLAudioElement).duration;
                  if (Number.isFinite(dur) && dur > 0) {
                    const ms = Math.round(dur * 1000);
                    setActive((prev) => prev.map((a) => (a.id === item.id ? { ...a, effectiveDurationMs: ms } : a)));
                    updateFallbackTimer(item.id, ms);
                  }
                  // Trigger clamp recalculation (audio tag layout can change once metadata loads).
                  setActive((prev) => prev.map((a) => (a.id === item.id ? { ...a, layoutTick: (a.layoutTick ?? 0) + 1 } : a)));
                }}
                onError={() => doneActivation(item.id)}
                onStalled={() => doneActivation(item.id)}
                onEnded={() => doneActivation(item.id)}
              />
            )}

            {item.type === 'demo' && (
              <div
                style={{
                  ...mediaStyle,
                  height: Math.round(300 * safeScale),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background:
                    'radial-gradient(80% 80% at 30% 20%, rgba(255,255,255,0.16) 0%, rgba(0,0,0,0.6) 60%), linear-gradient(135deg, rgba(56,189,248,0.55), rgba(167,139,250,0.55))',
                  color: 'rgba(255,255,255,0.92)',
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textShadow: '0 6px 24px rgba(0,0,0,0.55)',
                }}
              >
                DEMO
              </div>
            )}

            </div>

            {config.overlayShowSender && item.senderDisplayName && (
              <div style={badgeStyle}>{item.senderDisplayName}</div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

