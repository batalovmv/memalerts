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
import './i18n/config';
import './index.css';

console.log('[main.tsx] Script started', { timestamp: Date.now(), location: window.location.href });

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('[main.tsx] Root element not found');
  throw new Error('Root element not found');
}

console.log('[main.tsx] Root element found, creating root');

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
              <App />
            </ChannelColorsProvider>
          </ThemeProvider>
        </BrowserRouter>
      </Provider>
    </StrictMode>,
  );

  console.log('[main.tsx] Render completed');
}

bootstrap();
