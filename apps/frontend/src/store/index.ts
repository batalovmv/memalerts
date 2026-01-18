import { configureStore } from '@reduxjs/toolkit';

import authReducer from './slices/authSlice';
import botIntegrationReducer from './slices/botIntegrationSlice';
import memesReducer from './slices/memesSlice';
import submissionsReducer from './slices/submissionsSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    botIntegration: botIntegrationReducer,
    memes: memesReducer,
    submissions: submissionsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
