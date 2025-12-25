import { configureStore } from '@reduxjs/toolkit';

import authReducer from './slices/authSlice';
import memesReducer from './slices/memesSlice';
import submissionsReducer from './slices/submissionsSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    memes: memesReducer,
    submissions: submissionsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

