export type SubmitModalBlockedReason = null | 'disabled' | 'offline';

export type SubmitMode = 'upload' | 'import';

export type UploadStatus = 'idle' | 'selecting' | 'uploading' | 'success' | 'error';

export type SubmitModalFormData = {
  title: string;
  sourceUrl: string;
  tags: string[];
};

export type SubmitModalProps = {
  isOpen: boolean;
  onClose: () => void;
  channelSlug?: string;
  channelId?: string;
  initialBlockedReason?: SubmitModalBlockedReason;
};
