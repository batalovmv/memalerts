import * as channel from './viewer/channel.js';
import * as me from './viewer/me.js';
import * as wallet from './viewer/wallet.js';
import * as memes from './viewer/memes.js';
import * as search from './viewer/search.js';
import * as stats from './viewer/stats.js';
import * as activation from './viewer/activation.js';

// Back-compat facade: keep `viewerController` shape stable for routes.
export const viewerController = {
  ...channel,
  ...me,
  ...wallet,
  ...memes,
  ...search,
  ...stats,
  ...activation,
};

 