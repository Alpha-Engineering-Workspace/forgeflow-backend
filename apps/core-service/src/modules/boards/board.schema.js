import { z } from 'zod';
import { issueStatus } from '../issues/issue.schema.js';

export const boardMove = z.strictObject({
  issueId: z.uuid(),
  toStatus: issueStatus,
  // Zero-based destination index, measured AFTER removing the moving card.
  targetIndex: z.number().int().nonnegative(),
  expectedBoardVersion: z.number().int().min(1),
  expectedIssueVersion: z.number().int().min(1),
});
