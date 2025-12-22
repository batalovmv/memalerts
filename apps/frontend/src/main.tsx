import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { store } from './store/index.ts';
import { ThemeProvider } from './contexts/ThemeContext.tsx';
import { ChannelColorsProvider } from './contexts/ChannelColorsContext.tsx';
import { loadRuntimeConfig } from './lib/runtimeConfig';
import { setApiBaseUrl } from './lib/api';
import { ErrorBoundary } from './components/ErrorBoundary';
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
        <BrowserRouter>
          <ThemeProvider>
            <ChannelColorsProvider>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </ChannelColorsProvider>
          </ThemeProvider>
        </BrowserRouter>
      </Provider>
    </StrictMode>,
  );
}

bootstrap();
