export type StoredObject = {
  /** Publicly reachable URL or path stored in DB (e.g. "/uploads/memes/..." or "https://cdn/..."). */
  publicPath: string;
  /** Optional opaque key (S3 object key, etc). */
  key?: string;
};

export type StoreFromTempArgs = {
  tempFilePath: string;
  hash: string;
  extWithDot: string;
  mimeType?: string | null;
};

export interface StorageProvider {
  kind: 'local' | 's3';

  storeMemeFromTemp(args: StoreFromTempArgs): Promise<StoredObject>;

  /**
   * Delete by stored public path. Best-effort (used for reference counting cleanup).
   * Implementations must be safe against path traversal.
   */
  deleteByPublicPath(publicPath: string): Promise<void>;
}


