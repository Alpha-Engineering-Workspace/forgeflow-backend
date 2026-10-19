import { workspaceBodySchema, workspaceIdSchema, workspaceListSchema } from './workspace.schema.js';
import { WorkspaceError } from './workspace.errors.js';

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw new WorkspaceError(400, 'VALIDATION_ERROR', 'Invalid workspace request');
  return result.data;
}

export function createWorkspaceController(service) {
  return {
    create: async (req, res) => {
      const { name } = parse(workspaceBodySchema, req.body);
      const workspace = await service.create(req.userId, name);
      res.status(201).json({ workspace });
    },
    list: async (req, res) => {
      const { page, limit } = parse(workspaceListSchema, req.query);
      res.json(await service.list(req.userId, page, limit));
    },
    get: async (req, res) => {
      const id = parse(workspaceIdSchema, req.params.workspaceId);
      res.json({ workspace: await service.get(req.userId, id) });
    },
    rename: async (req, res) => {
      const id = parse(workspaceIdSchema, req.params.workspaceId);
      const { name } = parse(workspaceBodySchema, req.body);
      res.json({ workspace: await service.rename(req.userId, id, name) });
    },
    members: async (req, res) => {
      const id = parse(workspaceIdSchema, req.params.workspaceId);
      res.json({ members: await service.members(req.userId, id) });
    },
  };
}
