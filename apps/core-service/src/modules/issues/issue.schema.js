import { z } from 'zod';

export const issueId = z.uuid();
export const issueType = z.enum(['TASK', 'BUG', 'FEATURE']);
export const issueStatus = z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']);
export const issuePriority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const title = z.string().trim().min(2).max(200);
const description = z.string().trim().max(4000);

export const issueCreate = z.strictObject({
  title,
  description: description.default(''),
  type: issueType.default('TASK'),
  status: issueStatus.default('TODO'),
  priority: issuePriority.default('MEDIUM'),
  assigneeId: z.uuid().nullable().default(null),
});

export const issueUpdate = z.strictObject({
  expectedVersion: z.number().int().min(1),
  title: title.optional(),
  description: description.optional(),
  type: issueType.optional(),
  status: issueStatus.optional(),
  priority: issuePriority.optional(),
  assigneeId: z.uuid().nullable().optional(),
}).refine((value) => Object.keys(value).some((key) => key !== 'expectedVersion'), {
  message: 'At least one field must change',
});

export const issueDelete = z.strictObject({ expectedVersion: z.number().int().min(1) });
export const issueList = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: issueStatus.optional(),
  priority: issuePriority.optional(),
  type: issueType.optional(),
  assigneeId: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
