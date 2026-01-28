import { z } from 'zod';
import { createSuccessSchema } from '../../common/responses';

export const DockTokenDataSchema = z.object({
  token: z.string(),
  dockUrl: z.string(),
  expiresIn: z.string(),
  message: z.string().optional(),
});

export const GetDockTokenResponseSchema = createSuccessSchema(DockTokenDataSchema);
export const RotateDockTokenResponseSchema = createSuccessSchema(DockTokenDataSchema);

export type DockTokenData = z.infer<typeof DockTokenDataSchema>;
export type GetDockTokenResponse = z.infer<typeof GetDockTokenResponseSchema>;
export type RotateDockTokenResponse = z.infer<typeof RotateDockTokenResponseSchema>;
