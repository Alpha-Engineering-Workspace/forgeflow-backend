import { z } from 'zod';
export const invitationId = z.uuid();
export const inviteCreate = z.strictObject({
  email: z.email().trim().toLowerCase().max(254),
  role: z.enum(['ADMIN', 'MEMBER']),
});
export const inviteAccept = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const roleUpdate = z.strictObject({ role: z.enum(['ADMIN', 'MEMBER']) });
