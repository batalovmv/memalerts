import { GetActiveEventsResponseSchema, type Event, type VoteSession, type WheelPrize } from '@memalerts/api-contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';

import { EventConfetti } from './components/EventConfetti';
import { VoteOverlay } from './components/VoteOverlay';
import { WheelSpinOverlay } from './components/WheelSpinOverlay';
import { clampFloat, clampInt } from './lib/math';
import { useOverlayParams } from './model/useOverlayParams';
import { getSocketBaseUrl, resolveMediaUrl } from './urls';

import type {
  Activation,
  OverlayConfig,
  OverlayMode,
  QueuedActivation,
} from './overlay-view/types';

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
  const [voteSession, setVoteSession] = useState<VoteSession | null>(null);
  const [showVote, setShowVote] = useState(false);
  const [lastSpin, setLastSpin] = useState<{ id: string; displayName: string | null; prize: WheelPrize } | null>(null);
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [eventBurstKey, setEventBurstKey] = useState(0);
  const activeEventRef = useRef<Event | null>(null);
  const voteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    demo,
    demoBgCss,
    previewUrlsParam,
    previewTypesParam,
    previewCount,
    previewRepeat,
    previewModeParam,
    safePadPx,
    lockPos,
    showSafeGuide,
    safeScale,
    resolvedPosition,
    getNextUserScale,
    pickRandomPosition,
    // Style/appearance
    radius,
    shadowBlur,
    shadowSpread,
    shadowDistance,
    shadowAngle,
    shadowOpacity,
    shadowColor,
    blur,
    border,
    borderPreset,
    borderTintColor,
    borderTintStrength,
    borderMode,
    borderColor,
    borderColor2,
    borderGradientAngle,
    bgOpacity,
    anim,
    enterMs,
    exitMs,
    easing,
    senderFontSize,
    senderFontWeight,
    senderFontFamily,
    senderFontColor,
    senderHoldMs,
    senderBgOpacity,
    senderBgColor,
    senderBgRadius,
    senderStroke,
    senderStrokeWidth,
    senderStrokeOpacity,
    senderStrokeColor,
    glassEnabled,
    glassPreset,
    glassTintColor,
    glassTintStrength,
    volume,
  } = useOverlayParams({
    searchParams,
    liveParams,
    overlayStyleJson: config.overlayStyleJson ?? null,
    demoSeqRef,
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      // Only accept messages from same-origin parent (Admin page).
      if (event.origin !== window.location.origin) return;
      const data: unknown = event.data;
      if (!data || typeof data !== 'object') return;
      const msg = data as { type?: unknown; params?: unknown };
      if (msg.type !== 'memalerts:overlayParams') return;
      const params = msg.params as Record<string, unknown>;
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

  // Handshake: notify parent (settings page) that the overlay is ready to receive params.
  // Without this, the parent may postMessage on iframe load before our listener is attached,
  // which results in "DEMO" fallback until the next user action.
  useEffect(() => {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'memalerts:overlayReady' }, window.location.origin);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    return () => {
      if (voteTimerRef.current) clearTimeout(voteTimerRef.current);
      if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
    };
  }, []);

  useEffect(() => {
    activeEventRef.current = activeEvent;
  }, [activeEvent]);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;

    const loadEvents = async () => {
      try {
        const resp = await fetch('/public/events/active', { method: 'GET' });
        if (!resp.ok) return;
        const data = await resp.json();
        const parsed = GetActiveEventsResponseSchema.safeParse(data);
        if (!parsed.success) return;
        if (!cancelled) {
          setActiveEvent(parsed.data.events?.[0] ?? null);
        }
      } catch {
        // ignore
      }
    };

    void loadEvents();
    const timer = setInterval(loadEvents, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [demo]);

  const getParam = useCallback(
    (key: string): string | null => {
      const v = liveParams[key];
      if (typeof v === 'string') return v;
      return searchParams.get(key);
    },
    [liveParams, searchParams]
  );

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

  // In demo preview we ALWAYS keep media muted to avoid autoplay restrictions.
  const effectiveMuted = demo ? true : mutedByDefault || volume <= 0;

  const getMediaUrl = (fileUrl: string, playFileUrl?: string | null): string => {
    return resolveMediaUrl(playFileUrl || fileUrl);
  };

  useEffect(() => {
    const overlayToken = String(token || '').trim();
    const slug = String(channelSlug || '').trim();
    if (!overlayToken && !slug) return;
    // Demo preview should not connect to sockets (avoid side effects/acks).
    if (demo) return;

    const socketBase = getSocketBaseUrl();
    const newSocket = io(socketBase, {
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
      const overlayStyleJson = incoming?.overlayStyleJson ?? null;
      setConfig({ overlayMode, overlayShowSender, overlayMaxConcurrent, overlayStyleJson });
    });

    const pushActivation = (activation: Activation) => {
      setQueue((prev) => [
        ...prev,
        {
          ...activation,
          startTime: Date.now(),
        },
      ]);
      if (activeEventRef.current) {
        setEventBurstKey((k) => k + 1);
      }
    };

    const toOverlayActivation = (incoming: {
      activationId?: unknown;
      meme?: Partial<Activation> & { id?: unknown };
      activator?: { displayName?: unknown };
    }): Activation | null => {
      const activationId = String(incoming?.activationId || '').trim();
      const meme = incoming?.meme ?? {};
      const memeId = String((meme as { id?: unknown })?.id || '').trim();
      const type = typeof meme.type === 'string' ? meme.type : '';
      const fileUrl = typeof meme.fileUrl === 'string' ? meme.fileUrl : '';
      if (!activationId || !memeId || !type || !fileUrl) return null;
      const title = typeof meme.title === 'string' ? meme.title : '';
      const durationMs = typeof meme.durationMs === 'number' && Number.isFinite(meme.durationMs) ? meme.durationMs : 0;
      const playFileUrl = typeof meme.playFileUrl === 'string' ? meme.playFileUrl : null;
      const senderDisplayName =
        typeof incoming?.activator?.displayName === 'string' ? String(incoming.activator.displayName) : null;
      return {
        id: activationId,
        memeId,
        type,
        fileUrl,
        playFileUrl,
        durationMs,
        title,
        senderDisplayName,
      };
    };

    newSocket.on('activation:new', (activation: Activation) => {
      pushActivation(activation);
    });

    newSocket.on('overlay:meme-play', (incoming: { activationId?: unknown; meme?: Partial<Activation>; activator?: { displayName?: unknown } }) => {
      const activation = toOverlayActivation(incoming);
      if (!activation) return;
      pushActivation(activation);
    });

    const showVoteUntil = (session: VoteSession | null, holdMs: number) => {
      setVoteSession(session);
      setShowVote(!!session);
      if (voteTimerRef.current) clearTimeout(voteTimerRef.current);
      if (session && holdMs > 0) {
        voteTimerRef.current = setTimeout(() => {
          setShowVote(false);
        }, holdMs);
      }
    };

    newSocket.on('vote:updated', (payload: { session?: VoteSession | null }) => {
      const next = payload?.session ?? null;
      if (!next) {
        setVoteSession(null);
        setShowVote(false);
        return;
      }
      if (next.status === 'active') {
        setVoteSession(next);
        setShowVote(true);
        if (voteTimerRef.current) clearTimeout(voteTimerRef.current);
        return;
      }
      // Show results briefly after vote ends.
      showVoteUntil(next, 12_000);
    });

    newSocket.on('wheel:spin', (payload: { displayName?: string | null; prize?: WheelPrize }) => {
      if (!payload?.prize) return;
      setLastSpin({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
        prize: payload.prize,
      });
      if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
      spinTimerRef.current = setTimeout(() => {
        setLastSpin(null);
      }, 8_000);
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

  // Demo seeding: spawn N preview items and optionally repeat.
  useEffect(() => {
    if (!demo) return;

    demoSeqRef.current += 1;
    const demoSeq = demoSeqRef.current;
    const mode: OverlayMode =
      previewModeParam === 'queue' ? 'queue' : previewCount > 1 ? 'simultaneous' : 'queue';

    // Override config locally for preview.
    setConfig((p) => ({
      ...p,
      overlayMode: mode,
      overlayMaxConcurrent: clampInt(previewCount, 1, 5),
    }));

    // IMPORTANT:
    // Use demoSeq in IDs to guarantee uniqueness and avoid React reusing a DOM node
    // (which can look like "the old meme jumped position, then changed").
    const seed: QueuedActivation[] = Array.from({ length: previewCount }).map((_, idx) => ({
      id: `__demo_seed__${demoSeq}_${idx}`,
      memeId: '__demo__',
      ...getPreviewMediaAt(idx),
      durationMs: 8000,
      title: 'DEMO',
      senderDisplayName: 'Viewer123',
      startTime: Date.now(),
      ...(mode === 'simultaneous' ? pickRandomPosition(idx + 1) : { xPct: 50, yPct: 50 }),
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

    // Mark as exiting first (fade-out), then remove after the configured exit duration.
    setActive((prev) => prev.map((a) => (a.id === id ? { ...a, isExiting: true } : a)));
    const existingFade = fadeTimersRef.current.get(id);
    if (existingFade) clearTimeout(existingFade);
    const removeAfterMs = clampInt(Number(exitMs) || 0, 120, 1400);
    const fadeTimer = setTimeout(() => {
      fadeTimersRef.current.delete(id);
      setActive((prev) => prev.filter((a) => a.id !== id));

      // Demo repeat: enqueue a fresh item after it fully disappears.
      if (demo && previewRepeat) {
        setTimeout(() => {
          demoSeqRef.current += 1;
          const demoSeq = demoSeqRef.current;
          const next: QueuedActivation = {
            id: `__demo__${demoSeq}`,
            memeId: '__demo__',
            ...getPreviewMediaAt(Date.now()),
            durationMs: 8000,
            title: 'DEMO',
            senderDisplayName: 'Viewer123',
            startTime: Date.now(),
            ...(resolvedPosition === 'random' ? pickRandomPosition() : { xPct: 50, yPct: 50 }),
            userScale: getNextUserScale(),
          };

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
    }, removeAfterMs);
    fadeTimersRef.current.set(id, fadeTimer);
  }, [
    demo,
    emitAckDoneOnce,
    exitMs,
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
    const basePad = safePadPx > 0 ? safePadPx : resolvedPosition === 'random' ? 80 : 24;
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

        // If we know media aspect ratio, compute a normalized box size that preserves the ratio
        // and keeps a consistent "long side" across media (independent of source resolution).
        // IMPORTANT: border is implemented as padding on the outer wrapper; to avoid letterboxing
        // inside the card, we must ensure the INNER content box (after padding) matches aspect ratio.
        const ar = Number(a.aspectRatio);
        if (Number.isFinite(ar) && ar > 0.01) {
          const pad = clampInt(Number(border ?? 0), 0, 120);
          const targetLong = clampInt(Math.round(Math.min(vw * 0.32, vh * 0.48)), 220, 560);

          // Desired INNER content size (excluding border padding), preserving ratio.
          let innerW = ar >= 1 ? targetLong : targetLong * ar;
          let innerH = ar >= 1 ? targetLong / ar : targetLong;

          // Fit inner size so that (inner + 2*pad) fits in available area.
          const maxInnerW = Math.max(1, availW - 2 * pad);
          const maxInnerH = Math.max(1, availH - 2 * pad);
          const s = Math.min(1, maxInnerW / Math.max(1, innerW), maxInnerH / Math.max(1, innerH));
          innerW = Math.max(120, innerW * s);
          innerH = Math.max(120, innerH * s);

          // Outer box includes border padding.
          const w = Math.max(140, innerW + 2 * pad);
          const h = Math.max(140, innerH + 2 * pad);
          if (!Number.isFinite(a.boxW) || !Number.isFinite(a.boxH) || Math.abs((a.boxW ?? 0) - w) > 2 || Math.abs((a.boxH ?? 0) - h) > 2) {
            changed = true;
            a = { ...a, boxW: w, boxH: h };
          }
        }

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
        //
        // In demo preview, while the user is dragging layout sliders (size/safe area),
        // we lock positions to avoid "teleporting" during live tweaking.
        if (demo && lockPos) return a;

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
  }, [active, border, config.overlayShowSender, demo, lockPos, radius, resolvedPosition, safePadPx, safeScale, senderFontSize]);

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
    const timers = timersRef.current;
    const fadeTimers = fadeTimersRef.current;
    const ackSent = ackSentRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const timer of fadeTimers.values()) clearTimeout(timer);
      fadeTimers.clear();
      ackSent.clear();
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

      // Normalize perceived size across different source resolutions:
      // keep a consistent "long side" while preserving original aspect ratio.
      // `boxW/boxH` are computed after media metadata loads.
      const fallback = 420 + 2 * clampInt(Number(border ?? 0), 0, 120);
      const boxW = clampFloat(Number(item.boxW ?? fallback), 180, 900);
      const boxH = clampFloat(Number(item.boxH ?? fallback), 180, 900);
      const roundedW = Math.round(boxW);
      const roundedH = Math.round(boxH);
      const sizeClamp: React.CSSProperties = {
        width: `${roundedW}px`,
        height: `${roundedH}px`,
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
    [border, resolvedPosition, safeScale]
  );

  const borderWrapStyle = useMemo<React.CSSProperties>(() => {
    const w = border || 0;
    if (w <= 0) {
      return {
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        borderRadius: radius || 20,
        padding: 0,
        background: 'transparent',
      };
    }
    const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
      const h = hex.replace('#', '');
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return { r, g, b };
    };

    const bgCustom =
      borderMode === 'gradient'
        ? (() => {
            const c1 = hexToRgb(borderColor);
            const c2 = hexToRgb(borderColor2);
            // Multi-stop gradient + subtle highlight to feel more "Photoshop-like".
            return [
              `radial-gradient(140% 120% at 18% 12%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 55%)`,
              `linear-gradient(${borderGradientAngle}deg, rgba(${c1.r},${c1.g},${c1.b},1) 0%, rgba(${c1.r},${c1.g},${c1.b},0.92) 28%, rgba(${c2.r},${c2.g},${c2.b},0.92) 72%, rgba(${c2.r},${c2.g},${c2.b},1) 100%)`,
            ].join(', ');
          })()
        : borderColor;

    const tint = hexToRgb(borderTintColor);
    const tintA = Math.max(0, Math.min(1, borderTintStrength));

    const bgGlass = [
      `radial-gradient(140% 120% at 18% 12%, rgba(255,255,255,0.40) 0%, rgba(255,255,255,0) 55%)`,
      `linear-gradient(${borderGradientAngle}deg, rgba(${tint.r},${tint.g},${tint.b},${0.55 * tintA}) 0%, rgba(255,255,255,${0.22 + 0.25 * tintA}) 38%, rgba(0,0,0,${0.14 + 0.12 * tintA}) 100%)`,
    ].join(', ');

    const bgFrosted = [
      `radial-gradient(150% 140% at 18% 12%, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0) 55%)`,
      `linear-gradient(${borderGradientAngle}deg, rgba(${tint.r},${tint.g},${tint.b},${0.22 * tintA}) 0%, rgba(255,255,255,${0.10 + 0.10 * tintA}) 55%, rgba(0,0,0,${0.22}) 100%)`,
    ].join(', ');

    const bgGlow = [
      `radial-gradient(120% 120% at 18% 12%, rgba(${tint.r},${tint.g},${tint.b},${0.40 * tintA}) 0%, rgba(${tint.r},${tint.g},${tint.b},0) 60%)`,
      `linear-gradient(${borderGradientAngle}deg, rgba(${tint.r},${tint.g},${tint.b},${0.55 * tintA}) 0%, rgba(${tint.r},${tint.g},${tint.b},${0.20 * tintA}) 55%, rgba(0,0,0,0.25) 100%)`,
    ].join(', ');

    const bg =
      borderPreset === 'glass' ? bgGlass : borderPreset === 'frosted' ? bgFrosted : borderPreset === 'glow' ? bgGlow : bgCustom;

    return {
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      borderRadius: radius || 20,
      padding: w,
      background: borderPreset === 'custom' && borderMode !== 'gradient' ? bg : undefined,
      backgroundImage: borderPreset === 'custom' && borderMode !== 'gradient' ? undefined : bg,
      boxShadow:
        borderPreset === 'glass'
          ? 'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 0 rgba(0,0,0,0.25)'
          : borderPreset === 'glow'
            ? `0 10px 34px rgba(0,0,0,0.25), 0 0 32px rgba(${tint.r},${tint.g},${tint.b},${0.35 * tintA})`
            : borderPreset === 'frosted'
              ? 'inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.25), 0 10px 34px rgba(0,0,0,0.25)'
              : undefined,
    };
  }, [
    border,
    borderColor,
    borderColor2,
    borderGradientAngle,
    borderMode,
    borderPreset,
    borderTintColor,
    borderTintStrength,
    radius,
  ]);

  const frameAnimStyleFor = useCallback(
    (item: QueuedActivation): React.CSSProperties => {
      const enter = clampInt(Number(enterMs ?? 0), 0, 1400);
      const exit = clampInt(Number(exitMs ?? 0), 120, 1400);
      const base: React.CSSProperties = {
        opacity: item.isExiting ? 0 : 1,
        willChange: 'transform, opacity',
        transition: `opacity ${exit}ms ${easing}, transform ${exit}ms ${easing}`,
      };

      if (!item.isExiting) {
        if (anim === 'zoom') {
          base.animation = `memalertsZoomIn ${enter}ms ${easing}`;
        } else if (anim === 'slide-up') {
          base.animation = `memalertsSlideUp ${enter}ms ${easing}`;
        } else if (anim === 'pop') {
          base.animation = `memalertsPopIn ${enter}ms ${easing}`;
        } else if (anim === 'lift') {
          base.animation = `memalertsLiftIn ${enter}ms ${easing}`;
        } else if (anim === 'fade') {
          base.animation = `memalertsFadeIn ${enter}ms ${easing}`;
        }
      } else {
        if (anim === 'zoom') {
          base.transform = 'scale(0.96)';
        } else if (anim === 'slide-up') {
          base.transform = 'translateY(14px) scale(0.99)';
        } else if (anim === 'pop') {
          base.transform = 'scale(0.98)';
        } else if (anim === 'lift') {
          base.transform = 'translateY(10px) scale(0.99)';
        }
      }
      return base;
    },
    [anim, easing, enterMs, exitMs]
  );

  const cardStyle = useMemo<React.CSSProperties>(() => {
    const effectiveRadius = radius || 20;
    // Shadow direction (angle).
    const distance = Number.isFinite(shadowDistance) && shadowDistance > 0 ? shadowDistance : 22;
    const rad = (shadowAngle * Math.PI) / 180;
    const offX = Math.round(Math.cos(rad) * distance);
    const offY = Math.round(Math.sin(rad) * distance);
    const shadowR = parseInt(shadowColor.slice(1, 3), 16);
    const shadowG = parseInt(shadowColor.slice(3, 5), 16);
    const shadowB = parseInt(shadowColor.slice(5, 7), 16);
    const shadowRgba = `rgba(${shadowR},${shadowG},${shadowB},${shadowOpacity})`;
    return {
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      // Inner radius accounts for border padding wrapper.
      borderRadius: Math.max(0, effectiveRadius - (border || 0)),
      overflow: 'hidden',
      outline: '1px solid rgba(0,0,0,0.35)',
      boxShadow: `${offX}px ${offY}px ${shadowBlur}px ${shadowSpread}px ${shadowRgba}`,
      // Keep the plate neutral; "glass" is a separate foreground overlay.
      background: 'rgba(0,0,0,0.10)',
    };
  }, [
    border,
    radius,
    shadowAngle,
    shadowBlur,
    shadowColor,
    shadowDistance,
    shadowOpacity,
    shadowSpread,
  ]);

  const glassOverlayStyle = useMemo<React.CSSProperties>(() => {
    if (!glassEnabled) return { display: 'none' };

    // Interpret bgOpacity as "glass opacity" (surface tint strength).
    const glassOpacity = clampFloat(Number.isFinite(bgOpacity) ? bgOpacity : 0.18, 0, 0.65);
    const blurPx = clampInt(Number.isFinite(blur) ? blur : 0, 0, 40);
    const intensity = Math.max(0, Math.min(1, glassOpacity / 0.65));
    const tint = (() => {
      const h = glassTintColor.replace('#', '');
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return { r, g, b };
    })();
    const tintA = clampFloat(glassTintStrength, 0, 1);

    // "iPhone-like" glass: reflections/highlights rather than heavy blur.
    // Blur is optional (default to 0 in UI); avoid making memes unreadable.
    const preset = glassPreset;
    const sheen =
      preset === 'prism'
        ? [
            `linear-gradient(135deg, rgba(${tint.r},${tint.g},${tint.b},${0.18 * intensity * tintA}) 0%, rgba(167,139,250,${0.18 * intensity}) 45%, rgba(255,105,180,${0.12 * intensity}) 100%)`,
            `radial-gradient(120% 90% at 18% 10%, rgba(255,255,255,${0.35 * intensity}) 0%, rgba(255,255,255,0) 55%)`,
            `radial-gradient(90% 70% at 85% 92%, rgba(255,255,255,${0.12 * intensity}) 0%, rgba(255,255,255,0) 60%)`,
            `repeating-linear-gradient(115deg, rgba(255,255,255,${0.018 * intensity}) 0px, rgba(255,255,255,${0.018 * intensity}) 1px, rgba(255,255,255,0) 3px)`,
          ]
        : preset === 'clear'
          ? [
              `linear-gradient(135deg, rgba(255,255,255,${0.22 * intensity}) 0%, rgba(255,255,255,0) 55%)`,
              `radial-gradient(120% 90% at 18% 10%, rgba(255,255,255,${0.26 * intensity}) 0%, rgba(255,255,255,0) 55%)`,
              `repeating-linear-gradient(115deg, rgba(255,255,255,${0.012 * intensity}) 0px, rgba(255,255,255,${0.012 * intensity}) 1px, rgba(255,255,255,0) 4px)`,
            ]
          : [
              // default "ios"
              `linear-gradient(135deg, rgba(${tint.r},${tint.g},${tint.b},${0.14 * intensity * tintA}) 0%, rgba(255,255,255,0.02) 45%, rgba(0,0,0,${0.12 * intensity}) 100%)`,
              `radial-gradient(140% 120% at 18% 12%, rgba(255,255,255,${0.34 * intensity}) 0%, rgba(255,255,255,0) 55%)`,
              `linear-gradient(45deg, rgba(255,255,255,0) 35%, rgba(255,255,255,${0.10 * intensity}) 50%, rgba(255,255,255,0) 65%)`,
              `repeating-linear-gradient(115deg, rgba(255,255,255,${0.016 * intensity}) 0px, rgba(255,255,255,${0.016 * intensity}) 1px, rgba(255,255,255,0) 3px)`,
            ];

    if (blurPx <= 0 && glassOpacity <= 0) {
      return { display: 'none' };
    }
    return {
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      backdropFilter: blurPx > 0 ? `blur(${blurPx}px) saturate(1.15)` : 'saturate(1.12)',
      backgroundImage: sheen.join(', '),
      opacity: Math.max(0.05, intensity),
      boxShadow: `inset 0 1px 0 rgba(255,255,255,${0.35 * intensity}), inset 0 -1px 0 rgba(0,0,0,${0.18 * intensity})`,
    };
  }, [bgOpacity, blur, glassEnabled, glassPreset, glassTintColor, glassTintStrength]);

  const mediaStyle = useMemo<React.CSSProperties>(() => {
    return {
      // Avoid 1px “seams” caused by sub-pixel rounding when the card is scaled.
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      // We always use cover to avoid black bars.
      objectFit: 'cover',
      objectPosition: 'center',
      background: '#000',
      transform: 'translateZ(0)',
    };
  }, []);

  const badgeStyle = useMemo<React.CSSProperties>(() => {
    const family =
      senderFontFamily === 'jetbrains-mono'
        ? '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
        : senderFontFamily === 'playfair'
          ? '"Playfair Display", ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'
          : senderFontFamily === 'inter'
            ? '"Inter", system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
            : senderFontFamily === 'roboto'
              ? 'Roboto, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif'
              : senderFontFamily === 'montserrat'
                ? 'Montserrat, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
                : senderFontFamily === 'poppins'
                  ? 'Poppins, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
                  : senderFontFamily === 'oswald'
                    ? 'Oswald, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
                    : senderFontFamily === 'raleway'
                      ? 'Raleway, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
                      : senderFontFamily === 'nunito'
                        ? 'Nunito, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
                        : senderFontFamily === 'mono'
                          ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                          : senderFontFamily === 'serif'
                            ? 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'
                            : 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
    const bg = (() => {
      const h = senderBgColor.replace('#', '');
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = clampFloat(senderBgOpacity, 0, 1);
      return `rgba(${r},${g},${b},${a})`;
    })();

    const strokeRgba = (() => {
      const h = senderStrokeColor.replace('#', '');
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${clampFloat(senderStrokeOpacity, 0, 1)})`;
    })();

    const strokeShadow =
      senderStrokeWidth <= 0 || senderStroke === 'none'
        ? undefined
        : senderStroke === 'solid'
          ? `inset 0 0 0 ${senderStrokeWidth}px ${strokeRgba}`
          : [
              `inset 0 0 0 ${senderStrokeWidth}px rgba(255,255,255,${Math.min(0.40, senderStrokeOpacity + 0.12)})`,
              `inset 0 1px 0 rgba(255,255,255,${Math.min(0.45, senderStrokeOpacity + 0.18)})`,
              `inset 0 -1px 0 rgba(0,0,0,${Math.min(0.30, senderStrokeOpacity + 0.08)})`,
            ].join(', ');
    return {
      position: 'absolute',
      left: '50%',
      bottom: 10,
      transform: 'translateX(-50%)',
      padding: '8px 12px',
      fontSize: senderFontSize,
      fontWeight: senderFontWeight,
      fontFamily: family,
      lineHeight: 1.2,
      color: senderFontColor,
      background: bg,
      boxShadow: strokeShadow,
      borderRadius: senderBgRadius,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: 'calc(100% - 20px)',
    };
  }, [
    senderBgColor,
    senderBgOpacity,
    senderBgRadius,
    senderFontColor,
    senderFontFamily,
    senderFontSize,
    senderFontWeight,
    senderStroke,
    senderStrokeColor,
    senderStrokeOpacity,
    senderStrokeWidth,
  ]);

  const renderItems = active;
  const eventAccent = activeEvent?.theme?.accentColor || '#fbbf24';
  const eventBadge = typeof activeEvent?.theme?.badgeKey === 'string' && activeEvent?.theme?.badgeKey
    ? activeEvent.theme.badgeKey.toUpperCase()
    : 'EVENT';
  const eventRadius = Math.max(0, (radius || 20) - (border || 0) - 2);

  const badgeAnimStyle = useMemo<React.CSSProperties>(() => {
    const inMs = 220;
    const outMs = 220;
    const hold = clampInt(Number(senderHoldMs || 0), 0, 12000);
    if (hold <= 0) {
      return { animation: `memalertsLabelIn ${inMs}ms cubic-bezier(0.22, 1, 0.36, 1) both` };
    }
    const outDelay = inMs + hold;
    return {
      animation: [
        `memalertsLabelIn ${inMs}ms cubic-bezier(0.22, 1, 0.36, 1) 0ms both`,
        `memalertsLabelOut ${outMs}ms cubic-bezier(0.22, 1, 0.36, 1) ${outDelay}ms forwards`,
      ].join(', '),
    };
  }, [senderHoldMs]);

  const hasAuxOverlay = showVote || !!lastSpin;

  if (renderItems.length === 0 && !hasAuxOverlay) {
    // In demo mode, still render a background so preview isn't a blank white canvas.
    if (!demo) return null;
    return (
      <>
        <style>{demoBgCss}</style>
        <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none' }} />
      </>
    );
  }

  // In demo mode we want the sender label visible by default for styling feedback.
  // In real overlay mode, it must be controlled by the server setting.
  const showSender = demo
    ? String(getParam('showSender') || getParam('overlayShowSender') || '1') !== '0'
    : Boolean(config.overlayShowSender);

  return (
    <>
      <style>
        {`
          ${demo ? demoBgCss : ''}
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
          @keyframes memalertsPopIn {
            from { opacity: 0; transform: scale(0.975); }
            to { opacity: 1; transform: scale(1); }
          }
          @keyframes memalertsLiftIn {
            from { opacity: 0; transform: translateY(18px) scale(0.995); }
            to { opacity: 1; transform: translateY(0px) scale(1); }
          }
          @keyframes memalertsLabelIn {
            from { opacity: 0; transform: translate(-50%, 130%); }
            to { opacity: 1; transform: translate(-50%, 0%); }
          }
          @keyframes memalertsLabelOut {
            from { opacity: 1; transform: translate(-50%, 0%); }
            to { opacity: 0; transform: translate(-50%, 130%); }
          }
        `}
      </style>
      {activeEvent && eventBurstKey > 0 ? (
        <EventConfetti accent={eventAccent} burstKey={eventBurstKey} />
      ) : null}
      <VoteOverlay session={voteSession} visible={showVote} />
      <WheelSpinOverlay spin={lastSpin} />
      {demo && showSafeGuide && safePadPx > 0 && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: safePadPx,
              left: safePadPx,
              right: safePadPx,
              bottom: safePadPx,
              border: '1px dashed rgba(255,255,255,0.32)',
              borderRadius: 16,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.28) inset, 0 0 0 1px rgba(255,255,255,0.06)',
              background: 'rgba(0,0,0,0.035)',
            }}
          />
        </div>
      )}
      {renderItems.map((item) => (
        <div
          key={item.id}
          style={getPositionStyles(item)}
          ref={(el) => {
            itemRefs.current.set(item.id, el);
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%', height: '100%' }}>
            <div style={{ ...borderWrapStyle, ...frameAnimStyleFor(item) }}>
              <div
                style={{
                  ...cardStyle,
                }}
              >
                {/* Stage: keep everything inside the card so it fades as one and never clips */}
                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                  {(item.type === 'image' || item.type === 'gif') && (
                    <img
                      src={getMediaUrl(item.fileUrl, item.playFileUrl)}
                      alt={item.title}
                      style={mediaStyle}
                      onLoad={() => {
                        try {
                          const img = itemRefs.current.get(item.id)?.querySelector('img') as HTMLImageElement | null;
                          const w = img?.naturalWidth || 0;
                          const h = img?.naturalHeight || 0;
                          if (w > 0 && h > 0) {
                            const ar = w / h;
                            setActive((prev) =>
                              prev.map((a) =>
                                a.id === item.id ? { ...a, aspectRatio: ar, layoutTick: (a.layoutTick ?? 0) + 1 } : a
                              )
                            );
                          } else {
                            setActive((prev) =>
                              prev.map((a) => (a.id === item.id ? { ...a, layoutTick: (a.layoutTick ?? 0) + 1 } : a))
                            );
                          }
                        } catch {
                          // Trigger clamp recalculation after media loads (size becomes known).
                          setActive((prev) =>
                            prev.map((a) => (a.id === item.id ? { ...a, layoutTick: (a.layoutTick ?? 0) + 1 } : a))
                          );
                        }
                      }}
                    />
                  )}

                  {(item.type === 'video' || item.type === 'webm') && (
                    <video
                      src={getMediaUrl(item.fileUrl, item.playFileUrl)}
                      autoPlay
                      playsInline
                      muted={effectiveMuted}
                      style={mediaStyle}
                      onLoadedData={(e) => {
                        e.currentTarget.volume = Math.min(1, Math.max(0, volume));
                        // Some embedded browsers/iframes need an explicit play() after setting volume.
                        // In demo preview we keep muted anyway, so this is safe.
                        void e.currentTarget.play?.().catch?.(() => {});
                      }}
                      onLoadedMetadata={(e) => {
                        const dur = e.currentTarget.duration;
                        if (Number.isFinite(dur) && dur > 0) {
                          const ms = Math.round(dur * 1000);
                          setActive((prev) => prev.map((a) => (a.id === item.id ? { ...a, effectiveDurationMs: ms } : a)));
                          updateFallbackTimer(item.id, ms);
                        }
                        const w = e.currentTarget.videoWidth;
                        const h = e.currentTarget.videoHeight;
                        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
                          const ar = w / h;
                          setActive((prev) =>
                            prev.map((a) =>
                              a.id === item.id ? { ...a, aspectRatio: ar, layoutTick: (a.layoutTick ?? 0) + 1 } : a
                            )
                          );
                        } else {
                          // Trigger clamp recalculation (video intrinsic size becomes known).
                          setActive((prev) =>
                            prev.map((a) => (a.id === item.id ? { ...a, layoutTick: (a.layoutTick ?? 0) + 1 } : a))
                          );
                        }
                      }}
                      onError={() => doneActivation(item.id)}
                      onStalled={() => doneActivation(item.id)}
                      onEnded={() => doneActivation(item.id)}
                    />
                  )}

                  {item.type === 'audio' && (
                    <audio
                      src={getMediaUrl(item.fileUrl, item.playFileUrl)}
                      autoPlay
                      muted={effectiveMuted}
                      onLoadedData={(e) => {
                        e.currentTarget.volume = Math.min(1, Math.max(0, volume));
                        void e.currentTarget.play?.().catch?.(() => {});
                      }}
                      onLoadedMetadata={(e) => {
                        const dur = (e.currentTarget as HTMLAudioElement).duration;
                        if (Number.isFinite(dur) && dur > 0) {
                          const ms = Math.round(dur * 1000);
                          setActive((prev) => prev.map((a) => (a.id === item.id ? { ...a, effectiveDurationMs: ms } : a)));
                          updateFallbackTimer(item.id, ms);
                        }
                        // Trigger clamp recalculation (audio tag layout can change once metadata loads).
                        setActive((prev) =>
                          prev.map((a) => (a.id === item.id ? { ...a, layoutTick: (a.layoutTick ?? 0) + 1 } : a))
                        );
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

                  {activeEvent ? (
                    <>
                      <div
                        style={{
                          position: 'absolute',
                          inset: 6,
                          borderRadius: eventRadius,
                          border: `1px solid ${eventAccent}99`,
                          boxShadow: `0 0 14px ${eventAccent}55, inset 0 0 12px ${eventAccent}33`,
                          pointerEvents: 'none',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          top: 10,
                          right: 10,
                          padding: '4px 10px',
                          borderRadius: 999,
                          background: eventAccent,
                          color: '#0f172a',
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: 0.8,
                          boxShadow: '0 6px 14px rgba(0,0,0,0.35)',
                          pointerEvents: 'none',
                        }}
                      >
                        {eventBadge}
                      </div>
                    </>
                  ) : null}

                  <div style={glassOverlayStyle} />
                  {showSender && item.senderDisplayName ? (
                    <div style={{ ...badgeStyle, ...badgeAnimStyle }} title={String(item.senderDisplayName)}>
                      {item.senderDisplayName}
                    </div>
                  ) : null}
                </div>

              </div>
            </div>

          </div>
        </div>
      ))}
    </>
  );
}
