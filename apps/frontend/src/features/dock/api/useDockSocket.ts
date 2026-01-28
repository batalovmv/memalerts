import { QueueStateSchema } from '@memalerts/api-contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

import { getRuntimeConfig } from '@/shared/config/runtimeConfig';

import type { QueueState } from '../types';

interface UseDockSocketReturn {
  connected: boolean;
  error: string | null;
  queueState: QueueState | null;
  skip: () => void;
  clear: () => void;
  pauseIntake: () => void;
  resumeIntake: () => void;
  pausePlayback: () => void;
  resumePlayback: () => void;
}

type DockAck = { ok: true } | { ok: false; code: string };

const resolveSocketUrl = (): string => {
  const runtime = getRuntimeConfig();
  if (runtime?.socketUrl !== undefined) {
    if (runtime.socketUrl === '') return window.location.origin;
    return runtime.socketUrl;
  }

  const envUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (envUrl !== undefined) {
    if (envUrl === '') return window.location.origin;
    return envUrl;
  }

  if (import.meta.env.PROD) return window.location.origin;
  return 'http://localhost:3001';
};

const resolveTransports = (): Array<'websocket' | 'polling'> => {
  const runtime = getRuntimeConfig();
  if (runtime?.socketTransports && runtime.socketTransports.length > 0) {
    const cleaned = runtime.socketTransports.filter((t) => t === 'websocket' || t === 'polling');
    if (cleaned.length > 0) return cleaned;
  }

  const envTransportsRaw = (import.meta.env as Record<string, string | undefined>).VITE_SOCKET_TRANSPORTS;
  if (typeof envTransportsRaw === 'string' && envTransportsRaw.trim()) {
    const cleaned = envTransportsRaw
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter((t) => t === 'websocket' || t === 'polling');
    if (cleaned.length > 0) return cleaned as Array<'websocket' | 'polling'>;
  }

  return ['websocket'];
};

const mapDockError = (code?: string | null): string => {
  if (code === 'TOKEN_ROTATED') return 'Token expired. Generate new dock URL';
  if (code === 'INVALID_TOKEN') return 'Invalid token';
  return code || 'UNKNOWN_ERROR';
};

export function useDockSocket(token: string | null): UseDockSocketReturn {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueState, setQueueState] = useState<QueueState | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef<string | null>(null);
  const queueStateRef = useRef<QueueState | null>(null);

  const ensureSocket = useCallback((): Socket => {
    if (socketRef.current) return socketRef.current;

    socketRef.current = io(resolveSocketUrl(), {
      transports: resolveTransports(),
      autoConnect: false,
    });

    return socketRef.current;
  }, []);

  const emitJoin = useCallback((socket: Socket, nextToken: string) => {
    socket.emit('join:dock', { token: nextToken }, (response?: DockAck) => {
      if (response && response.ok === false) {
        setError(mapDockError(response.code));
        return;
      }
      setError(null);
    });
  }, []);

  useEffect(() => {
    const trimmed = token?.trim() ?? null;
    tokenRef.current = trimmed;

    if (!trimmed) {
      setConnected(false);
      setError(null);
      setQueueState(null);
      queueStateRef.current = null;
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const socket = ensureSocket();

    const handleConnect = () => {
      setConnected(true);
      emitJoin(socket, trimmed);
    };

    const handleDisconnect = () => {
      setConnected(false);
    };

    const handleConnectError = (err: unknown) => {
      if (queueStateRef.current) return;
      const message = typeof (err as { message?: string })?.message === 'string'
        ? (err as { message: string }).message
        : 'CONNECTION_ERROR';
      setError(message);
    };

    const handleQueueState = (state: unknown) => {
      const parsed = QueueStateSchema.safeParse(state);
      if (parsed.success) {
        setQueueState(parsed.data);
        queueStateRef.current = parsed.data;
        return;
      }
      setError('INVALID_QUEUE_STATE');
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('queue:state', handleQueueState);

    if (socket.connected) {
      emitJoin(socket, trimmed);
    } else {
      socket.connect();
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('queue:state', handleQueueState);
    };
  }, [ensureSocket, emitJoin, token]);

  const emitAction = useCallback((event: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit(event, {}, (response?: DockAck) => {
      if (response && response.ok === false) {
        setError(mapDockError(response.code));
      }
    });
  }, []);

  const skip = useCallback(() => emitAction('dock:queue.skip'), [emitAction]);
  const clear = useCallback(() => emitAction('dock:queue.clear'), [emitAction]);
  const pauseIntake = useCallback(() => emitAction('dock:intake.pause'), [emitAction]);
  const resumeIntake = useCallback(() => emitAction('dock:intake.resume'), [emitAction]);
  const pausePlayback = useCallback(() => emitAction('dock:playback.pause'), [emitAction]);
  const resumePlayback = useCallback(() => emitAction('dock:playback.resume'), [emitAction]);

  return {
    connected,
    error,
    queueState,
    skip,
    clear,
    pauseIntake,
    resumeIntake,
    pausePlayback,
    resumePlayback,
  };
}
