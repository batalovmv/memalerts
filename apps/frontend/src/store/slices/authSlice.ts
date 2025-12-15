import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { api } from '../../lib/api';
import type { User, ApiError } from '../../types';

interface AuthState {
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
      const response = await api.get<User>('/me');
      return response.data;
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: ApiError; status?: number } };
      return rejectWithValue({
        message: apiError.response?.data?.message || 'Failed to fetch user',
        error: apiError.response?.data?.error,
        statusCode: apiError.response?.status,
      });
    }
  }
);

export const logout = createAsyncThunk<void, void, { rejectValue: ApiError }>(
  'auth/logout',
  async (_, { rejectWithValue }) => {
    try {
      await api.post('/auth/logout');
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: ApiError; status?: number } };
      return rejectWithValue({
        message: apiError.response?.data?.message || 'Failed to logout',
        error: apiError.response?.data?.error,
        statusCode: apiError.response?.status,
      });
    }
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    updateWalletBalance: (state, action: PayloadAction<number>) => {
      if (state.user?.wallet) {
        state.user.wallet.balance = action.payload;
      }
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
      })
      .addCase(logout.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Failed to logout';
      });
  },
});

export const { clearError, updateWalletBalance } = authSlice.actions;
export default authSlice.reducer;

