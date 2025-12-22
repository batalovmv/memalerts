import * as create from './submission/createSubmission.js';
import * as mine from './submission/getMySubmissions.js';
import * as imp from './submission/importMeme.js';

// Back-compat facade: keep `submissionController` shape stable for routes.
export const submissionController = {
  ...create,
  ...mine,
  ...imp,
};


