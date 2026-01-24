import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { overlayPresetsBodySchema, updateChannelSettingsSchema } from '../../shared/schemas.js';

export type ChannelSchemas = {
  UpdateChannelSettingsBody: ReturnType<OpenAPIRegistry['register']>;
  OverlayPresetsBody: ReturnType<OpenAPIRegistry['register']>;
};

export function registerChannelSchemas(registry: OpenAPIRegistry): ChannelSchemas {
  const UpdateChannelSettingsBody = registry.register('UpdateChannelSettingsBody', updateChannelSettingsSchema);
  const OverlayPresetsBody = registry.register('OverlayPresetsBody', overlayPresetsBodySchema);
  return { UpdateChannelSettingsBody, OverlayPresetsBody };
}
