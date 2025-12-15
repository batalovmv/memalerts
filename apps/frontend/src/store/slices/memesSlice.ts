import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { api } from '../../lib/api';
import type { Meme, ApiError } from '../../types';

interface MemesState {
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
    const response = await api.get<Meme[]>('/memes', { params });
    return response.data;
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: ApiError; status?: number } };
    return rejectWithValue({
      message: apiError.response?.data?.message || 'Failed to fetch memes',
      error: apiError.response?.data?.error,
      statusCode: apiError.response?.status,
    });
  }
});

export const activateMeme = createAsyncThunk<
  void,
  string,
  { rejectValue: ApiError }
>('memes/activateMeme', async (memeId, { rejectWithValue }) => {
  try {
    await api.post(`/memes/${memeId}/activate`);
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: ApiError; status?: number } };
    return rejectWithValue({
      message: apiError.response?.data?.message || 'Failed to activate meme',
      error: apiError.response?.data?.error,
      statusCode: apiError.response?.status,
    });
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

