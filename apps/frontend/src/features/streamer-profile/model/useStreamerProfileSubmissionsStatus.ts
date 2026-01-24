import { useEffect } from 'react';

import type { ChannelInfo } from '@/features/streamer-profile/model/types';
import type { Dispatch, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';

type UseStreamerProfileSubmissionsStatusParams = {
  socket: Socket | null;
  isConnected: boolean;
  normalizedSlug: string;
  channelInfo: ChannelInfo | null;
  setChannelInfo: Dispatch<SetStateAction<ChannelInfo | null>>;
  onCloseSubmitModal: () => void;
};

export function useStreamerProfileSubmissionsStatus({
  socket,
  isConnected,
  normalizedSlug,
  channelInfo,
  setChannelInfo,
  onCloseSubmitModal,
}: UseStreamerProfileSubmissionsStatusParams) {
  // Realtime: submissions status updates (Socket.IO).
  useEffect(() => {
    if (!socket || !isConnected) return;
    const roomSlug = String(channelInfo?.slug || normalizedSlug || '').trim();
    if (!roomSlug) return;

    socket.emit('join:channel', roomSlug.toLowerCase());

    const onStatus = (payload: { enabled?: boolean; onlyWhenLive?: boolean } | null | undefined) => {
      const enabled = typeof payload?.enabled === 'boolean' ? payload.enabled : null;
      const onlyWhenLive = typeof payload?.onlyWhenLive === 'boolean' ? payload.onlyWhenLive : null;
      if (enabled === null && onlyWhenLive === null) return;

      setChannelInfo((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          ...(enabled !== null ? { submissionsEnabled: enabled } : null),
          ...(onlyWhenLive !== null ? { submissionsOnlyWhenLive: onlyWhenLive } : null),
        };
      });

      if (enabled === false) {
        onCloseSubmitModal();
      }
    };

    socket.on('submissions:status', onStatus);
    return () => {
      socket.off('submissions:status', onStatus);
    };
  }, [channelInfo?.slug, isConnected, normalizedSlug, onCloseSubmitModal, setChannelInfo, socket]);
}
