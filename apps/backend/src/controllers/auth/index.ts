import { initiateAuth, initiateTwitchAuth } from './initiateAuth.js';
import { initiateLink, initiateYouTubeForceSslLink } from './initiateLink.js';
import { handleCallback, handleLinkCallback, handleTwitchCallback } from './callback/handleCallback.js';
import { completeBetaAuth, listAccounts, logout, unlinkAccount } from './accounts.js';

export const authController = {
  initiateAuth,
  initiateYouTubeForceSslLink,
  initiateTwitchAuth,
  handleCallback,
  handleTwitchCallback,
  initiateLink,
  handleLinkCallback,
  listAccounts,
  unlinkAccount,
  logout,
  completeBetaAuth,
};
