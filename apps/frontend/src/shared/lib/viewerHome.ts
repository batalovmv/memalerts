const VIEWER_HOME_KEY = 'memalerts:viewer:home';

export function getViewerHome(): string | null {
  try {
    const v = sessionStorage.getItem(VIEWER_HOME_KEY);
    return v && typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function setViewerHome(path: string): void {
  try {
    sessionStorage.setItem(VIEWER_HOME_KEY, path);
  } catch {
    // ignore
  }
}


