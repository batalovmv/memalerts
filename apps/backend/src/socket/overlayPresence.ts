// Map<channelId, Map<socketId, lastPingTimestamp>>
const overlayPresence = new Map<string, Map<string, number>>();

const STALE_THRESHOLD_MS = 40_000; // 40 sec without ping = disconnected

export function addOverlay(channelId: string, socketId: string): void {
  if (!overlayPresence.has(channelId)) {
    overlayPresence.set(channelId, new Map());
  }
  overlayPresence.get(channelId)!.set(socketId, Date.now());
}

export function updatePing(channelId: string, socketId: string): void {
  overlayPresence.get(channelId)?.set(socketId, Date.now());
}

export function removeOverlay(channelId: string, socketId: string): void {
  overlayPresence.get(channelId)?.delete(socketId);
}

export function getOverlayStatus(channelId: string): { connected: boolean; count: number } {
  const sockets = overlayPresence.get(channelId);
  if (!sockets) return { connected: false, count: 0 };

  const staleThreshold = Date.now() - STALE_THRESHOLD_MS;
  let activeCount = 0;

  // Count active sockets + cleanup stale entries.
  for (const [socketId, lastPing] of sockets.entries()) {
    if (lastPing > staleThreshold) {
      activeCount++;
    } else {
      sockets.delete(socketId);
    }
  }

  return { connected: activeCount > 0, count: activeCount };
}

// Periodic cleanup of stale entries.
setInterval(() => {
  const staleThreshold = Date.now() - STALE_THRESHOLD_MS;
  for (const [channelId, sockets] of overlayPresence.entries()) {
    for (const [socketId, lastPing] of sockets.entries()) {
      if (lastPing < staleThreshold) {
        sockets.delete(socketId);
      }
    }
    if (sockets.size === 0) {
      overlayPresence.delete(channelId);
    }
  }
}, 30_000);

export function getPresenceStats(): { channels: number; totalOverlays: number } {
  let totalOverlays = 0;
  for (const sockets of overlayPresence.values()) {
    totalOverlays += sockets.size;
  }
  return { channels: overlayPresence.size, totalOverlays };
}
