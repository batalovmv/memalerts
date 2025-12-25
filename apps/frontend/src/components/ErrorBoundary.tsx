import React, { type ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

function emitRenderError(message: string) {
  const id =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.dispatchEvent(
    new CustomEvent('memalerts:globalError', {
      detail: {
        kind: 'render',
        message,
        requestId: id,
        ts: new Date().toISOString(),
      },
    })
  );
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    const msg = error instanceof Error ? error.message : 'Render error';
    emitRenderError(msg);
  }

  render() {
    // We still render children; the global banner will show details and user can refresh.
    if (this.state.hasError) return null;
    return this.props.children;
  }
}



