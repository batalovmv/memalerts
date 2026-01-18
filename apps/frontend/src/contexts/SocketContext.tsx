import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';

import { getRuntimeConfig } from '../lib/runtimeConfig';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { updateChannelSettings, updateWalletBalance } from '../store/slices/authSlice';
import {
  fetchSubmissions,
  submissionAiCompleted,
  submissionApproved,
  submissionCreated,
  submissionNeedsChanges,
  submissionRejected,
  submissionResubmitted,
} from '../store/slices/submissionsSlice';

import type { Channel, MemeAssetStatus, SubmissionAiDecision, SubmissionAiStatus, SubmissionStatus } from '@/types';

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
  const { user, loading } = useAppSelector((state) => state.auth);
  const userId = user?.id;
  const dispatch = useAppDispatch();
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
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
    // Don't create/disconnect socket while auth is loading.
    if (loading) {
      return;
    }

    if (!user) {
      // User is logged out - disconnect socket
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
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
        setSocket(s);

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
  }, [loading, user?.id, user ? 'authenticated' : 'unauthenticated']); // More specific dependencies

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

  // Submission/Channel realtime updates (streamer/admin scope).
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !isConnected || !user) return;

    const isModerator = user.role === 'streamer' || user.role === 'admin';
    const channelId = user.channelId || null;

    const onSubmissionCreated = (data: { submissionId?: string; channelId?: string; submitterId?: string }) => {
      if (!isModerator) return;
      if (!data?.submissionId || !data?.channelId) return;
      if (channelId && data.channelId !== channelId) return;
      dispatch(
        submissionCreated({
          submissionId: data.submissionId,
          channelId: data.channelId,
          submitterId: data.submitterId,
        }),
      );
    };

    const onSubmissionStatusChanged = (data: {
      submissionId?: string;
      status?: SubmissionStatus;
      channelId?: string;
      submitterId?: string;
    }) => {
      if (!isModerator) return;
      if (!data?.submissionId || !data?.status) return;
      if (channelId && data.channelId && data.channelId !== channelId) return;

      if (data.status === 'approved') {
        dispatch(submissionApproved({ submissionId: data.submissionId }));
        return;
      }

      if (data.status === 'rejected') {
        dispatch(submissionRejected({ submissionId: data.submissionId }));
        return;
      }

      if (data.status === 'needs_changes') {
        dispatch(submissionNeedsChanges({ submissionId: data.submissionId }));
        return;
      }

      if (data.status === 'pending') {
        const targetChannelId = data.channelId ?? channelId;
        if (!targetChannelId) return;
        dispatch(
          submissionResubmitted({
            submissionId: data.submissionId,
            channelId: targetChannelId,
            submitterId: data.submitterId,
          }),
        );
      }
    };

    const onAiCompleted = (data: {
      submissionId?: string;
      channelId?: string;
      aiStatus?: SubmissionAiStatus;
      aiDecision?: SubmissionAiDecision;
      aiRiskScore?: number;
    }) => {
      if (!isModerator) return;
      if (!data?.submissionId || !data?.aiStatus) return;
      if (channelId && data.channelId && data.channelId !== channelId) return;
      dispatch(
        submissionAiCompleted({
          submissionId: data.submissionId,
          aiStatus: data.aiStatus,
          aiDecision: data.aiDecision,
          aiRiskScore: data.aiRiskScore,
        }),
      );
    };

    const onBulkModerated = (data: { channelId?: string; action?: string; count?: number }) => {
      if (!isModerator) return;
      if (channelId && data?.channelId && data.channelId !== channelId) return;
      dispatch(fetchSubmissions({ status: 'pending', limit: 20, offset: 0, includeTotal: true }));
    };

    const onChannelSettingsChanged = (data: { channelId?: string; settings?: Partial<Channel> }) => {
      if (!data?.channelId || !data?.settings) return;
      dispatch(updateChannelSettings({ channelId: data.channelId, settings: data.settings }));
    };

    const onMemeAssetStatusChanged = (data: { memeAssetId?: string; status?: MemeAssetStatus; changedBy?: string }) => {
      if (!data?.memeAssetId || !data?.status) return;
      if (typeof window === 'undefined') return;
      window.dispatchEvent(new CustomEvent('meme-asset:status-changed', { detail: data }));
    };

    socket.on('submission:created', onSubmissionCreated);
    socket.on('submission:status-changed', onSubmissionStatusChanged);
    socket.on('submission:ai-completed', onAiCompleted);
    socket.on('submissions:bulk-moderated', onBulkModerated);
    socket.on('channel:settings-changed', onChannelSettingsChanged);
    socket.on('meme-asset:status-changed', onMemeAssetStatusChanged);

    return () => {
      socket.off('submission:created', onSubmissionCreated);
      socket.off('submission:status-changed', onSubmissionStatusChanged);
      socket.off('submission:ai-completed', onAiCompleted);
      socket.off('submissions:bulk-moderated', onBulkModerated);
      socket.off('channel:settings-changed', onChannelSettingsChanged);
      socket.off('meme-asset:status-changed', onMemeAssetStatusChanged);
    };
  }, [dispatch, isConnected, user]);

  const value = useMemo(() => ({ socket, isConnected }), [socket, isConnected]);

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}
