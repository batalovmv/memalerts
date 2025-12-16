export type UserRole = 'viewer' | 'streamer' | 'admin';

export interface Wallet {
  id: string;
  userId: string;
  channelId: string;
  balance: number;
  updatedAt?: string;
}

export interface Channel {
  id: string;
  slug: string;
  name: string;
}

export interface User {
  id: string;
  displayName: string;
  role: UserRole;
  channelId: string | null;
  channel?: Channel;
  wallets?: Wallet[];
}

export type MemeType = 'image' | 'gif' | 'video' | 'audio';

export type MemeStatus = 'active' | 'inactive' | 'pending';

export interface Meme {
  id: string;
  title: string;
  type: MemeType;
  fileUrl: string;
  priceCoins: number;
  durationMs: number;
  status?: MemeStatus;
  channelId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface Submission {
  id: string;
  title: string;
  type: MemeType;
  fileUrlTemp: string;
  notes: string | null;
  status: SubmissionStatus;
  moderatorNotes?: string | null;
  submitter: {
    id: string;
    displayName: string;
  };
  createdAt: string;
}

export interface ApiError {
  message: string;
  error?: string;
  statusCode?: number;
}

