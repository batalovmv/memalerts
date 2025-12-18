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

// #region agent log
console.log('[main.tsx] Script started', { timestamp: Date.now(), location: window.location.href });
fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.tsx:12',message:'main.tsx script started',data:{href:window.location.href,userAgent:navigator.userAgent},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
// #endregion

const rootElement = document.getElementById('root');
if (!rootElement) {
  // #region agent log
  console.error('[main.tsx] Root element not found');
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.tsx:16',message:'Root element not found',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  throw new Error('Root element not found');
}

// #region agent log
console.log('[main.tsx] Root element found, creating root');
fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.tsx:22',message:'Root element found',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
// #endregion

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

// #region agent log
console.log('[main.tsx] Render completed');
fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.tsx:35',message:'main.tsx render completed',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
// #endregion
