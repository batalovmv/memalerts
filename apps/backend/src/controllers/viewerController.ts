import * as channel from './viewer/channel.js';
import * as me from './viewer/me.js';
import * as wallet from './viewer/wallet.js';
import * as memes from './viewer/memes.js';
import * as search from './viewer/search.js';
import * as pool from './viewer/pool.js';
import * as stats from './viewer/stats.js';
import * as activation from './viewer/activation.js';
import * as preferences from './viewer/preferences.js';
import * as tasteProfile from './viewer/tasteProfile.js';
import * as personalizedMemes from './viewer/personalizedMemes.js';
import * as memeLists from './viewer/memeLists.js';
import * as bonuses from './viewer/bonuses.js';
import * as achievements from './viewer/achievements.js';
import * as votes from './viewer/voteController.js';
import * as wheel from './viewer/wheelController.js';

// Back-compat facade: keep `viewerController` shape stable for routes.
export const viewerController = {
  ...channel,
  ...me,
  ...wallet,
  ...memes,
  ...search,
  ...pool,
  ...stats,
  ...activation,
  ...preferences,
  ...tasteProfile,
  ...personalizedMemes,
  ...memeLists,
  ...bonuses,
  ...achievements,
  ...votes,
  ...wheel,
};
