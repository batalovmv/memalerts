/** @deprecated Import from '@memalerts/shared' instead */
export type {
  AuditLog,
  Channel,
  Meme,
  MemeStatus,
  MemeType,
  SubmissionStatus,
  User,
  UserRole,
  Wallet,
} from '../../../packages/shared/src/types';

export type ActivationStatus = 'queued' | 'playing' | 'done' | 'failed';
export type RedemptionStatus = 'pending' | 'completed' | 'failed';

export interface MemeSubmission {
  id: string;
  channelId: string;
  submitterUserId: string;
  title: string;
  type: MemeType;
  fileUrlTemp: string;
  notes: string | null;
  status: SubmissionStatus;
  moderatorNotes: string | null;
  createdAt: Date;
}

export interface Redemption {
  id: string;
  channelId: string;
  userId: string;
  twitchRedemptionId: string;
  pointsSpent: number;
  coinsGranted: number;
  status: RedemptionStatus;
  createdAt: Date;
}

export interface MemeActivation {
  id: string;
  channelId: string;
  userId: string;
  memeId: string;
  coinsSpent: number;
  status: ActivationStatus;
  createdAt: Date;
}
