import { describe, expect, it } from 'vitest';

import reducer, {
  fetchSubmissions,
  removeSubmission,
  submissionApproved,
  submissionCreated,
  submissionNeedsChanges,
  submissionRejected,
  submissionResubmitted,
} from './submissionsSlice';

import type { Submission } from '@/types';

function makeSubmission(id: string): Submission {
  return {
    id,
    title: `S ${id}`,
    type: 'video',
    fileUrlTemp: '',
    status: 'pending',
    notes: null,
    createdAt: new Date().toISOString(),
    submitter: { id: 'u', displayName: 'U' },
    revision: 0,
  };
}

describe('submissionsSlice reducer', () => {
  it('has expected initial state', () => {
    const state = reducer(undefined, { type: 'init' });
    expect(state).toMatchObject({
      submissions: [],
      loading: false,
      loadingMore: false,
      error: null,
      lastFetchedAt: null,
      lastErrorAt: null,
      total: null,
    });
  });

  it('removeSubmission removes by id', () => {
    const prev = reducer(undefined, { type: 'init' });
    const seeded = { ...prev, submissions: [makeSubmission('s1'), makeSubmission('s2')] };
    const next = reducer(seeded, removeSubmission('s1'));
    expect(next.submissions.map((s) => s.id)).toEqual(['s2']);
  });

  it('socket submissionCreated adds placeholder and increments total', () => {
    const prev = reducer(undefined, { type: 'init' });
    const seeded = { ...prev, total: 1 };
    const next = reducer(seeded, submissionCreated({ submissionId: 's1', channelId: 'c1', submitterId: 'u1' }));
    expect(next.total).toBe(2);
    expect(next.submissions[0]).toMatchObject({ id: 's1', status: 'pending' });
  });

  it('socket submissionCreated does not duplicate items', () => {
    const prev = reducer(undefined, { type: 'init' });
    const seeded = { ...prev, total: 1, submissions: [makeSubmission('s1')] };
    const next = reducer(seeded, submissionCreated({ submissionId: 's1', channelId: 'c1', submitterId: 'u1' }));
    expect(next.submissions.length).toBe(1);
    expect(next.total).toBe(1);
  });

  it('socket submissionApproved/rejected/needsChanges remove item and decrement total when possible', () => {
    const prev = reducer(undefined, { type: 'init' });
    const seeded = { ...prev, total: 2, submissions: [makeSubmission('s1'), makeSubmission('s2')] };

    const a = reducer(seeded, submissionApproved({ submissionId: 's1' }));
    expect(a.submissions.map((s) => s.id)).toEqual(['s2']);
    expect(a.total).toBe(1);

    const b = reducer(a, submissionRejected({ submissionId: 's2' }));
    expect(b.submissions.map((s) => s.id)).toEqual([]);
    expect(b.total).toBe(0);

    // When list is already empty, it should not decrement below 0.
    const c = reducer(b, submissionNeedsChanges({ submissionId: 'missing' }));
    expect(c.total).toBe(0);
  });

  it('socket submissionResubmitted adds placeholder and increments total', () => {
    const prev = reducer(undefined, { type: 'init' });
    const seeded = { ...prev, total: 0 };
    const next = reducer(seeded, submissionResubmitted({ submissionId: 's9', channelId: 'c1', submitterId: 'u1' }));
    expect(next.total).toBe(1);
    expect(next.submissions[0]).toMatchObject({ id: 's9', revision: 1, status: 'pending' });
  });

  it('fetchSubmissions.fulfilled replaces on first page and appends unique on next pages', () => {
    const prev = reducer(undefined, { type: 'init' });

    const page1 = reducer(
      prev,
      fetchSubmissions.fulfilled({ items: [makeSubmission('a'), makeSubmission('b')], total: 10 }, 'req1', {
        status: 'pending',
        limit: 2,
        offset: 0,
      }),
    );
    expect(page1.submissions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(page1.total).toBe(10);

    const page2 = reducer(
      page1,
      fetchSubmissions.fulfilled({ items: [makeSubmission('b'), makeSubmission('c')], total: 10 }, 'req2', {
        status: 'pending',
        limit: 2,
        offset: 2,
      }),
    );
    expect(page2.submissions.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});












