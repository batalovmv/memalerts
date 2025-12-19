import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAppSelector } from '../store/hooks';

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
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Get API URL for Socket.IO
  const getSocketUrl = () => {
    const envUrl = import.meta.env.VITE_API_URL;
    
    // If VITE_API_URL is explicitly set (even if empty string), use it
    // Empty string means use relative URLs (same origin)
    if (envUrl !== undefined) {
      if (envUrl === '') {
        // Empty string means use relative URLs - use current origin
        const origin = window.location.origin;
        console.log('[SocketContext] Using relative URLs (empty VITE_API_URL), origin:', origin);
        return origin;
      }
      console.log('[SocketContext] Using VITE_API_URL:', envUrl);
      return envUrl;
    }
    
    // If VITE_API_URL is not set at all, determine based on environment
    if (import.meta.env.PROD) {
      const origin = window.location.origin;
      console.log('[SocketContext] Using window.location.origin:', origin);
      return origin;
    }
    
    console.log('[SocketContext] Using localhost fallback');
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
        console.log('[SocketContext] User logged out, disconnecting socket');
        socketRef.current.disconnect();
        socketRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    // Only create socket if it doesn't exist
    if (!socketRef.current) {
      const socketUrl = getSocketUrl();
      console.log('[SocketContext] Initializing Socket.IO connection to:', socketUrl, { userId: user.id });
      
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
        console.log('[SocketContext] ✅ Socket.IO connected', { 
          socketId: socket.id, 
          socketUrl,
          userId: user?.id 
        });
        setIsConnected(true);
        // Join user room for wallet updates
        if (user) {
          socket.emit('join:user', user.id);
          console.log('[SocketContext] Joined user room:', `user:${user.id}`);
        }
      });

      socket.on('disconnect', (reason: string) => {
        console.log('[SocketContext] ❌ Socket.IO disconnected', { reason, socketUrl, socketId: socket.id });
        setIsConnected(false);
      });

      socket.on('connect_error', (error: Error) => {
        console.error('[SocketContext] ❌ Socket.IO connection error:', error.message, {
          socketUrl,
          userId: user?.id,
          connected: socket.connected,
          disconnected: socket.disconnected,
        });
        setIsConnected(false);
        // Don't manually retry - let Socket.IO handle reconnection with exponential backoff
      });

      socket.on('reconnect_attempt', (attemptNumber: number) => {
        console.log(`[SocketContext] 🔄 Reconnection attempt ${attemptNumber} for ${socketUrl}`);
      });

      socket.on('reconnect_failed', () => {
        console.error('[SocketContext] ❌ Reconnection failed, stopping attempts');
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
        console.log('[SocketContext] Socket exists but not connected, attempting to connect');
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

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}

