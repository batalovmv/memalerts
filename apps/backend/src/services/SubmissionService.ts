import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import type { SubmissionDeps } from './submission/submissionTypes.js';
import { approveSubmissionWithRepos } from './submission/submissionApprove.js';
import { createSubmissionWithRepos } from './submission/submissionCreate.js';
import { getSubmissionsWithRepos } from './submission/submissionList.js';
import { needsChangesSubmissionWithRepos } from './submission/submissionNeedsChanges.js';
import { rejectSubmissionWithRepos } from './submission/submissionReject.js';

export type { SubmissionDeps } from './submission/submissionTypes.js';
export {
  approveSubmissionWithRepos,
  createSubmissionWithRepos,
  getSubmissionsWithRepos,
  needsChangesSubmissionWithRepos,
  rejectSubmissionWithRepos,
};

export type SubmissionService = {
  create: (req: AuthRequest, res: Response) => Promise<unknown>;
  getAdminSubmissions: (req: AuthRequest, res: Response) => Promise<unknown>;
  approve: (req: AuthRequest, res: Response) => Promise<unknown>;
  reject: (req: AuthRequest, res: Response) => Promise<unknown>;
  needsChanges: (req: AuthRequest, res: Response) => Promise<unknown>;
};

export const createSubmissionService = (deps: SubmissionDeps): SubmissionService => ({
  create: (req, res) => createSubmissionWithRepos(deps, req, res),
  getAdminSubmissions: (req, res) => getSubmissionsWithRepos(deps, req, res),
  approve: (req, res) => approveSubmissionWithRepos(deps, req, res),
  reject: (req, res) => rejectSubmissionWithRepos(deps, req, res),
  needsChanges: (req, res) => needsChangesSubmissionWithRepos(deps, req, res),
});
