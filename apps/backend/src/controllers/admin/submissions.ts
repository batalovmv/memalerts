import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { services } from '../../services/index.js';

export const getSubmissions = async (req: AuthRequest, res: Response) =>
  services.submissions.getAdminSubmissions(req, res);

export const approveSubmission = async (req: AuthRequest, res: Response) => services.submissions.approve(req, res);

export const rejectSubmission = async (req: AuthRequest, res: Response) => services.submissions.reject(req, res);

export const needsChangesSubmission = async (req: AuthRequest, res: Response) =>
  services.submissions.needsChanges(req, res);
