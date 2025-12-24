import * as twitch from './admin/twitch.js';
import * as overlay from './admin/overlay.js';
import * as overlayPresets from './admin/overlayPresets.js';
import * as creditsOverlay from './admin/creditsOverlay.js';
import * as submissions from './admin/submissions.js';
import * as memes from './admin/memes.js';
import * as settings from './admin/channelSettings.js';
import * as wallet from './admin/wallet.js';
import * as promotions from './admin/promotions.js';
import * as stats from './admin/stats.js';

// Back-compat facade: keep `adminController` shape stable for routes.
export const adminController = {
  ...twitch,
  ...overlay,
  ...overlayPresets,
  ...creditsOverlay,
  ...submissions,
  ...memes,
  ...settings,
  ...wallet,
  ...promotions,
  ...stats,
};


