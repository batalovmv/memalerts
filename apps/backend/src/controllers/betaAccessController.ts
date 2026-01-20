import { requestAccess, getStatus } from './betaAccess/betaAccessRequests.js';
import {
  approveRequest,
  getAllRequests,
  getGrantedUsers,
  getRevokedUsers,
  rejectRequest,
  restoreUserAccess,
  revokeUserAccess,
} from './betaAccess/betaAccessAdmin.js';

export const betaAccessController = {
  requestAccess,
  getStatus,
  getAllRequests,
  approveRequest,
  rejectRequest,
  getGrantedUsers,
  getRevokedUsers,
  revokeUserAccess,
  restoreUserAccess,
};
