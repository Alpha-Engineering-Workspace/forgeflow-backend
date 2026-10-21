import { WorkspaceError } from '../workspaces/workspace.errors.js';
import { issueId, issueCreate, issueUpdate, issueDelete, issueList } from './issue.schema.js';

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new WorkspaceError(400, 'VALIDATION_ERROR', 'Invalid issue request');
  return result.data;
}

export function createIssueController(service) {
  const ids = (req) => ({
    workspaceId: parse(issueId, req.params.workspaceId),
    projectId: parse(issueId, req.params.projectId),
    issueId: req.params.issueId ? parse(issueId, req.params.issueId) : undefined,
  });
  return {
    create: async (req, res) => {
      const { workspaceId, projectId } = ids(req);
      res.status(201).json({ issue: await service.create(req.userId, workspaceId, projectId, parse(issueCreate, req.body)) });
    },
    list: async (req, res) => {
      const { workspaceId, projectId } = ids(req);
      res.json(await service.list(req.userId, workspaceId, projectId, parse(issueList, req.query)));
    },
    get: async (req, res) => {
      const { workspaceId, projectId, issueId: id } = ids(req);
      res.json({ issue: await service.get(req.userId, workspaceId, projectId, id) });
    },
    update: async (req, res) => {
      const { workspaceId, projectId, issueId: id } = ids(req);
      res.json({ issue: await service.update(req.userId, workspaceId, projectId, id, parse(issueUpdate, req.body)) });
    },
    remove: async (req, res) => {
      const { workspaceId, projectId, issueId: id } = ids(req);
      await service.remove(req.userId, workspaceId, projectId, id, parse(issueDelete, req.body).expectedVersion);
      res.status(204).end();
    },
  };
}
