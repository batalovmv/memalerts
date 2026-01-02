import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';

import type { ApiError, Submission } from '@/types';

import { api } from '@/lib/api';
import { toApiError } from '@/shared/api/toApiError';

export interface SubmissionsState {
  submissions: Submission[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  lastErrorAt: number | null; // Track when error occurred to prevent infinite retries
  total: number | null;
}

const initialState: SubmissionsState = {
  submissions: [],
  loading: false,
  loadingMore: false,
  error: null,
  lastFetchedAt: null,
  lastErrorAt: null,
  total: null,
};

type SubmissionsPage = { items: Submission[]; total: number | null };

function isSubmissionsPage(v: unknown): v is SubmissionsPage {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return Array.isArray(obj.items);
}

export const fetchSubmissions = createAsyncThunk<
  SubmissionsPage,
  { status?: string; limit?: number; offset?: number; append?: boolean; includeTotal?: boolean },
  { rejectValue: ApiError }
>('submissions/fetchSubmissions', async ({ status = 'pending', limit = 20, offset = 0, includeTotal }, { rejectWithValue }) => {
  try {
    const resp = await api.get<Submission[] | SubmissionsPage>('/streamer/submissions', {
      // includeTotal is only needed for first page (badge/count); skip otherwise to avoid expensive count() on backend.
      // Perf: pending list UI doesn't need tags; skip JOINs by default.
      params: { status, limit, offset, includeTotal: includeTotal ?? (offset === 0 ? 1 : 0), includeTags: 0 },
      timeout: 15000, // 15 seconds timeout
    });

    // Back-compat: older backend returns array
    if (Array.isArray(resp)) {
      return { items: resp, total: resp.length };
    }
    if (isSubmissionsPage(resp)) {
      const total = typeof (resp as Record<string, unknown>).total === 'number' ? ((resp as Record<string, unknown>).total as number) : null;
      return { items: resp.items || [], total };
    }
    return { items: [], total: null };
  } catch (error: unknown) {
    return rejectWithValue(toApiError(error, 'Failed to fetch submissions'));
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
    return rejectWithValue(toApiError(error, 'Failed to create submission'));
  }
});

export const approveSubmission = createAsyncThunk<
  void,
  { submissionId: string; priceCoins: number; durationMs?: number; tags?: string[] },
  { rejectValue: ApiError }
>(
  'submissions/approveSubmission',
  async ({ submissionId, priceCoins, durationMs, tags }, { rejectWithValue }) => {
    try {
      const payload: Record<string, unknown> = { priceCoins };
      if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0) {
        payload.durationMs = durationMs;
      }
      if (Array.isArray(tags) && tags.length > 0) {
        payload.tags = tags;
      }
      await api.post(`/streamer/submissions/${submissionId}/approve`, payload);
    } catch (error: unknown) {
      return rejectWithValue(toApiError(error, 'Failed to approve submission'));
    }
  }
);

export const rejectSubmission = createAsyncThunk<
  void,
  { submissionId: string; moderatorNotes?: string | null },
  { rejectValue: ApiError }
>('submissions/rejectSubmission', async ({ submissionId, moderatorNotes }, { rejectWithValue }) => {
  try {
    await api.post(`/streamer/submissions/${submissionId}/reject`, {
      moderatorNotes: moderatorNotes || null,
    });
  } catch (error: unknown) {
    return rejectWithValue(toApiError(error, 'Failed to reject submission'));
  }
});

export const needsChangesSubmission = createAsyncThunk<
  void,
  { submissionId: string; moderatorNotes: string },
  { rejectValue: ApiError }
