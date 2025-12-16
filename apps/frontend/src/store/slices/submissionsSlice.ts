import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { api } from '../../lib/api';
import type { Submission, ApiError } from '../../types';

interface SubmissionsState {
  submissions: Submission[];
  loading: boolean;
  error: string | null;
}

const initialState: SubmissionsState = {
  submissions: [],
  loading: false,
  error: null,
};

export const fetchSubmissions = createAsyncThunk<
  Submission[],
  { status?: string },
  { rejectValue: ApiError }
>('submissions/fetchSubmissions', async ({ status = 'pending' }, { rejectWithValue }) => {
  try {
    const response = await api.get<Submission[]>('/admin/submissions', {
      params: { status },
    });
    return response.data;
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
    return response.data;
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
  { submissionId: string; priceCoins: number; durationMs: number },
  { rejectValue: ApiError }
>(
  'submissions/approveSubmission',
  async ({ submissionId, priceCoins, durationMs }, { rejectWithValue }) => {
    try {
      await api.post(`/admin/submissions/${submissionId}/approve`, {
        priceCoins,
        durationMs,
      });
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
  },
  extraReducers: (builder) => {
    builder
      // fetchSubmissions
      .addCase(fetchSubmissions.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchSubmissions.fulfilled, (state, action) => {
        state.loading = false;
        state.submissions = action.payload;
        state.error = null;
      })
      .addCase(fetchSubmissions.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Failed to fetch submissions';
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

export const { clearError, removeSubmission } = submissionsSlice.actions;
export default submissionsSlice.reducer;

