type ShutdownInfo = {
  shuttingDown: boolean;
  startedAt: string | null;
  signal: string | null;
};

const shutdownInfo: ShutdownInfo = {
  shuttingDown: false,
  startedAt: null,
  signal: null,
};

export function markShuttingDown(signal?: string): ShutdownInfo {
  if (!shutdownInfo.shuttingDown) {
    shutdownInfo.shuttingDown = true;
    shutdownInfo.startedAt = new Date().toISOString();
    shutdownInfo.signal = signal ?? null;
  }
  return getShutdownInfo();
}

export function isShuttingDown(): boolean {
  return shutdownInfo.shuttingDown;
}

export function getShutdownInfo(): ShutdownInfo {
  return { ...shutdownInfo };
}
