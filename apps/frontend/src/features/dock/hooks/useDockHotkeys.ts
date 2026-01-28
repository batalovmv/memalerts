import { useEffect } from 'react';

interface DockHotkeyActions {
  skip: () => void;
  clear: () => void;
  toggleIntake: () => void;
  togglePlayback: () => void;
}

export function useDockHotkeys(actions: DockHotkeyActions) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case 's':
        case ' ':
          event.preventDefault();
          actions.skip();
          break;
        case 'c':
          event.preventDefault();
          if (window.confirm('Clear entire queue?')) {
            actions.clear();
          }
          break;
        case 'i':
          event.preventDefault();
          actions.toggleIntake();
          break;
        case 'p':
          event.preventDefault();
          actions.togglePlayback();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions]);
}
