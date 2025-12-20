import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { getRuntimeConfig } from '../lib/runtimeConfig';
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
  const dispatch = useAppDispatch();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

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
      
      // Prevent multiple initialization attempts
      const socket = io(socketUrl, {
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnection: true,
        reconnectionDelay: 2000, // Start with 2 seconds
        reconnectionDelayMax: 10000, // Max 10 seconds between attempts
        reconnectionAttempts: 3, // Only 3 attempts to prevent infinite loops
        timeout: 10000, // 10 seconds timeout (reduced from 20)
        forceNew: false, // Reuse existing connection if available
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        setIsConnected(true);
        // Join user room for wallet updates
        if (user) {
          socket.emit('join:user', user.id);
        }
      });

      socket.on('disconnect', (reason: string) => {
        setIsConnected(false);
      });

      socket.on('connect_error', (error: Error) => {
        setIsConnected(false);
        // Don't manually retry - let Socket.IO handle reconnection with exponential backoff
      });

      socket.on('reconnect_attempt', (attemptNumber: number) => {
      });

      socket.on('reconnect_failed', () => {
        // After failed reconnection, don't try again automatically
        // User will need to refresh page or reconnect manually
      });
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
    if (!socket || !user || !isConnected) return;

    const onWalletUpdated = (data: { userId: string; channelId: string; balance: number; delta?: number; reason?: string }) => {
      if (!data?.userId || data.userId !== user.id) return;
      if (!data?.channelId || typeof data.balance !== 'number') return;
      dispatch(updateWalletBalance({ channelId: data.channelId, balance: data.balance }));
    };

    socket.on('wallet:updated', onWalletUpdated);
    return () => {
      socket.off('wallet:updated', onWalletUpdated);
    };
  }, [dispatch, isConnected, user?.id]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}

