import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { store } from './store/index.ts';
import { ThemeProvider } from './contexts/ThemeContext.tsx';
import { ChannelColorsProvider } from './contexts/ChannelColorsContext.tsx';
import './i18n/config';
import './index.css';

console.log('[main.tsx] Script started', { timestamp: Date.now(), location: window.location.href });

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('[main.tsx] Root element not found');
  throw new Error('Root element not found');
}

console.log('[main.tsx] Root element found, creating root');

createRoot(rootElement).render(
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
