import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';

import App from '@/App.tsx';
import { ChannelColorsProvider } from '@/contexts/ChannelColorsContext.tsx';
import { HelpModeProvider } from '@/contexts/HelpModeContext.tsx';
import { ThemeProvider } from '@/contexts/ThemeContext.tsx';
import { setApiBaseUrl } from '@/lib/api';
import { loadRuntimeConfig } from '@/lib/runtimeConfig';
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary';
import { store } from '@/store/index.ts';

import '@/shared/styles/tokens.css';
import '@/shared/styles/theme.css';
import './i18n/config';
import './index.css';

// In production we don't want any console noise in the browser.
// Keep console.error intact for real issues.
if (import.meta.env.PROD) {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};
}

if (import.meta.env.DEV) {
  void (async () => {
    const axe = (await import('@axe-core/react')).default;
    const React = await import('react');
    const ReactDOM = await import('react-dom/client');
    axe(React, ReactDOM, 1000);
  })();
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

async function bootstrap() {
  // Load runtime config first, so initial /me request uses correct origin (beta vs prod)
  const cfg = await loadRuntimeConfig();
  if (cfg.apiBaseUrl !== undefined) {
    // "" means same-origin relative requests
    setApiBaseUrl(cfg.apiBaseUrl);
  }

  createRoot(rootElement!).render(
    <StrictMode>
      <Provider store={store}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ThemeProvider>
            <ChannelColorsProvider>
              <HelpModeProvider>
                <ErrorBoundary>
                  <App />
                </ErrorBoundary>
              </HelpModeProvider>
            </ChannelColorsProvider>
          </ThemeProvider>
        </BrowserRouter>
      </Provider>
    </StrictMode>,
  );
}

bootstrap();
