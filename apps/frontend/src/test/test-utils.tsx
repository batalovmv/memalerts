import React, { PropsWithChildren } from 'react';
import { Provider } from 'react-redux';
import { render, type RenderOptions } from '@testing-library/react';
import { configureStore, type PreloadedState } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

import authReducer from '@/store/slices/authSlice';
import botIntegrationReducer from '@/store/slices/botIntegrationSlice';
import memesReducer from '@/store/slices/memesSlice';
import submissionsReducer from '@/store/slices/submissionsSlice';
import type { RootState } from '@/store';

export function createTestStore(preloadedState?: PreloadedState<RootState>) {
  return configureStore({
    reducer: {
      auth: authReducer,
      botIntegration: botIntegrationReducer,
      memes: memesReducer,
      submissions: submissionsReducer,
    },
    preloadedState,
  });
}

export function renderWithProviders(
  ui: React.ReactElement,
  opts?: {
    route?: string;
    preloadedState?: PreloadedState<RootState>;
    store?: ReturnType<typeof createTestStore>;
    renderOptions?: Omit<RenderOptions, 'wrapper'>;
  },
) {
  const route = opts?.route ?? '/';
  const store = opts?.store ?? createTestStore(opts?.preloadedState);

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <Provider store={store}>
        <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          {children}
        </MemoryRouter>
      </Provider>
    );
  }

  return {
    store,
    ...render(ui, { wrapper: Wrapper, ...(opts?.renderOptions ?? {}) }),
  };
}

