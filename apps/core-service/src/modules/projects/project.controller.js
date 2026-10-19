import { WorkspaceError } from '../workspaces/workspace.errors.js';
import { projectId, projectCreate, projectUpdate, projectArchive, projectList } from './project.schema.js';

function parse(schema, data) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new WorkspaceError(400, 'VALIDATION_ERROR', 'Invalid project request');
  return parsed.data;
}
export function createProjectController(service) {
  const ids = (req) => ({ workspaceId: parse(projectId, req.params.workspaceId),
    projectId: req.params.projectId ? parse(projectId, req.params.projectId) : undefined });
  return {
    create: async (req, res) => {
      const { workspaceId } = ids(req);
      res.status(201).json({ project: await service.create(req.userId, workspaceId, parse(projectCreate, req.body)) });
    },
    list: async (req, res) => {
      const { workspaceId } = ids(req);
      res.json(await service.list(req.userId, workspaceId, parse(projectList, req.query)));
    },
    get: async (req, res) => {
      const { workspaceId, projectId: id } = ids(req);
      res.json({ project: await service.get(req.userId, workspaceId, id) });
    },
    update: async (req, res) => {
      const { workspaceId, projectId: id } = ids(req);
      res.json({ project: await service.update(req.userId, workspaceId, id, parse(projectUpdate, req.body)) });
    },
    archive: async (req, res) => {
      const { workspaceId, projectId: id } = ids(req);
      res.json({ project: await service.archive(req.userId, workspaceId, id, parse(projectArchive, req.body).expectedVersion) });
    },
  };
}
