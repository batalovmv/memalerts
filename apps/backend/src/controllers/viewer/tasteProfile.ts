import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { TasteProfileService } from '../../services/taste/TasteProfileService.js';

const MIN_TASTE_ACTIVATIONS = 5;

export const getTasteProfile = async (req: AuthRequest, res: Response) => {
  const profile = await TasteProfileService.getProfile(req.userId!);
  if (!profile) {
    return res.json({
      totalActivations: 0,
      lastActivationAt: null,
      topTags: [],
      categoryWeights: {},
      profileReady: false,
    });
  }

  const profileReady = profile.totalActivations >= MIN_TASTE_ACTIVATIONS;

  return res.json({
    totalActivations: profile.totalActivations,
    lastActivationAt: profile.lastActivationAt,
    topTags: profile.topTags,
    categoryWeights: profile.categoryWeights,
    profileReady,
  });
};
