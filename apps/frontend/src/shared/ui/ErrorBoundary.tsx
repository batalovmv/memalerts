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
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
          <p className="text-sm text-gray-600">Please reload the page.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}



