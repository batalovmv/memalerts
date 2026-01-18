import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import type { ApiError, Meme } from '@/types';

import { api } from '@/lib/api';
import { toApiError } from '@/shared/api/toApiError';
import { createIdempotencyKey } from '@/shared/lib/idempotency';

export interface MemesState {
  memes: Meme[];
  loading: boolean;
  error: string | null;
}

const initialState: MemesState = {
  memes: [],
  loading: false,
  error: null,
};

export const fetchMemes = createAsyncThunk<
  Meme[],
  { channelId?: string | null },
  { rejectValue: ApiError }
>('memes/fetchMemes', async ({ channelId }, { rejectWithValue }) => {
  try {
    const params = channelId ? { channelId } : {};
    const memes = await api.get<Meme[]>('/memes', { params });
    return memes;
  } catch (error: unknown) {
    return rejectWithValue(toApiError(error, 'Failed to fetch memes'));
  }
});

export type ActivateMemeInput = {
  /** ChannelMeme.id (normal mode) OR MemeAsset.id (pool_all mode) */
  id: string;
  /** Required for pool_all mode (backend will create ChannelMeme if needed) */
  channelSlug?: string;
  /** Alternative to channelSlug */
  channelId?: string;
};

export const activateMeme = createAsyncThunk<
  void,
  ActivateMemeInput,
  { rejectValue: ApiError }
>('memes/activateMeme', async ({ id, channelSlug, channelId }, { rejectWithValue }) => {
  try {
    // Backend accepts both legacy Meme.id and ChannelMeme.id.
    const params = channelSlug ? { channelSlug } : channelId ? { channelId } : undefined;
    const idempotencyKey = createIdempotencyKey();
    await api.post(
      `/memes/${id}/activate`,
      undefined,
      params
        ? { params, headers: { 'Idempotency-Key': idempotencyKey } }
        : { headers: { 'Idempotency-Key': idempotencyKey } }
    );
  } catch (error: unknown) {
    return rejectWithValue(toApiError(error, 'Failed to activate meme'));
  }
});

const memesSlice = createSlice({
  name: 'memes',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearMemes: (state) => {
      state.memes = [];
    },
  },
  extraReducers: (builder) => {
    builder
      // fetchMemes
      .addCase(fetchMemes.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchMemes.fulfilled, (state, action) => {
        state.loading = false;
        state.memes = action.payload;
        state.error = null;
      })
      .addCase(fetchMemes.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Failed to fetch memes';
      });
  },
});

export const { clearError, clearMemes } = memesSlice.actions;
export default memesSlice.reducer;
