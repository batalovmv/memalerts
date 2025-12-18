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
    if (envUrl) {
      console.log('Socket.IO using VITE_API_URL:', envUrl);
      return envUrl; // Should be https://beta.twitchmemes.ru or similar for beta
    }
    if (import.meta.env.PROD) {
      const origin = window.location.origin;
      console.log('Socket.IO using window.location.origin:', origin);
      return origin;
    }
    console.log('Socket.IO using localhost fallback');
    return 'http://localhost:3001';
  };

  useEffect(() => {
    if (!user) {
      // Disconnect socket if user logs out
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
      console.log('[SocketContext] Connecting to:', socketUrl);
      const socket = io(socketUrl, {
        transports: ['websocket', 'polling'],
        withCredentials: true,
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('Socket.IO connected', { socketId: socket.id });
        setIsConnected(true);
        // Join user room for wallet updates
        if (user) {
          socket.emit('join:user', user.id);
        }
      });

      socket.on('disconnect', () => {
        console.log('Socket.IO disconnected');
        setIsConnected(false);
      });

      socket.on('connect_error', (error: Error) => {
        console.error('Socket.IO connection error:', error);
        setIsConnected(false);
      });
    } else {
      // Socket already exists, just update rooms if needed
      const socket = socketRef.current;
      if (socket.connected && user) {
        socket.emit('join:user', user.id);
        setIsConnected(true);
      }
    }

    // Cleanup on unmount
    return () => {
      // Don't disconnect on dependency changes, only on unmount
      // Socket will be cleaned up when app unmounts or user logs out
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]); // Only depend on user.id, not full user object

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}

