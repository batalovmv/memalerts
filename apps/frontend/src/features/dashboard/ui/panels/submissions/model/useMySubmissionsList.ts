import { useMemo } from 'react';

import type { MySubmission } from '@/features/submit/types';

export function useMySubmissionsList(mySubmissions: MySubmission[]) {
  const myActive = useMemo(
    () => mySubmissions.filter((s) => s.status === 'pending' || s.status === 'needs_changes'),
    [mySubmissions],
  );

  const myCount = myActive.length;

  const mySorted = useMemo(() => {
    const byTime = (a: MySubmission, b: MySubmission) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    const needs = myActive.filter((s) => s.status === 'needs_changes').sort(byTime);
    const rest = myActive.filter((s) => s.status !== 'needs_changes').sort(byTime);
    return [...needs, ...rest];
  }, [myActive]);

  return { myActive, myCount, mySorted };
}
