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
  // Auto-fit scale to keep the item inside viewport (used mainly for preview / extreme aspect ratios).
  fitScale?: number;
  // Per-item scale (supports fixed vs range).
  userScale?: number;
}

interface OverlayConfig {
  overlayMode: OverlayMode;
  overlayShowSender: boolean;
  overlayMaxConcurrent: number;
  overlayStyleJson?: string | null;
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

function clampDeg(n: number): number {
  if (!Number.isFinite(n)) return 90;
  // Normalize into [0, 360)
  const v = ((n % 360) + 360) % 360;
  return v;
}

function isHexColor(v: string): boolean {
  return /^#([0-9a-fA-F]{6})$/.test(v);
}

function clampAlpha(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
    overlayStyleJson: null,
  });

  // Unlimited mode should not require a user-configured limit, but we still need a hard cap
  // to prevent OBS/browser from melting down if spammed.
  const SIMULTANEOUS_HARD_CAP = 500;

  const [queue, setQueue] = useState<QueuedActivation[]>([]);
  const [active, setActive] = useState<QueuedActivation[]>([]);
  const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [liveParams, setLiveParams] = useState<Record<string, string>>({});
  const demoSeqRef = useRef(0);

  const ackSentRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const fadeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only accept messages from same-origin parent (Admin page).
      if (event.origin !== window.location.origin) return;
      const data = event.data as any;
      if (!data || typeof data !== 'object') return;
      if (data.type !== 'memalerts:overlayParams') return;
      const params = data.params as Record<string, unknown>;
      if (!params || typeof params !== 'object') return;
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) {
        if (typeof v === 'string') next[k] = v;
      }
      setLiveParams(next);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const getParam = useCallback(
    (key: string): string | null => {
      const v = liveParams[key];
      if (typeof v === 'string') return v;
      return searchParams.get(key);
    },
    [liveParams, searchParams]
  );

  const scale = parseFloat(getParam('scale') || '1');
  const urlScaleMode = String(getParam('scaleMode') || '').trim().toLowerCase();
  const urlScaleFixed = parseFloat(String(getParam('scaleFixed') || ''));
  const urlScaleMin = parseFloat(String(getParam('scaleMin') || ''));
  const urlScaleMax = parseFloat(String(getParam('scaleMax') || ''));
  const position = (getParam('position') || 'random').toLowerCase() as OverlayPosition;
  const volume = parseFloat(getParam('volume') || '1');
  const demo = (getParam('demo') || '') === '1';
  const previewUrlsParam = useMemo(
    () => searchParams.getAll('previewUrl').map((v) => String(v || '').trim()).filter(Boolean),
    [searchParams]
  );
  const previewTypesParam = useMemo(
    () => searchParams.getAll('previewType').map((v) => String(v || '').trim().toLowerCase()).filter(Boolean),
    [searchParams]
  );
  const previewCount = clampInt(parseInt(String(getParam('previewCount') || ''), 10), 1, 5);
  const previewRepeat = (getParam('repeat') || '') === '1';
  const previewModeParam = String(getParam('previewMode') || '').trim().toLowerCase();
  const demoSeed = clampInt(parseInt(String(getParam('seed') || '1'), 10), 0, 1000000000);

  // Appearance / animation: prefer server config; allow URL overrides (useful for preview).
  const parsedStyle = useMemo(() => {
    try {
      const raw = String(config.overlayStyleJson || '').trim();
      if (!raw) return null;
      const j = JSON.parse(raw) as any;
      return j && typeof j === 'object' ? j : null;
    } catch {
      return null;
    }
  }, [config.overlayStyleJson]);

  const radius = clampInt(parseInt(String(getParam('radius') || (parsedStyle as any)?.radius || ''), 10), 0, 80);
  // Shadow params (back-compat: `shadow` = blur)
  const shadowBlur = clampInt(parseInt(String(getParam('shadowBlur') || (parsedStyle as any)?.shadowBlur || searchParams.get('shadow') || (parsedStyle as any)?.shadow || ''), 10), 0, 240);
  const shadowSpread = clampInt(parseInt(String(getParam('shadowSpread') || (parsedStyle as any)?.shadowSpread || ''), 10), 0, 120);
  const shadowDistance = clampInt(parseInt(String(getParam('shadowDistance') || (parsedStyle as any)?.shadowDistance || ''), 10), 0, 120);
  const shadowAngle = clampDeg(parseFloat(String(getParam('shadowAngle') || (parsedStyle as any)?.shadowAngle || '')));
  const shadowOpacity = clampAlpha(parseFloat(String(getParam('shadowOpacity') || (parsedStyle as any)?.shadowOpacity || '0.60')), 0, 1);
  const shadowColorRaw = String(getParam('shadowColor') || (parsedStyle as any)?.shadowColor || '').trim();
  const shadowColor = isHexColor(shadowColorRaw) ? shadowColorRaw : '#000000';
  const blur = clampInt(parseInt(String(getParam('blur') || (parsedStyle as any)?.blur || ''), 10), 0, 40);
  const border = clampInt(parseInt(String(getParam('border') || (parsedStyle as any)?.border || ''), 10), 0, 12);

  const borderModeRaw = String(getParam('borderMode') || (parsedStyle as any)?.borderMode || 'solid').trim().toLowerCase();
  const borderMode: 'solid' | 'gradient' = borderModeRaw === 'gradient' ? 'gradient' : 'solid';
  const borderColorRaw = String(getParam('borderColor') || (parsedStyle as any)?.borderColor || '').trim();
  const borderColor = isHexColor(borderColorRaw) ? borderColorRaw : '#FFFFFF';
  const borderColor2Raw = String(getParam('borderColor2') || (parsedStyle as any)?.borderColor2 || '').trim();
  const borderColor2 = isHexColor(borderColor2Raw) ? borderColor2Raw : '#00E5FF';
  const borderGradientAngle = clampDeg(parseFloat(String(getParam('borderGradientAngle') || (parsedStyle as any)?.borderGradientAngle || '135')));
  const bgOpacity = clampFloat(parseFloat(String(getParam('bgOpacity') || (parsedStyle as any)?.bgOpacity || '')), 0, 0.65);
  const anim = (String(getParam('anim') || (parsedStyle as any)?.anim || 'fade').toLowerCase() as OverlayAnim) || 'fade';
  const enterMs = clampInt(parseInt(String(getParam('enterMs') || (parsedStyle as any)?.enterMs || ''), 10), 0, 1200);
  const exitMs = clampInt(parseInt(String(getParam('exitMs') || (parsedStyle as any)?.exitMs || ''), 10), 0, 1200);

  const senderFontSize = clampInt(parseInt(String(getParam('senderFontSize') || (parsedStyle as any)?.senderFontSize || ''), 10), 10, 28);
  const senderFontWeight = clampInt(parseInt(String(getParam('senderFontWeight') || (parsedStyle as any)?.senderFontWeight || ''), 10), 400, 800);
  const senderFontFamily = String(getParam('senderFontFamily') || (parsedStyle as any)?.senderFontFamily || 'system').trim().toLowerCase();

  const safeScale = useMemo(() => {
    // Prefer server-configured fixed scale; fallback to URL scale for preview/back-compat.
    const urlFixed = Number.isFinite(urlScaleFixed) && urlScaleFixed > 0 ? urlScaleFixed : NaN;
    const fixed = Number((parsedStyle as any)?.scaleFixed);
    const s = Number.isFinite(urlFixed)
      ? urlFixed
      : Number.isFinite(fixed) && fixed > 0
        ? fixed
        : (Number.isFinite(scale) ? scale : 1);
    return Math.min(2.5, Math.max(0.25, s));
  }, [parsedStyle, scale, urlScaleFixed]);

  const resolvedPosition = useMemo<OverlayPosition>(() => {
    const p = String((parsedStyle as any)?.position || '').toLowerCase();
    if (
      p === 'random' ||
      p === 'center' ||
      p === 'top' ||
      p === 'bottom' ||
      p === 'top-left' ||
      p === 'top-right' ||
      p === 'bottom-left' ||
      p === 'bottom-right'
    ) {
      return p as OverlayPosition;
    }
    return position;
  }, [parsedStyle, position]);

  const getNextUserScale = useCallback((): number => {
    const mode = urlScaleMode || String((parsedStyle as any)?.scaleMode || '').toLowerCase();
    if (mode === 'range') {
      const min = clampFloat(
        Number.isFinite(urlScaleMin) ? urlScaleMin : Number((parsedStyle as any)?.scaleMin),
        0.25,
        2.5
      );
      const max = clampFloat(
        Number.isFinite(urlScaleMax) ? urlScaleMax : Number((parsedStyle as any)?.scaleMax),
        0.25,
        2.5
      );
      const lo = Math.min(min, max);
      const hi = Math.max(min, max);
      return clampFloat(lo + Math.random() * (hi - lo), 0.25, 2.5);
    }
    const fixed = clampFloat(
      Number.isFinite(urlScaleFixed) ? urlScaleFixed : Number((parsedStyle as any)?.scaleFixed),
      0.25,
      2.5
    );
    if (Number.isFinite(fixed) && fixed > 0) return fixed;
    return safeScale;
  }, [parsedStyle, safeScale, urlScaleFixed, urlScaleMax, urlScaleMin, urlScaleMode]);

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
    // Demo preview should not connect to sockets (avoid side effects/acks).
    if (demo) return;

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
      const overlayStyleJson = (incoming as any)?.overlayStyleJson ?? null;
      setConfig({ overlayMode, overlayShowSender, overlayMaxConcurrent, overlayStyleJson });
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
  }, [channelSlug, demo, token]);

  const maxActive = useMemo(() => {
    if (config.overlayMode === 'queue') return 1;
    // In simultaneous mode, respect server-configured maxConcurrent (with a hard cap for safety).
    const n = clampInt(Number(config.overlayMaxConcurrent ?? 3), 1, SIMULTANEOUS_HARD_CAP);
    return n;
  }, [config.overlayMaxConcurrent, config.overlayMode]);

  const getPreviewMediaAt = useCallback(
    (idx: number): { fileUrl: string; type: string } => {
      const fallbackUrl = String(searchParams.get('previewUrl') || '').trim();
      const fallbackType = String(searchParams.get('previewType') || '').trim().toLowerCase();

      const urls = previewUrlsParam.length > 0 ? previewUrlsParam : (fallbackUrl ? [fallbackUrl] : []);
      const types = previewTypesParam.length > 0 ? previewTypesParam : (fallbackType ? [fallbackType] : []);

      const fileUrl = urls.length > 0 ? urls[Math.abs(idx) % urls.length] : '';
      const type = types.length > 0 ? types[Math.abs(idx) % types.length] : 'demo';
      return { fileUrl, type };
    },
    [previewTypesParam, previewUrlsParam, searchParams]
  );

  const pickRandomPosition = useCallback((): { xPct: number; yPct: number } => {
    // Safe margin in % to reduce clipping risk. Increase margin when scale grows.
    // This isn't perfect (we don't know exact media aspect), but reduces "going off-screen" in OBS.
    const baseMargin = 12;
    const margin = Math.min(24, Math.max(10, Math.round(baseMargin * safeScale)));
    // Deterministic RNG for demo so sliders don't reshuffle positions (when iframe does not reload).
    const rng = mulberry32((demoSeed + demoSeqRef.current * 9973) >>> 0);
    const xPct = margin + rng() * (100 - margin * 2);
    const yPct = margin + rng() * (100 - margin * 2);
    return { xPct, yPct };
  }, [demoSeed, safeScale]);

  // Demo seeding: spawn N preview items and optionally repeat.
  useEffect(() => {
    if (!demo) return;

    demoSeqRef.current += 1;
    const mode: OverlayMode =
      previewModeParam === 'queue' ? 'queue' : previewCount > 1 ? 'simultaneous' : 'queue';

    // Override config locally for preview.
    setConfig((p) => ({
      ...p,
      overlayMode: mode,
      overlayMaxConcurrent: clampInt(previewCount, 1, 5),
    }));

    const seed: QueuedActivation[] = Array.from({ length: previewCount }).map((_, idx) => ({
      id: `__demo_seed__${Date.now()}_${idx}`,
      memeId: '__demo__',
      ...getPreviewMediaAt(idx),
      durationMs: 8000,
      title: 'DEMO',
      senderDisplayName: 'Viewer123',
      startTime: Date.now(),
      ...(mode === 'simultaneous' ? pickRandomPosition() : { xPct: 50, yPct: 50 }),
      userScale: getNextUserScale(),
    }));

    // In demo:
    // - queue mode should behave like real queue (1 at a time)
    // - simultaneous mode should show N items immediately (avoid any timing/state race with maxActive)
    if (mode === 'queue') {
      setQueue(seed);
      setActive([]);
    } else {
      setQueue([]);
      setActive(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, getNextUserScale, getPreviewMediaAt, pickRandomPosition, previewCount, previewModeParam]);

  const emitAckDoneOnce = useCallback((activationId: string) => {
    const id = String(activationId || '').trim();
    if (!id) return;
    if (demo) return;
    if (ackSentRef.current.has(id)) return;
    ackSentRef.current.add(id);
    socketRef.current?.emit('activation:ackDone', { activationId: id });
  }, [demo]);

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

      // Demo repeat: enqueue a fresh item after it fully disappears.
      if (demo && previewRepeat) {
        setTimeout(() => {
          demoSeqRef.current += 1;
          const next: QueuedActivation = {
            id: `__demo__${Date.now()}_${Math.random().toString(16).slice(2)}`,
            memeId: '__demo__',
            ...getPreviewMediaAt(Date.now()),
            durationMs: 8000,
            title: 'DEMO',
            senderDisplayName: 'Viewer123',
            startTime: Date.now(),
            ...(resolvedPosition === 'random' ? pickRandomPosition() : { xPct: 50, yPct: 50 }),
            userScale: getNextUserScale(),
          } as any;

          // If demo is in simultaneous mode, keep it immediate and capped (no queue).
          // Otherwise, push into queue so queue mode remains sequential.
          const demoMode: OverlayMode =
            previewModeParam === 'queue' ? 'queue' : previewCount > 1 ? 'simultaneous' : 'queue';
          if (demoMode === 'simultaneous') {
            setActive((prevA) => {
              const cap = clampInt(previewCount, 1, 5);
              const nextA = [...prevA, next];
              return nextA.slice(-cap);
            });
          } else {
            setQueue((prevQ) => [...prevQ, next]);
          }
        }, 150);
      }
    }, 220);
    fadeTimersRef.current.set(id, fadeTimer);
  }, [
    demo,
    emitAckDoneOnce,
    getNextUserScale,
    getPreviewMediaAt,
    pickRandomPosition,
    previewCount,
    previewModeParam,
    previewRepeat,
    resolvedPosition,
  ]);

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
      const base = { ...a, userScale: a.userScale ?? getNextUserScale() };
      if (resolvedPosition === 'random') {
        const { xPct, yPct } = pickRandomPosition();
        return { ...base, xPct, yPct };
      }
      return base;
    });

    setQueue((prev) => prev.slice(toStartRaw.length));
    setActive((prev) => [...prev, ...toStart]);
  }, [active.length, getNextUserScale, maxActive, pickRandomPosition, queue, resolvedPosition]);

  // Clamp random-position activations so they never get clipped by the OBS canvas.
  // We do this after render using the actual DOM rect (covers unknown aspect ratios and scale).
  useEffect(() => {
    if (active.length === 0) return;
    if (typeof window === 'undefined') return;

    // Padding is not user-configurable; keep safe defaults.
    // We use bigger padding for random (to reduce clipping) and tighter for anchored positions.
    const basePad = resolvedPosition === 'random' ? 80 : 24;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (vw <= basePad * 2 || vh <= basePad * 2) return;

    setActive((prev) => {
      let changed = false;
      const next = prev.map((a) => {
        if (!a?.id) return a;
        if (a.isExiting) return a;
        const el = itemRefs.current.get(a.id);
        if (!el) return a;

        const rect = el.getBoundingClientRect();
        if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return a;

        // Auto-fit: if the element is larger than the viewport safe area, scale it down.
        // Account for anchored positions (top/left offsets) so tall/vertical memes never go out of bounds.
        const padL = resolvedPosition === 'top-left' || resolvedPosition === 'bottom-left' ? 24 : basePad;
        const padR = resolvedPosition === 'top-right' || resolvedPosition === 'bottom-right' ? 24 : basePad;
        const padT = resolvedPosition === 'top' || resolvedPosition === 'top-left' || resolvedPosition === 'top-right' ? 24 : basePad;
        const padB = resolvedPosition === 'bottom' || resolvedPosition === 'bottom-left' || resolvedPosition === 'bottom-right' ? 24 : basePad;

        const availW = Math.max(1, vw - padL - padR);
        const availH = Math.max(1, vh - padT - padB);

        // Compute fitScale based on the *un-fitted* size so we don't oscillate and so extreme
        // aspect ratios (very tall memes) never slip off-screen between frames.
        const currentFit = clampFloat(Number(a.fitScale ?? 1), 0.25, 1);
        const baseW = rect.width / Math.max(0.0001, currentFit);
        const baseH = rect.height / Math.max(0.0001, currentFit);
        // Safety factor to avoid 1px rounding/scrollbar issues leaving the element barely out of bounds.
        const fit = Math.min(1, (availW / baseW) * 0.985, (availH / baseH) * 0.985);
        const nextFit = clampFloat(fit, 0.25, 1);
        if (!Number.isFinite(a.fitScale) || Math.abs((a.fitScale ?? 1) - nextFit) > 0.01) {
          changed = true;
          a = { ...a, fitScale: nextFit };
        }

        // Coordinate clamping:
        // - for random: keep random center but clamp it into the safe area
        // - for anchored modes: compute an anchored center and clamp it into the safe area.
        // We render via xPx/yPx when set, which guarantees "never off-screen".

        // Predict the size after nextFit is applied, then clamp center based on that size.
        const effectiveW = baseW * nextFit;
        const effectiveH = baseH * nextFit;
        const currentCenterX = Number.isFinite(a?.xPx) ? Number(a.xPx) : rect.left + rect.width / 2;
        const currentCenterY = Number.isFinite(a?.yPx) ? Number(a.yPx) : rect.top + rect.height / 2;

        const minX = padL + effectiveW / 2;
        const maxX = vw - padR - effectiveW / 2;
        const minY = padT + effectiveH / 2;
        const maxY = vh - padB - effectiveH / 2;

        const defaultX =
          resolvedPosition === 'top-left' || resolvedPosition === 'bottom-left'
            ? padL + effectiveW / 2
            : resolvedPosition === 'top-right' || resolvedPosition === 'bottom-right'
              ? vw - padR - effectiveW / 2
              : vw / 2;
        const defaultY =
          resolvedPosition === 'top' || resolvedPosition === 'top-left' || resolvedPosition === 'top-right'
            ? padT + effectiveH / 2
            : resolvedPosition === 'bottom' || resolvedPosition === 'bottom-left' || resolvedPosition === 'bottom-right'
              ? vh - padB - effectiveH / 2
              : vh / 2;

        const desiredX = resolvedPosition === 'random' ? currentCenterX : defaultX;
        const desiredY = resolvedPosition === 'random' ? currentCenterY : defaultY;

        // If the item is larger than available space even after fitting, fall back to center.
        const safeX = minX > maxX ? vw / 2 : Math.min(maxX, Math.max(minX, desiredX));
        const safeY = minY > maxY ? vh / 2 : Math.min(maxY, Math.max(minY, desiredY));

        // Only update if we are actually out of bounds by more than 1px.
        if (
          !Number.isFinite(a?.xPx) ||
          !Number.isFinite(a?.yPx) ||
          Math.abs(safeX - currentCenterX) > 1 ||
          Math.abs(safeY - currentCenterY) > 1
        ) {
          changed = true;
          return { ...a, xPx: safeX, yPx: safeY };
        }

        return a;
      });

      return changed ? next : prev;
    });
  }, [active, border, config.overlayShowSender, radius, resolvedPosition, safeScale, senderFontSize]);

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

      const baseScale = clampFloat(Number(item.userScale ?? safeScale), 0.25, 2.5);
      // Never allow fitScale to enlarge the item. It exists only to shrink oversized media.
      const fit = clampFloat(Number(item.fitScale ?? 1), 0.25, 1);
      const finalScale = baseScale * fit;

      // IMPORTANT: normalize visual size across different source resolutions.
      // We render the meme inside a fixed viewport-based box, then use object-fit: contain inside it.
      // This avoids "low-res looks bigger / high-res looks smaller" and stabilizes viewport clamping.
      const sizeClamp: React.CSSProperties = {
        width: 'clamp(260px, 34vw, 560px)',
        height: 'clamp(260px, 34vh, 560px)',
      };

      // Safety override: if we have clamped pixel-center coordinates, render as centered-by-px
      // regardless of the selected anchor position. This guarantees "never off-screen" even
      // for extreme aspect ratios / late media resize.
      if (Number.isFinite(item?.xPx) && Number.isFinite(item?.yPx)) {
        return {
          ...base,
          ...sizeClamp,
          top: `${item.yPx}px`,
          left: `${item.xPx}px`,
          transform: `translate(-50%, -50%) scale(${finalScale})`,
        };
      }

      switch (resolvedPosition) {
        case 'random':
          return {
            ...base,
            ...sizeClamp,
            top: Number.isFinite(item?.yPx) ? `${item.yPx}px` : `${item?.yPct ?? 50}%`,
            left: Number.isFinite(item?.xPx) ? `${item.xPx}px` : `${item?.xPct ?? 50}%`,
            transform: `translate(-50%, -50%) scale(${finalScale})`,
          };
        case 'center':
          return {
            ...base,
            ...sizeClamp,
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) scale(${finalScale})`,
          };
        case 'top':
          return {
            ...base,
            ...sizeClamp,
            top: '24px',
            left: '50%',
            transformOrigin: 'top center',
            transform: `translateX(-50%) scale(${finalScale})`,
          };
        case 'bottom':
          return {
            ...base,
            ...sizeClamp,
            bottom: '24px',
            left: '50%',
            transformOrigin: 'bottom center',
            transform: `translateX(-50%) scale(${finalScale})`,
          };
        case 'top-left':
          return {
            ...base,
            ...sizeClamp,
            top: '24px',
            left: '24px',
            transformOrigin: 'top left',
            transform: `scale(${finalScale})`,
          };
        case 'top-right':
          return {
            ...base,
            ...sizeClamp,
            top: '24px',
            right: '24px',
            transformOrigin: 'top right',
            transform: `scale(${finalScale})`,
          };
        case 'bottom-left':
          return {
            ...base,
            ...sizeClamp,
            bottom: '24px',
            left: '24px',
            transformOrigin: 'bottom left',
            transform: `scale(${finalScale})`,
          };
        case 'bottom-right':
          return {
            ...base,
            ...sizeClamp,
            bottom: '24px',
            right: '24px',
            transformOrigin: 'bottom right',
            transform: `scale(${finalScale})`,
          };
        default:
          return {
            ...base,
            ...sizeClamp,
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) scale(${finalScale})`,
          };
      }
    },
    [resolvedPosition, safeScale]
  );

  const borderWrapStyle = useMemo<React.CSSProperties>(() => {
    const w = border || 0;
    if (w <= 0) {
      return {
        borderRadius: radius || 20,
        padding: 0,
        background: 'transparent',
      };
    }
    const bg =
      borderMode === 'gradient'
        ? `linear-gradient(${borderGradientAngle}deg, ${borderColor}, ${borderColor2})`
        : borderColor;
    return {
      borderRadius: radius || 20,
      padding: w,
      background: bg,
    };
  }, [border, borderColor, borderColor2, borderGradientAngle, borderMode, radius]);

  const cardStyle = useMemo<React.CSSProperties>(() => {
    const effectiveRadius = radius || 20;
    const effectiveBlur = blur || 6;
    const effectiveBgOpacity = Number.isFinite(bgOpacity) ? bgOpacity : 0.18;
    // Shadow direction (angle).
    const distance = Number.isFinite(shadowDistance) && shadowDistance > 0 ? shadowDistance : 22;
    const rad = (shadowAngle * Math.PI) / 180;
    const offX = Math.round(Math.cos(rad) * distance);
    const offY = Math.round(Math.sin(rad) * distance);
    const shadowR = parseInt(shadowColor.slice(1, 3), 16);
    const shadowG = parseInt(shadowColor.slice(3, 5), 16);
    const shadowB = parseInt(shadowColor.slice(5, 7), 16);
    const shadowRgba = `rgba(${shadowR},${shadowG},${shadowB},${shadowOpacity})`;
    // Premium/Apple-ish defaults: a bit slower and smoother.
    const effectiveEnterMs = Number.isFinite(enterMs) ? enterMs : 420;
    const effectiveExitMs = Number.isFinite(exitMs) ? exitMs : 320;
    return {
      // Inner radius accounts for border padding wrapper.
      borderRadius: Math.max(0, effectiveRadius - (border || 0)),
      overflow: 'hidden',
      outline: '1px solid rgba(0,0,0,0.35)',
      boxShadow: `${offX}px ${offY}px ${shadowBlur}px ${shadowSpread}px ${shadowRgba}`,
      // Stronger "glass" feel: add subtle light highlights + saturate.
      background: `linear-gradient(135deg, rgba(255,255,255,0.20), rgba(255,255,255,0.04)), rgba(0,0,0,${effectiveBgOpacity})`,
      backdropFilter: `blur(${effectiveBlur}px) saturate(1.35)`,
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
  }, [
    anim,
    bgOpacity,
    blur,
    border,
    enterMs,
    exitMs,
    radius,
    shadowAngle,
    shadowBlur,
    shadowColor,
    shadowDistance,
    shadowOpacity,
    shadowSpread,
  ]);

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
    const family =
      senderFontFamily === 'mono'
        ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
        : senderFontFamily === 'serif'
          ? 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'
          : 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
    return {
      marginTop: 10,
      alignSelf: 'center',
      padding: '7px 12px',
      fontSize: senderFontSize,
      fontWeight: senderFontWeight,
      fontFamily: family,
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
  }, [senderFontFamily, senderFontSize, senderFontWeight]);

  const renderItems = active;
  if (renderItems.length === 0) return null;

  return (
    <>
      <style>
        {`
          ${demo ? `body { background: radial-gradient(60% 60% at 25% 15%, rgba(255,255,255,0.10) 0%, rgba(0,0,0,0.85) 60%), linear-gradient(135deg, rgba(56,189,248,0.12), rgba(167,139,250,0.12)); }` : ''}
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
            <div style={borderWrapStyle}>
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

            {(item.type === 'video' || item.type === 'webm') && (
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

