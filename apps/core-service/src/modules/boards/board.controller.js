import { WorkspaceError } from '../workspaces/workspace.errors.js';
import { issueId } from '../issues/issue.schema.js';
import { boardMove } from './board.schema.js';

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new WorkspaceError(400, 'VALIDATION_ERROR', 'Invalid board request');
  return result.data;
}
export function createBoardController(service) {
  function ids(req) {
    return { workspaceId: parse(issueId, req.params.workspaceId),
      projectId: parse(issueId, req.params.projectId) };
  }
  return {
    get: async (req, res) => {
      const { workspaceId, projectId } = ids(req);
      res.set('Cache-Control', 'no-store');
      res.json(await service.get(req.userId, workspaceId, projectId));
    },
    move: async (req, res) => {
      const { workspaceId, projectId } = ids(req);
      res.json(await service.move(req.userId, workspaceId, projectId, parse(boardMove, req.body)));
    },
  };
}
