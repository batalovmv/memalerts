import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';

import { clampInt } from './lib/math';
import { useCreditsParams } from './model/useCreditsParams';
import { getSocketBaseUrl } from './urls';
import { ensureGoogleFontLoaded, GOOGLE_FONTS_CURATED } from './lib/fonts';

type CreditsConfig = {
  creditsStyleJson?: string | null;
};

type CreditsState = {
  chatters?: Array<{ name: string }>;
  donors?: Array<{ name: string; amount?: number; currency?: string }>;
};

function hexToRgb(hex: string): [number, number, number] {
  const raw = String(hex || '').trim().replace(/^#/, '');
  const v = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-f]{6}$/i.test(v)) return [0, 0, 0];
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function isProbablyOBSUserAgent(): boolean {
  const ua = (navigator.userAgent || '').toLowerCase();
  return ua.includes('obs') || ua.includes('cef') || ua.includes('streamlabs') || ua.includes('xsplit');
}

function cssFontFamily(v: string): string {
  const key = String(v || '').trim().toLowerCase();
  if (!key || key === 'system') return 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  if (key === 'inter') return 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  if (key === 'roboto') return 'Roboto, system-ui, -apple-system, Segoe UI, Arial, sans-serif';
  if (key === 'montserrat') return 'Montserrat, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  if (key === 'poppins') return 'Poppins, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  if (key === 'oswald') return 'Oswald, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  if (key === 'raleway') return 'Raleway, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  if (key === 'nunito') return 'Nunito, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  return v;
}

