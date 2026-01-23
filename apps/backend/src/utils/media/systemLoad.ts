export function buildLowPriorityCommand(command: string, args: string[]): { cmd: string; args: string[] } {
  if (process.platform !== 'linux') return { cmd: command, args };
  // Use ionice + nice when available; fall back if missing (handled by caller).
  return {
    cmd: 'ionice',
    args: ['-c3', 'nice', '-n', '10', command, ...args],
  };
}
