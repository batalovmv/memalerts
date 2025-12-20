import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';

interface Activation {
  id: string;
  memeId: string;
  type: string;
  fileUrl: string;
  durationMs: number;
  title: string;
}

interface QueuedActivation extends Activation {
  startTime: number;
}

export default function OverlayView() {
  const { channelSlug } = useParams<{ channelSlug: string }>();
  const [searchParams] = useSearchParams();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [queue, setQueue] = useState<QueuedActivation[]>([]);
  const [current, setCurrent] = useState<QueuedActivation | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const scale = parseFloat(searchParams.get('scale') || '1');
  const position = searchParams.get('position') || 'center';
  const volume = parseFloat(searchParams.get('volume') || '1');

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
    if (!channelSlug) return;

    const envUrl = import.meta.env.VITE_API_URL;
    // In production/beta deployments, always use same-origin to avoid cross-environment calls.
    // In local dev, allow VITE_API_URL override or fallback to localhost.
    const apiUrl = import.meta.env.PROD ? window.location.origin : (envUrl || 'http://localhost:3001');
    const newSocket = io(apiUrl, {
      transports: ['websocket'],
    });

    newSocket.on('connect', () => {
      console.log('Connected to server');
      newSocket.emit('join:channel', channelSlug);
    });

    newSocket.on('activation:new', (activation: Activation) => {
      console.log('New activation:', activation);
      setQueue((prev) => [
        ...prev,
        {
          ...activation,
          startTime: Date.now(),
        },
      ]);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [channelSlug]);

  useEffect(() => {
    if (current && timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (current) {
      timeoutRef.current = setTimeout(() => {
        // Send ack
        if (socket) {
          socket.emit('activation:ackDone', { activationId: current.id });
        }
        setCurrent(null);
      }, current.durationMs);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [current, socket]);

  useEffect(() => {
    if (!current && queue.length > 0) {
      const next = queue[0];
      setQueue((prev) => prev.slice(1));
      setCurrent(next);
    }
  }, [current, queue]);

  useEffect(() => {
    if (current && current.type === 'audio' && audioRef.current) {
      audioRef.current.play().catch(console.error);
    }
  }, [current]);

  if (!current) {
    return null;
  }

  const getPositionStyles = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'fixed',
      zIndex: 9999,
      maxWidth: '90vw',
      maxHeight: '90vh',
    };

    switch (position) {
      case 'center':
        return {
          ...base,
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) scale(${scale})`,
        };
      case 'top':
        return {
          ...base,
          top: '20px',
          left: '50%',
          transform: `translateX(-50%) scale(${scale})`,
        };
      case 'bottom':
        return {
          ...base,
          bottom: '20px',
          left: '50%',
          transform: `translateX(-50%) scale(${scale})`,
        };
      case 'top-left':
        return {
          ...base,
          top: '20px',
          left: '20px',
          transform: `scale(${scale})`,
        };
      case 'top-right':
        return {
          ...base,
          top: '20px',
          right: '20px',
          transform: `scale(${scale})`,
        };
      case 'bottom-left':
        return {
          ...base,
          bottom: '20px',
          left: '20px',
          transform: `scale(${scale})`,
        };
      case 'bottom-right':
        return {
          ...base,
          bottom: '20px',
          right: '20px',
          transform: `scale(${scale})`,
        };
      default:
        return {
          ...base,
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) scale(${scale})`,
        };
    }
  };

  const containerStyle = getPositionStyles();

  return (
    <div style={containerStyle}>
      {current.type === 'image' && (
        <img
          src={getMediaUrl(current.fileUrl)}
          alt={current.title}
          style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}
        />
      )}
      {current.type === 'gif' && (
        <img
          src={getMediaUrl(current.fileUrl)}
          alt={current.title}
          style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}
        />
      )}
      {current.type === 'video' && (
        <video
          src={getMediaUrl(current.fileUrl)}
          autoPlay
          muted={false}
          style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}
          onLoadedData={(e) => {
            e.currentTarget.volume = volume;
          }}
        />
      )}
      {current.type === 'audio' && (
        <audio
          ref={audioRef}
          src={getMediaUrl(current.fileUrl)}
          autoPlay
          onLoadedData={(e) => {
            e.currentTarget.volume = volume;
          }}
        />
      )}
    </div>
  );
}

