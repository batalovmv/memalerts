import { createSelector } from '@reduxjs/toolkit';

import type { RootState } from './index';

export const selectAuthState = (s: RootState) => s.auth;
export const selectUser = (s: RootState) => s.auth.user;
export const selectAuthLoading = (s: RootState) => s.auth.loading;
export const selectAuthError = (s: RootState) => s.auth.error;

export const selectMemesState = (s: RootState) => s.memes;
export const selectMemes = (s: RootState) => s.memes.memes;
export const selectMemesLoading = (s: RootState) => s.memes.loading;
export const selectMemesError = (s: RootState) => s.memes.error;

export const selectSubmissionsState = (s: RootState) => s.submissions;
export const selectSubmissions = (s: RootState) => s.submissions.submissions;
export const selectSubmissionsLoading = (s: RootState) => s.submissions.loading;
export const selectSubmissionsLoadingMore = (s: RootState) => s.submissions.loadingMore;
export const selectSubmissionsError = (s: RootState) => s.submissions.error;
export const selectSubmissionsTotal = (s: RootState) => s.submissions.total;

export const selectPendingSubmissions = createSelector([selectSubmissions], (items) =>
  items.filter((s) => s.status === 'pending'),
);

export const selectPendingSubmissionsCount = createSelector([selectPendingSubmissions], (items) => items.length);


