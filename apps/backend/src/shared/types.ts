export type UserRole = 'viewer' | 'streamer' | 'admin';

export type MemeType = 'image' | 'gif' | 'video' | 'audio';

export type MemeStatus = 'pending' | 'approved' | 'rejected';

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export type ActivationStatus = 'queued' | 'playing' | 'done' | 'failed';

export type RedemptionStatus = 'pending' | 'completed' | 'failed';

export interface Channel {
  id: string;
  twitchChannelId: string;
  slug: string;
  name: string;
  rewardIdForCoins: string | null;
  coinPerPointRatio: number;
  createdAt: Date;
}

export interface User {
  id: string;
  twitchUserId: string;
  displayName: string;
  role: UserRole;
  channelId: string | null;
  createdAt: Date;
}

export interface Wallet {
  id: string;
  userId: string;
  balance: number;
  updatedAt: Date;
}

export interface Meme {
  id: string;
  channelId: string;
  title: string;
  type: MemeType;
  fileUrl: string;
  durationMs: number;
  priceCoins: number;
  status: MemeStatus;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  createdAt: Date;
}

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

export interface AuditLog {
  id: string;
  actorId: string | null;
  channelId: string;
  action: string;
  payloadJson: string;
  createdAt: Date;
}


