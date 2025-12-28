import * as create from './submission/createSubmission.js';
import * as mine from './submission/getMySubmissions.js';
import * as imp from './submission/importMeme.js';
import * as resub from './submission/resubmitSubmission.js';
import * as pool from './submission/createPoolSubmission.js';

// Back-compat facade: keep `submissionController` shape stable for routes.
export const submissionController = {
  ...create,
  ...pool,
  ...mine,
  ...imp,
  ...resub,
};


