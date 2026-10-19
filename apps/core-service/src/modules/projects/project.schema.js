import { z } from 'zod';

export const projectId = z.uuid();
export const projectCreate = z.strictObject({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(''),
});
export const projectUpdate = z.strictObject({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000),
  expectedVersion: z.number().int().min(1),
});
export const projectArchive = z.strictObject({ expectedVersion: z.number().int().min(1) });
export const projectList = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE'),
});