>('submissions/needsChangesSubmission', async ({ submissionId, moderatorNotes }, { rejectWithValue }) => {
  try {
    await api.post(`/streamer/submissions/${submissionId}/needs-changes`, {
      moderatorNotes,
    });
  } catch (error: unknown) {
    return rejectWithValue(toApiError(error, 'Failed to send submission for changes'));
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
      if (typeof state.total === 'number') state.total += 1;
      state.submissions.unshift({
        id: action.payload.submissionId,
        title: 'New submission',
        type: 'video',
        fileUrlTemp: '',
        status: 'pending',
        notes: null,
        createdAt: new Date().toISOString(),
        submitter: {
          id: action.payload.submitterId || 'unknown',
          displayName: 'Unknown',
        },
        revision: 0,
      });
    },
    submissionApproved: (state, action: PayloadAction<{ submissionId: string }>) => {
      const before = state.submissions.length;
      state.submissions = state.submissions.filter((s) => s.id !== action.payload.submissionId);
      const removed = before !== state.submissions.length;
      if (removed && typeof state.total === 'number' && state.total > 0) state.total -= 1;
    },
    submissionRejected: (state, action: PayloadAction<{ submissionId: string }>) => {
      const before = state.submissions.length;
      state.submissions = state.submissions.filter((s) => s.id !== action.payload.submissionId);
      const removed = before !== state.submissions.length;
      if (removed && typeof state.total === 'number' && state.total > 0) state.total -= 1;
    },
    submissionNeedsChanges: (state, action: PayloadAction<{ submissionId: string }>) => {
      const before = state.submissions.length;
      state.submissions = state.submissions.filter((s) => s.id !== action.payload.submissionId);
      const removed = before !== state.submissions.length;
      if (removed && typeof state.total === 'number' && state.total > 0) state.total -= 1;
    },
    submissionResubmitted: (state, action: PayloadAction<{ submissionId: string; channelId: string; submitterId?: string }>) => {
      // Resubmitted goes back to pending list.
      const exists = state.submissions.some((s) => s.id === action.payload.submissionId);
      if (exists) return;
      if (typeof state.total === 'number') state.total += 1;
      state.submissions.unshift({
        id: action.payload.submissionId,
        title: 'Updated submission',
        type: 'video',
        fileUrlTemp: '',
        status: 'pending',
        notes: null,
        createdAt: new Date().toISOString(),
        submitter: {
          id: action.payload.submitterId || 'unknown',
          displayName: 'Unknown',
        },
        revision: 1,
      });
    },
  },
  extraReducers: (builder) => {
    builder
      // fetchSubmissions
      .addCase(fetchSubmissions.pending, (state) => {
        // If we already have some data, treat as "load more" for nicer UX
        state.loadingMore = state.submissions.length > 0;
        state.loading = !state.loadingMore;
        state.error = null;
      })
      .addCase(fetchSubmissions.fulfilled, (state, action) => {
        state.loading = false;
        state.loadingMore = false;
        state.total = action.payload.total;

        // append if offset > 0 (pagination); otherwise replace
        const offset = action.meta.arg.offset ?? 0;
        if (offset > 0) {
          const existing = new Set(state.submissions.map((s) => s.id));
          for (const item of action.payload.items) {
            if (!existing.has(item.id)) state.submissions.push(item);
          }
        } else {
          state.submissions = action.payload.items;
        }
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
        const id = action.meta.arg.submissionId;
        const before = state.submissions.length;
        state.submissions = state.submissions.filter((s) => s.id !== id);
        const removed = before !== state.submissions.length;
        if (removed && typeof state.total === 'number' && state.total > 0) state.total -= 1;
      })
      // rejectSubmission
      .addCase(rejectSubmission.fulfilled, (state, action) => {
        const id = action.meta.arg.submissionId;
        const before = state.submissions.length;
        state.submissions = state.submissions.filter((s) => s.id !== id);
        const removed = before !== state.submissions.length;
        if (removed && typeof state.total === 'number' && state.total > 0) state.total -= 1;
      })
      // needsChangesSubmission
      .addCase(needsChangesSubmission.fulfilled, (state, action) => {
        const id = action.meta.arg.submissionId;
        const before = state.submissions.length;
        state.submissions = state.submissions.filter((s) => s.id !== id);
        const removed = before !== state.submissions.length;
        if (removed && typeof state.total === 'number' && state.total > 0) state.total -= 1;
      });
  },
});

export const {
  clearError,
  removeSubmission,
  submissionCreated,
  submissionApproved,
  submissionRejected,
  submissionNeedsChanges,
  submissionResubmitted,
} = submissionsSlice.actions;
export default submissionsSlice.reducer;

