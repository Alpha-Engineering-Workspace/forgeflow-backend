import { z } from 'zod';

export const workspaceIdSchema = z.uuid();
export const workspaceBodySchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
});
export const workspaceListSchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
