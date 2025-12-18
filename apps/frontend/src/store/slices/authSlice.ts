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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authSlice.ts:21',message:'fetchUser started',data:{baseURL:api.defaults.baseURL,fullURL:api.defaults.baseURL + '/me'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      console.log('[fetchUser] Making request to /me, baseURL:', api.defaults.baseURL, 'full URL:', api.defaults.baseURL + '/me');
      const startTime = Date.now();
      const user = await api.get<User>('/me');
      const duration = Date.now() - startTime;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authSlice.ts:23',message:'fetchUser completed',data:{userId:user?.id,duration},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      console.log('[fetchUser] Response received:', user?.id);
      
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
      const apiError = error as { response?: { data?: ApiError; status?: number }; message?: string };
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authSlice.ts:36',message:'fetchUser error',data:{status:apiError.response?.status,error:apiError.response?.data?.error,message:apiError.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      console.error('[fetchUser] Error:', apiError.response?.status, apiError.response?.data, apiError.message);
      console.error('[fetchUser] Request URL was:', api.defaults.baseURL + '/me');
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
    updateWalletBalance: (state, action: PayloadAction<{ channelId: string; balance: number }>) => {
      if (state.user?.wallets) {
        const wallet = state.user.wallets.find(w => w.channelId === action.payload.channelId);
        if (wallet) {
          wallet.balance = action.payload.balance;
        }
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

