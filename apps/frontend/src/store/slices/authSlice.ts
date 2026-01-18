import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';

import type { ApiError, Channel, User, Wallet } from '@/types';

import { api } from '@/lib/api';
import { toApiError } from '@/shared/api/toApiError';
import { clearUserPreferencesCache } from '@/shared/lib/userPreferences';

export interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  loading: true,
  error: null,
};

export const fetchUser = createAsyncThunk<User, void, { rejectValue: ApiError }>(
  'auth/fetchUser',
  async (_, { rejectWithValue }) => {
    try {
      const user = await api.get<User>('/me');
      
      // If user has channelId, fetch channel info to get slug
      if (user.channelId) {
        try {
          // We need to get channel slug - this will be done via a separate call
          // For now, we'll fetch it when needed in components
        } catch (error) {
          // Ignore error, slug will be fetched when needed
        }
      }
      
      return user;
    } catch (error: unknown) {
      return rejectWithValue(toApiError(error, 'Failed to fetch user'));
    }
  }
);

export const logout = createAsyncThunk<void, void, { rejectValue: ApiError }>(
  'auth/logout',
  async (_, { rejectWithValue }) => {
    try {
      await api.post('/auth/logout');
    } catch (error: unknown) {
      return rejectWithValue(toApiError(error, 'Failed to logout'));
    }
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUnauthenticated: (state) => {
      state.user = null;
      state.loading = false;
      state.error = null;
      clearUserPreferencesCache();
    },
    clearError: (state) => {
      state.error = null;
    },
    updateWalletBalance: (state, action: PayloadAction<{ channelId: string; balance: number }>) => {
      if (!state.user) return;

      // Ensure wallets array exists
      if (!state.user.wallets) {
        state.user.wallets = [];
      }

      const wallet = state.user.wallets.find(w => w.channelId === action.payload.channelId);
      if (wallet) {
        wallet.balance = action.payload.balance;
        return;
      }

      // If wallet doesn't exist yet (first-time redemption), create it in state
      const newWallet: Wallet = {
        id: '',
        userId: state.user.id,
        channelId: action.payload.channelId,
        balance: action.payload.balance,
      };
      state.user.wallets.push(newWallet);
    },
    updateChannelSettings: (state, action: PayloadAction<{ channelId: string; settings: Partial<Channel> }>) => {
      if (!state.user?.channel || !state.user.channelId) return;
      if (state.user.channelId !== action.payload.channelId) return;
      state.user.channel = { ...state.user.channel, ...action.payload.settings };
    },
  },
  extraReducers: (builder) => {
    builder
      // fetchUser
      .addCase(fetchUser.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchUser.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload;
        state.error = null;
      })
      .addCase(fetchUser.rejected, (state, action) => {
        state.loading = false;
        state.user = null;
        state.error = action.payload?.message || 'Failed to fetch user';
      })
      // logout
      .addCase(logout.pending, (state) => {
        state.loading = true;
      })
      .addCase(logout.fulfilled, (state) => {
        state.loading = false;
        state.user = null;
        state.error = null;
        clearUserPreferencesCache();
      })
      .addCase(logout.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Failed to logout';
      });
  },
});

export const { setUnauthenticated, clearError, updateWalletBalance, updateChannelSettings } = authSlice.actions;
export default authSlice.reducer;
