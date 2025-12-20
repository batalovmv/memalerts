import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { api } from '../../lib/api';
import type { Submission, ApiError } from '../../types';

interface SubmissionsState {
  submissions: Submission[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  lastErrorAt: number | null; // Track when error occurred to prevent infinite retries
  total: number;
}

const initialState: SubmissionsState = {
  submissions: [],
  loading: false,
  loadingMore: false,
  error: null,
  lastFetchedAt: null,
  lastErrorAt: null,
  total: 0,
};

type SubmissionsPage = { items: Submission[]; total: number };

export const fetchSubmissions = createAsyncThunk<
  { items: Submission[]; total: number; append: boolean },
  { status?: string; offset?: number; limit?: number; append?: boolean },
  { rejectValue: ApiError }
>('submissions/fetchSubmissions', async ({ status = 'pending', offset = 0, limit = 20, append = false }, { rejectWithValue }) => {
  try {
    const page = await api.get<SubmissionsPage>('/admin/submissions', {
      params: { status, offset, limit },
      timeout: 15000, // 15 seconds timeout
    });
    return { items: page.items, total: page.total, append };
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: ApiError; status?: number } };
    return rejectWithValue({
      message: apiError.response?.data?.message || 'Failed to fetch submissions',
      error: apiError.response?.data?.error,
      statusCode: apiError.response?.status,
    });
  }
});

export const createSubmission = createAsyncThunk<
  Submission,
  FormData,
  { rejectValue: ApiError }
>('submissions/createSubmission', async (formData, { rejectWithValue }) => {
  try {
    const response = await api.post<Submission>('/submissions', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response;
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: ApiError; status?: number } };
    return rejectWithValue({
      message: apiError.response?.data?.message || 'Failed to create submission',
      error: apiError.response?.data?.error,
      statusCode: apiError.response?.status,
    });
  }
});

export const approveSubmission = createAsyncThunk<
  void,
  { submissionId: string; priceCoins: number; durationMs?: number },
  { rejectValue: ApiError }
>(
  'submissions/approveSubmission',
  async ({ submissionId, priceCoins, durationMs }, { rejectWithValue }) => {
    try {
      const payload: Record<string, unknown> = { priceCoins };
      if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0) {
        payload.durationMs = durationMs;
      }
      await api.post(`/admin/submissions/${submissionId}/approve`, payload);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: ApiError; status?: number } };
      return rejectWithValue({
        message: apiError.response?.data?.message || 'Failed to approve submission',
        error: apiError.response?.data?.error,
        statusCode: apiError.response?.status,
      });
    }
  }
);

export const rejectSubmission = createAsyncThunk<
  void,
  { submissionId: string; moderatorNotes?: string | null },
  { rejectValue: ApiError }
>('submissions/rejectSubmission', async ({ submissionId, moderatorNotes }, { rejectWithValue }) => {
  try {
    await api.post(`/admin/submissions/${submissionId}/reject`, {
      moderatorNotes: moderatorNotes || null,
    });
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: ApiError; status?: number } };
    return rejectWithValue({
      message: apiError.response?.data?.message || 'Failed to reject submission',
      error: apiError.response?.data?.error,
      statusCode: apiError.response?.status,
    });
  }
});

const submissionsSlice = createSlice({
  name: 'submissions',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    removeSubmission: (state, action: PayloadAction<string>) => {
      state.submissions = state.submissions.filter((s) => s.id !== action.payload);
    },
    // Socket.IO realtime updates (badge + list)
    submissionCreated: (state, action: PayloadAction<{ submissionId: string; channelId: string; submitterId?: string }>) => {
      // Only matters if we're tracking pending submissions list
      // Add a lightweight placeholder if full payload is not available
      const exists = state.submissions.some((s) => s.id === action.payload.submissionId);
      if (exists) return;
      state.submissions.unshift({
        id: action.payload.submissionId,
        channelId: action.payload.channelId,
        submitterUserId: action.payload.submitterId || '',
        title: 'New submission',
        type: 'video',
        fileUrlTemp: '',
        status: 'pending',
        notes: null,
        createdAt: new Date().toISOString(),
      } as unknown as Submission);
    },
    submissionApproved: (state, action: PayloadAction<{ submissionId: string }>) => {
      state.submissions = state.submissions.filter((s) => s.id !== action.payload.submissionId);
    },
    submissionRejected: (state, action: PayloadAction<{ submissionId: string }>) => {
      state.submissions = state.submissions.filter((s) => s.id !== action.payload.submissionId);
    },
  },
  extraReducers: (builder) => {
    builder
      // fetchSubmissions
      .addCase(fetchSubmissions.pending, (state) => {
        // Distinguish between initial load and pagination
        if (state.submissions.length > 0) {
          state.loadingMore = true;
        } else {
          state.loading = true;
        }
        state.error = null;
      })
      .addCase(fetchSubmissions.fulfilled, (state, action) => {
        state.loading = false;
        state.loadingMore = false;
        if (action.payload.append) {
          state.submissions = [...state.submissions, ...action.payload.items];
        } else {
          state.submissions = action.payload.items;
        }
        state.total = action.payload.total;
        state.error = null;
        state.lastFetchedAt = Date.now();
        state.lastErrorAt = null; // Clear error timestamp on success
      })
      .addCase(fetchSubmissions.rejected, (state, action) => {
        state.loading = false;
        state.loadingMore = false;
        state.error = action.payload?.message || 'Failed to fetch submissions';
        // Track error time to prevent infinite retries
        // If error is 403 (Forbidden), don't retry for 5 minutes
        if (action.payload?.statusCode === 403) {
          state.lastErrorAt = Date.now();
        }
      })
      // approveSubmission
      .addCase(approveSubmission.fulfilled, (state, action) => {
        state.submissions = state.submissions.filter(
          (s) => s.id !== action.meta.arg.submissionId
        );
      })
      // rejectSubmission
      .addCase(rejectSubmission.fulfilled, (state, action) => {
        state.submissions = state.submissions.filter(
          (s) => s.id !== action.meta.arg.submissionId
        );
      });
  },
});

export const { clearError, removeSubmission, submissionCreated, submissionApproved, submissionRejected } = submissionsSlice.actions;
export default submissionsSlice.reducer;

