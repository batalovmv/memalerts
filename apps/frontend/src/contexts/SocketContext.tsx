import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';

import { getRuntimeConfig } from '../lib/runtimeConfig';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { updateWalletBalance } from '../store/slices/authSlice';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
});

// eslint-disable-next-line react-refresh/only-export-components
export const useSocket = () => useContext(SocketContext);

interface SocketProviderProps {
  children: ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps) {
  const { user } = useAppSelector((state) => state.auth);
  const userId = user?.id;
  const dispatch = useAppDispatch();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const attemptedPollingFallbackRef = useRef(false);

  const parseBool = (v: unknown): boolean | null => {
    if (v === true) return true;
    if (v === false) return false;
    const s = String(v ?? '').trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
    if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
    return null;
  };

  // Get API URL for Socket.IO
  const getSocketUrl = () => {
    const runtime = getRuntimeConfig();
    if (runtime?.socketUrl !== undefined) {
      if (runtime.socketUrl === '') return window.location.origin;
      return runtime.socketUrl;
    }

    const envUrl = import.meta.env.VITE_API_URL;
    
    // If VITE_API_URL is explicitly set (even if empty string), use it
    // Empty string means use relative URLs (same origin)
    if (envUrl !== undefined) {
      if (envUrl === '') {
        // Empty string means use relative URLs - use current origin
        const origin = window.location.origin;
        return origin;
      }
      return envUrl;
    }
    
    // If VITE_API_URL is not set at all, determine based on environment
    if (import.meta.env.PROD) {
      const origin = window.location.origin;
      return origin;
    }
    
    return 'http://localhost:3001';
  };

  const getSocketTransports = (): Array<'websocket' | 'polling'> => {
    const runtime = getRuntimeConfig();
    if (runtime?.socketTransports && Array.isArray(runtime.socketTransports) && runtime.socketTransports.length > 0) {
      // Only allow known transports.
      const cleaned = runtime.socketTransports.filter((t) => t === 'websocket' || t === 'polling');
      if (cleaned.length > 0) return cleaned as Array<'websocket' | 'polling'>;
    }

    // Env override: VITE_SOCKET_TRANSPORTS="websocket" or "websocket,polling"
    const envTransportsRaw = import.meta.env.VITE_SOCKET_TRANSPORTS as string | undefined;
    if (typeof envTransportsRaw === 'string' && envTransportsRaw.trim()) {
      const parts = envTransportsRaw
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
      const cleaned = parts.filter((t) => t === 'websocket' || t === 'polling') as Array<'websocket' | 'polling'>;
      if (cleaned.length > 0) return cleaned;
    }

    // Default: prefer websocket-only in production (avoid polling load).
    return import.meta.env.PROD ? (['websocket'] as const) : (['websocket', 'polling'] as const);
  };

  const getAllowPollingFallback = (): boolean => {
    const runtime = getRuntimeConfig();
    if (runtime?.socketAllowPollingFallback !== undefined) return !!runtime.socketAllowPollingFallback;

    const env = import.meta.env.VITE_SOCKET_ALLOW_POLLING_FALLBACK;
    const parsed = parseBool(env);
    if (parsed !== null) return parsed;

    // Default: dev=true, prod=false (surface misconfigured proxies instead of silently increasing load).
    return !import.meta.env.PROD;
  };

  useEffect(() => {
    // Don't create socket if user is not loaded yet (user === null means still loading)
    // Only create socket when user is explicitly undefined (logged out) or when user exists
    if (user === null) {
      // User is still loading, don't create socket yet
      return;
    }

    if (!user) {
      // User is logged out - disconnect socket
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    // Only create socket if it doesn't exist
    if (!socketRef.current) {
      const socketUrl = getSocketUrl();
      const transports = getSocketTransports();
      const allowPollingFallback = getAllowPollingFallback();
      attemptedPollingFallbackRef.current = false;

      const initSocket = (nextTransports: Array<'websocket' | 'polling'>, forceNew: boolean) => {
        const s = io(socketUrl, {
          transports: nextTransports,
          withCredentials: true,
          reconnection: true,
          reconnectionDelay: 2000, // Start with 2 seconds
          reconnectionDelayMax: 10000, // Max 10 seconds between attempts
          reconnectionAttempts: 3, // Only 3 attempts to prevent infinite loops
          timeout: 10000, // 10 seconds timeout (reduced from 20)
          forceNew,
        });

        socketRef.current = s;

        s.on('connect', () => {
          setIsConnected(true);
          // Join user room for wallet updates
          if (user) {
            s.emit('join:user', user.id);
          }
        });

        s.on('disconnect', () => {
          setIsConnected(false);
        });

        s.on('connect_error', () => {
          setIsConnected(false);

          // If we forced websocket-only and it fails, optionally re-init once with polling enabled.
          if (
            allowPollingFallback &&
            !attemptedPollingFallbackRef.current &&
            nextTransports.length === 1 &&
            nextTransports[0] === 'websocket'
          ) {
            attemptedPollingFallbackRef.current = true;
            try {
              s.disconnect();
            } catch {
              // ignore
            }
            initSocket(['websocket', 'polling'], true);
          }
        });

        s.on('reconnect_attempt', () => {
        });

        s.on('reconnect_failed', () => {
          // After failed reconnection, don't try again automatically
          // User will need to refresh page or reconnect manually
        });

        return s;
      };
      
      // Prevent multiple initialization attempts
      initSocket(transports, false);
    } else {
      // Socket already exists, just update rooms if needed
      const socket = socketRef.current;
      if (socket.connected && user) {
        socket.emit('join:user', user.id);
        setIsConnected(true);
      } else if (!socket.connected && user) {
        // Socket exists but not connected - try to connect
        socket.connect();
      }
    }

    // Cleanup on unmount
    return () => {
      // Don't disconnect on dependency changes, only on unmount
      // Socket will be cleaned up when app unmounts or user logs out
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user === null ? 'loading' : user ? 'authenticated' : 'unauthenticated']); // More specific dependencies

  // Global wallet updates: keep Redux in sync everywhere (dashboard, settings, profile, etc.)
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !userId || !isConnected) return;

    const onWalletUpdated = (data: { userId: string; channelId: string; balance: number; delta?: number; reason?: string }) => {
      if (!data?.userId || data.userId !== userId) return;
      if (!data?.channelId || typeof data.balance !== 'number') return;
      dispatch(updateWalletBalance({ channelId: data.channelId, balance: data.balance }));
    };

    socket.on('wallet:updated', onWalletUpdated);
    return () => {
      socket.off('wallet:updated', onWalletUpdated);
    };
  }, [dispatch, isConnected, userId]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}