export default function CreditsOverlayView() {
  const { channelSlug, token } = useParams<{ channelSlug?: string; token?: string }>();
  const [searchParams] = useSearchParams();
  const socketRef = useRef<Socket | null>(null);
  const demoSeqRef = useRef(0);

  const [liveParams, setLiveParams] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<CreditsConfig>({ creditsStyleJson: null });
  const [state, setState] = useState<CreditsState>({ chatters: [], donors: [] });

  // Receive params from Admin settings preview iframe.
  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
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

  // Handshake: notify parent that we are ready (settings preview).
  useEffect(() => {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'memalerts:overlayReady' }, window.location.origin);
      }
    } catch {
      // ignore
    }
  }, []);

  const { demo, demoBgCss, resolved } = useCreditsParams({
    searchParams,
    liveParams,
    creditsStyleJson: config.creditsStyleJson,
    demoSeqRef,
  });

  // Google Fonts (curated) loader. We keep it simple: if fontFamily matches a curated family,
  // we load up to 3 weights (safety) including the chosen weight.
  useEffect(() => {
    const famRaw = String(resolved.fontFamily || '').trim();
    if (!famRaw) return;
    const hit = GOOGLE_FONTS_CURATED.find((f) => f.family.toLowerCase() === famRaw.toLowerCase() || f.label.toLowerCase() === famRaw.toLowerCase());
    if (!hit) return;
    const weights = Array.from(new Set([resolved.fontWeight, ...(hit.weights || [])])).slice(0, 4);
    ensureGoogleFontLoaded({ family: hit.family, weights });
  }, [resolved.fontFamily, resolved.fontWeight]);

  // Connect to socket and listen for credits events.
  useEffect(() => {
    const overlayToken = String(token || '').trim();
    const slug = String(channelSlug || '').trim();
    if (!overlayToken && !slug) return;
    if (demo) return;

    const socketBase = getSocketBaseUrl();
    const newSocket = io(socketBase, {
      transports: ['websocket'],
    });

    newSocket.on('connect', () => {
      if (overlayToken) newSocket.emit('join:overlay', { token: overlayToken });
      else if (slug) newSocket.emit('join:channel', slug);
    });

    newSocket.on('credits:config', (incoming: Partial<CreditsConfig> | null | undefined) => {
      setConfig({ creditsStyleJson: incoming?.creditsStyleJson ?? null });
    });

    newSocket.on('credits:state', (incoming: CreditsState | null | undefined) => {
      const chatters = Array.isArray(incoming?.chatters) ? incoming?.chatters : [];
      const donors = Array.isArray(incoming?.donors) ? incoming?.donors : [];
      setState({ chatters, donors });
    });

    socketRef.current = newSocket;
    return () => {
      socketRef.current = null;
      newSocket.disconnect();
    };
  }, [channelSlug, demo, token]);

  // Demo seed (for preview without backend)
  useEffect(() => {
    if (!demo) return;
    demoSeqRef.current += 1;
    const nChat = clampInt(parseInt(String(searchParams.get('demoChatters') || '24'), 10), 0, 200);
    const nDon = clampInt(parseInt(String(searchParams.get('demoDonors') || '12'), 10), 0, 200);
    const chatters = Array.from({ length: nChat }).map((_, i) => ({ name: `Viewer_${i + 1}` }));
    const donors = Array.from({ length: nDon }).map((_, i) => ({ name: `Donor_${i + 1}`, amount: (i + 1) * 50, currency: 'RUB' }));
    setState({ chatters, donors });
  }, [demo, searchParams]);

  const isProbablyOBS = useMemo(() => isProbablyOBSUserAgent(), []);

  const sections = useMemo(() => {
    const order = resolved.sectionsOrder;
    const result: Array<{ key: string; title: string; lines: string[] }> = [];

    for (const k of order) {
      if (k === 'donors' && resolved.showDonors) {
        const lines = (state.donors || []).map((d) => {
          const name = String(d.name || '').trim();
          const amount = typeof d.amount === 'number' && Number.isFinite(d.amount) ? d.amount : null;
          const cur = String(d.currency || '').trim();
          if (amount !== null) return cur ? `${name} — ${amount} ${cur}` : `${name} — ${amount}`;
          return name;
        });
        if (lines.length) result.push({ key: 'donors', title: 'Donations', lines });
      }

      if (k === 'chatters' && resolved.showChatters) {
        const lines = (state.chatters || []).map((c) => String(c.name || '').trim()).filter(Boolean);
        if (lines.length) result.push({ key: 'chatters', title: 'Chat', lines });
      }
    }

    return result;
  }, [resolved.sectionsOrder, resolved.showChatters, resolved.showDonors, state.chatters, state.donors]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollDurationSec, setScrollDurationSec] = useState<number>(30);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const recalc = () => {
      const h = el.scrollHeight || 0;
      // Keep it stable in OBS even if content is short.
      const minH = Math.max(h, (window.innerHeight || 720) * 1.2);
      const sec = Math.max(8, minH / Math.max(8, resolved.scrollSpeed));
      setScrollDurationSec(sec);
    };

    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(el);
    window.addEventListener('resize', recalc);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recalc);
    };
  }, [resolved.scrollSpeed, sections.length]);

  const wrapperStyle = useMemo((): React.CSSProperties => {
    return {
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: resolved.anchorY === 'top' ? 'flex-start' : resolved.anchorY === 'bottom' ? 'flex-end' : 'center',
      justifyContent: resolved.anchorX === 'left' ? 'flex-start' : resolved.anchorX === 'right' ? 'flex-end' : 'center',
      color: resolved.fontColor,
      fontFamily: cssFontFamily(resolved.fontFamily),
      fontSize: resolved.fontSize,
      fontWeight: resolved.fontWeight,
      lineHeight: resolved.lineHeight,
      letterSpacing: resolved.letterSpacing ? `${resolved.letterSpacing}px` : undefined,
      opacity: 1,
      transition: `opacity ${resolved.fadeInMs}ms ease`,
      // Avoid harsh subpixel jitter in OBS
      transform: isProbablyOBS ? 'translateZ(0)' : undefined,
    };
  }, [
    isProbablyOBS,
    resolved.anchorX,
    resolved.anchorY,
    resolved.fadeInMs,
    resolved.fontColor,
    resolved.fontFamily,
    resolved.fontSize,
    resolved.fontWeight,
    resolved.letterSpacing,
    resolved.lineHeight,
  ]);

  const cardStyle = useMemo((): React.CSSProperties => {
    const background =
      resolved.backgroundMode === 'transparent'
        ? 'transparent'
        : resolved.backgroundMode === 'full'
          ? `rgba(${hexToRgb(resolved.bgColor).join(',')}, ${resolved.bgOpacity})`
          : `rgba(${hexToRgb(resolved.bgColor).join(',')}, ${resolved.bgOpacity})`;
    return {
      marginLeft: resolved.bgInsetLeft,
      marginRight: resolved.bgInsetRight,
      marginTop: resolved.bgInsetTop,
      marginBottom: resolved.bgInsetBottom,
      width: `min(${resolved.maxWidthPx}px, 92vw)`,
      maxHeight: `${resolved.maxHeightVh}vh`,
      overflow: 'hidden',
      borderRadius: resolved.radius,
      background: resolved.backgroundMode === 'transparent' ? 'transparent' : background,
      backdropFilter: resolved.blur > 0 ? `blur(${resolved.blur}px)` : undefined,
      WebkitBackdropFilter: resolved.blur > 0 ? `blur(${resolved.blur}px)` : undefined,
      border: resolved.borderEnabled ? `${resolved.borderWidth}px solid ${resolved.borderColor}` : undefined,
    };
  }, [
    resolved.bgColor,
    resolved.backgroundMode,
    resolved.bgOpacity,
    resolved.bgInsetBottom,
    resolved.bgInsetLeft,
    resolved.bgInsetRight,
    resolved.bgInsetTop,
    resolved.blur,
    resolved.borderColor,
    resolved.borderEnabled,
    resolved.borderWidth,
    resolved.maxHeightVh,
    resolved.maxWidthPx,
    resolved.radius,
  ]);

  const listStyle = useMemo((): React.CSSProperties => {
    return {
      padding: `${resolved.contentPadTop}px ${resolved.contentPadRight}px ${resolved.contentPadBottom}px ${resolved.contentPadLeft}px`,
      display: 'grid',
      gap: resolved.sectionGapPx,
      animation: `memalertsCreditsScroll ${scrollDurationSec}s linear ${resolved.loop ? 'infinite' : '1'}`,
      animationDelay: resolved.startDelayMs > 0 ? `${resolved.startDelayMs}ms` : undefined,
      willChange: 'transform',
      textAlign: resolved.textAlign,
    };
  }, [
    resolved.contentPadBottom,
    resolved.contentPadLeft,
    resolved.contentPadRight,
    resolved.contentPadTop,
    resolved.loop,
    resolved.sectionGapPx,
    resolved.startDelayMs,
    resolved.textAlign,
    scrollDurationSec,
  ]);

  const fadeOutStyle = useMemo((): React.CSSProperties => {
    if (resolved.loop) return {};
    if (resolved.endFadeMs <= 0) return {};
    const totalMs = Math.max(0, Math.round(scrollDurationSec * 1000));
    const delayMs = Math.max(0, totalMs - resolved.endFadeMs + resolved.startDelayMs);
    return {
      animation: `memalertsCreditsFadeOut ${resolved.endFadeMs}ms ease forwards`,
      animationDelay: `${delayMs}ms`,
    };
  }, [resolved.endFadeMs, resolved.loop, resolved.startDelayMs, scrollDurationSec]);

  const baseTextEffectsStyle = useMemo((): React.CSSProperties => {
    const shadow =
      resolved.textShadowBlur > 0 && resolved.textShadowOpacity > 0
        ? `0 2px ${resolved.textShadowBlur}px rgba(${hexToRgb(resolved.textShadowColor).join(',')}, ${resolved.textShadowOpacity})`
        : undefined;
    const strokeColor =
      resolved.textStrokeWidth > 0 && resolved.textStrokeOpacity > 0
        ? `rgba(${hexToRgb(resolved.textStrokeColor).join(',')}, ${resolved.textStrokeOpacity})`
        : undefined;

    return {
      textShadow: shadow,
      WebkitTextStrokeWidth: resolved.textStrokeWidth > 0 ? `${resolved.textStrokeWidth}px` : undefined,
      WebkitTextStrokeColor: strokeColor,
    };
  }, [
    resolved.textShadowBlur,
    resolved.textShadowColor,
    resolved.textShadowOpacity,
    resolved.textStrokeColor,
    resolved.textStrokeOpacity,
    resolved.textStrokeWidth,
  ]);

  const lineStyle = useMemo((): React.CSSProperties => {
    return { lineHeight: resolved.lineHeight, marginTop: resolved.lineGapPx, ...baseTextEffectsStyle };
  }, [baseTextEffectsStyle, resolved.lineGapPx, resolved.lineHeight]);

  const listBlockStyle = useMemo((): React.CSSProperties => {
    return { paddingLeft: resolved.indentPx > 0 ? resolved.indentPx : undefined };
  }, [resolved.indentPx]);

  const titleStyle = useMemo((): React.CSSProperties => {
    const transform =
      resolved.titleTransform === 'uppercase'
        ? 'uppercase'
        : resolved.titleTransform === 'lowercase'
          ? 'lowercase'
          : 'none';
    const shadow =
      resolved.titleShadowBlur > 0 && resolved.titleShadowOpacity > 0
        ? `0 2px ${resolved.titleShadowBlur}px rgba(${hexToRgb(resolved.titleShadowColor).join(',')}, ${resolved.titleShadowOpacity})`
        : undefined;
    const strokeColor =
      resolved.titleStrokeWidth > 0 && resolved.titleStrokeOpacity > 0
        ? `rgba(${hexToRgb(resolved.titleStrokeColor).join(',')}, ${resolved.titleStrokeOpacity})`
        : undefined;
    return {
      display: resolved.titleEnabled ? 'block' : 'none',
      fontSize: resolved.titleSize,
      fontWeight: resolved.titleWeight,
      color: resolved.titleColor,
      opacity: 0.92,
      letterSpacing: '0.02em',
      textTransform: transform as any,
      textShadow: shadow,
      WebkitTextStrokeWidth: resolved.titleStrokeWidth > 0 ? `${resolved.titleStrokeWidth}px` : undefined,
      WebkitTextStrokeColor: strokeColor,
    };
  }, [
    resolved.titleColor,
    resolved.titleEnabled,
    resolved.titleShadowBlur,
    resolved.titleShadowColor,
    resolved.titleShadowOpacity,
    resolved.titleSize,
    resolved.titleStrokeColor,
    resolved.titleStrokeOpacity,
    resolved.titleStrokeWidth,
    resolved.titleTransform,
    resolved.titleWeight,
  ]);

  const rootCss = useMemo(() => {
    return `
      ${demo ? demoBgCss : ''}
      body { margin: 0; overflow: hidden; background: transparent; }
      @keyframes memalertsCreditsScroll {
        0%   { transform: translateY(${resolved.scrollDirection === 'down' ? '-100%' : '50%'}); }
        100% { transform: translateY(${resolved.scrollDirection === 'down' ? '50%' : '-100%'}); }
      }
      @keyframes memalertsCreditsFadeOut {
        0% { opacity: 1; }
        100% { opacity: 0; }
      }
    `;
  }, [demo, demoBgCss, resolved.scrollDirection]);

  // If there is no data yet, keep overlay empty (transparent) to avoid blocking scene.
  const hasAny = sections.some((s) => s.lines.length > 0);
  if (!hasAny) return <style>{rootCss}</style>;

  return (
    <>
      <style>{rootCss}</style>
      <div style={wrapperStyle}>
        <div style={{ ...cardStyle, ...fadeOutStyle }}>
          <div ref={listRef} style={listStyle}>
            {sections.map((s) => (
              <div key={s.key}>
                <div style={titleStyle}>{s.title}</div>
                <div style={listBlockStyle}>
                  {s.lines.map((line, idx) => (
                    <div key={`${s.key}_${idx}`} style={idx === 0 ? undefined : lineStyle}>
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {/* Duplicate content for smoother infinite scroll when short */}
            {sections.map((s) => (
              <div key={`${s.key}__dup`}>
                <div style={titleStyle}>{s.title}</div>
                <div style={listBlockStyle}>
                  {s.lines.map((line, idx) => (
                    <div key={`${s.key}__dup_${idx}`} style={idx === 0 ? undefined : lineStyle}>
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}


