import type { MemeListItem } from '@memalerts/api-contracts';

export type MemeCardItem = Omit<
  MemeListItem,
  'previewUrl' | 'variants' | 'activationsCount' | 'createdAt' | 'type'
> & {
  type: MemeListItem['type'] | 'gif';
  previewUrl?: string | null;
  variants?: MemeListItem['variants'];
  activationsCount?: number;
};
