import { useEffect } from 'react';
import { useParams } from 'react-router-dom';

import { useSocket } from '@/contexts/SocketContext';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  fetchSubmissions,
  submissionApproved,
  submissionCreated,
  submissionNeedsChanges,
  submissionRejected,
  submissionResubmitted,
} from '@/store/slices/submissionsSlice';

type WalletUpdate = {
  userId: string;
  channelId: string;
  balance: number;
  delta?: number;
  reason?: string;
};

type HeaderSocketParams = {
  channelSlug?: string;
  channelId?: string;
  onWalletUpdate: (data: WalletUpdate) => void;
};

export function useHeaderSocket({ channelSlug, channelId, onWalletUpdate }: HeaderSocketParams) {
  const { socket, isConnected } = useSocket();
  const { user } = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const params = useParams<{ slug: string }>();

  const userId = user?.id;
  const userRole = user?.role;
  const currentChannelSlug = channelSlug || params.slug;
  const effectiveModeratorChannelSlug = (currentChannelSlug || user?.channel?.slug || '').trim().toLowerCase();
  const effectiveModeratorChannelId = channelId || user?.channelId;

  // Setup Socket.IO listeners for real-time wallet updates
  useEffect(() => {
    if (!socket || !userId) {
      return;
    }

    const handleWalletUpdate = (data: WalletUpdate) => {
      if (data.userId === userId && (channelId ? data.channelId === channelId : true)) {
        onWalletUpdate(data);
      }
    };

    socket.on('wallet:updated', handleWalletUpdate);

    if (socket.connected) {
      socket.emit('join:user', userId);
    }

    return () => {
      socket.off('wallet:updated', handleWalletUpdate);
    };
  }, [socket, userId, channelId, onWalletUpdate]);

  // Realtime pending submissions badge updates (no polling)
  useEffect(() => {
    if (!socket || !userId || !(userRole === 'streamer' || userRole === 'admin')) {
      return;
    }

    let refreshTimer: number | null = null;
    const scheduleRefreshPending = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        dispatch(fetchSubmissions({ status: 'pending', limit: 20, offset: 0 }));
      }, 250);
    };

    const onCreated = (data: { submissionId: string; channelId: string; submitterId?: string }) => {
      if (effectiveModeratorChannelId && data.channelId && data.channelId !== effectiveModeratorChannelId) return;
      dispatch(submissionCreated(data));
      scheduleRefreshPending();
    };

    const onApproved = (data: { submissionId: string; channelId: string }) => {
      if (effectiveModeratorChannelId && data.channelId && data.channelId !== effectiveModeratorChannelId) return;
      dispatch(submissionApproved({ submissionId: data.submissionId }));
    };

    const onRejected = (data: { submissionId: string; channelId: string }) => {
      if (effectiveModeratorChannelId && data.channelId && data.channelId !== effectiveModeratorChannelId) return;
      dispatch(submissionRejected({ submissionId: data.submissionId }));
    };

    const onNeedsChanges = (data: { submissionId: string; channelId: string }) => {
      if (effectiveModeratorChannelId && data.channelId && data.channelId !== effectiveModeratorChannelId) return;
      dispatch(submissionNeedsChanges({ submissionId: data.submissionId }));
    };

    const onResubmitted = (data: { submissionId: string; channelId: string; submitterId?: string }) => {
      if (effectiveModeratorChannelId && data.channelId && data.channelId !== effectiveModeratorChannelId) return;
      dispatch(submissionResubmitted(data));
      scheduleRefreshPending();
    };

    const onStatusChanged = (data: { submissionId: string; status: string; channelId?: string; submitterId?: string }) => {
      if (effectiveModeratorChannelId && data.channelId && data.channelId !== effectiveModeratorChannelId) return;
      if (data.status === 'approved') {
        dispatch(submissionApproved({ submissionId: data.submissionId }));
      } else if (data.status === 'rejected') {
        dispatch(submissionRejected({ submissionId: data.submissionId }));
      } else if (data.status === 'needs_changes') {
        dispatch(submissionNeedsChanges({ submissionId: data.submissionId }));
      } else if (data.status === 'pending') {
        dispatch(
          submissionResubmitted({
            submissionId: data.submissionId,
            channelId: data.channelId || '',
            submitterId: data.submitterId,
          }),
        );
        scheduleRefreshPending();
      }
    };

    socket.on('submission:created', onCreated);
    socket.on('submission:approved', onApproved);
    socket.on('submission:rejected', onRejected);
    socket.on('submission:needs_changes', onNeedsChanges);
    socket.on('submission:resubmitted', onResubmitted);
    socket.on('submission:status-changed', onStatusChanged);

    if (isConnected && effectiveModeratorChannelSlug) {
      socket.emit('join:channel', effectiveModeratorChannelSlug);
    }

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      socket.off('submission:created', onCreated);
      socket.off('submission:approved', onApproved);
      socket.off('submission:rejected', onRejected);
      socket.off('submission:needs_changes', onNeedsChanges);
      socket.off('submission:resubmitted', onResubmitted);
      socket.off('submission:status-changed', onStatusChanged);
    };
  }, [
    socket,
    isConnected,
    userId,
    userRole,
    effectiveModeratorChannelId,
    effectiveModeratorChannelSlug,
    dispatch,
  ]);

  // Update channel room when currentChannelSlug changes
  useEffect(() => {
    if (!socket) return;
    if (isConnected && effectiveModeratorChannelSlug) {
      socket.emit('join:channel', effectiveModeratorChannelSlug);
    }
  }, [socket, isConnected, effectiveModeratorChannelSlug]);
}
