import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

import type { ApiError, BotProvider } from '@/types';

import { toApiError } from '@/shared/api/toApiError';
import { getAllBotStatuses, updateBotSettings } from '@/shared/api/botIntegration';
import type { BotStatus } from '@/shared/api/botIntegration';

export type BotIntegrationState = {
  bots: BotStatus[];
  loading: boolean;
  error: string | null;
};

const initialState: BotIntegrationState = {
  bots: [],
  loading: false,
  error: null,
};

export const fetchBotStatuses = createAsyncThunk<
  { bots: BotStatus[] },
  void,
  { rejectValue: ApiError }
>('botIntegration/fetchAll', async (_arg, { rejectWithValue }) => {
  try {
    return await getAllBotStatuses();
  } catch (error: unknown) {
    return rejectWithValue(toApiError(error, 'Failed to load bot statuses'));
  }
});

export const updateBotSettingsThunk = createAsyncThunk<
  BotStatus,
  { provider: BotProvider; settings: { enabled?: boolean; useDefaultBot?: boolean; channelUrl?: string } },
  { rejectValue: ApiError }
>('botIntegration/update', async ({ provider, settings }, { rejectWithValue }) => {
  try {
    return await updateBotSettings(provider, settings);
  } catch (error: unknown) {
    return rejectWithValue(toApiError(error, 'Failed to update bot settings'));
  }
});

const botIntegrationSlice = createSlice({
  name: 'botIntegration',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchBotStatuses.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBotStatuses.fulfilled, (state, action) => {
        state.loading = false;
        state.bots = action.payload.bots;
        state.error = null;
      })
      .addCase(fetchBotStatuses.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Failed to load bot statuses';
      })
      .addCase(updateBotSettingsThunk.fulfilled, (state, action) => {
        const index = state.bots.findIndex((b) => b.provider === action.payload.provider);
        if (index !== -1) {
          state.bots[index] = action.payload;
        } else {
          state.bots.push(action.payload);
        }
      })
      .addCase(updateBotSettingsThunk.rejected, (state, action) => {
        state.error = action.payload?.message || 'Failed to update bot settings';
      });
  },
});

export default botIntegrationSlice.reducer;
