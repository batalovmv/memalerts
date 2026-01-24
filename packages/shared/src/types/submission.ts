import type {
  MemeType,
  SubmissionAiDecision,
  SubmissionAiStatus,
  SubmissionSourceKind,
  SubmissionStatus,
} from './common';
import type { Tag } from './meme';

export interface Submission {
  id: string;
  title: string;
  type: MemeType;
  fileUrlTemp: string;
  /**
   * SHA-256 hash for dedup/linking with MemeAsset/quarantine.
   * Optional for backward compatibility with older backends/endpoints.
   */
  fileHash?: string | null;
  /**
   * Best-effort media duration (ms). Optional for backward compatibility.
   */
  durationMs?: number | null;
  /**
   * Best-effort upload metadata. Optional.
   */
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  sourceUrl?: string | null;
  notes: string | null;
  status: SubmissionStatus;
  sourceKind?: SubmissionSourceKind;
  memeAssetId?: string | null;
  moderatorNotes?: string | null;
  revision?: number; // number of resubmits after "needs_changes" (0..2)
  tags?: Array<{ tag: Tag }>;
  /**
   * Async AI moderation fields (may be missing if backend doesn't include them in this endpoint).
   */
  aiStatus?: SubmissionAiStatus | null;
  aiDecision?: SubmissionAiDecision | null;
  aiRiskScore?: number | null; // 0..1
  aiLabelsJson?: string[] | null;
  aiTranscript?: string | null;
  aiAutoTagNamesJson?: string[] | null;
  aiAutoDescription?: string | null;
  aiModelVersionsJson?: Record<string, unknown> | null;
  aiCompletedAt?: string | null;
  aiLastTriedAt?: string | null;
  aiRetryCount?: number | null;
  aiNextRetryAt?: string | null;
  aiError?: string | null;
  aiLockExpiresAt?: string | null;
  aiProcessingStartedAt?: string | null;
  submitter: {
    id: string;
    displayName: string;
  };
  createdAt: string;
  updatedAt?: string;
}
