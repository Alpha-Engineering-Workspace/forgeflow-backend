// M7: Issue records belong to Core and are always scoped by workspace and project.
// board_position is intentionally nullable until the persisted Kanban migration in M8.
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE core.issues (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      project_id UUID NOT NULL,
      title VARCHAR(200) NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
      description VARCHAR(4000) NOT NULL DEFAULT '',
      type VARCHAR(10) NOT NULL DEFAULT 'TASK'
        CHECK (type IN ('TASK', 'BUG', 'FEATURE')),
      status VARCHAR(20) NOT NULL DEFAULT 'TODO'
        CHECK (status IN ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE')),
      priority VARCHAR(10) NOT NULL DEFAULT 'MEDIUM'
        CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
      assignee_user_id UUID,
      created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      board_position BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      CONSTRAINT issues_project_tenant_fk FOREIGN KEY (workspace_id, project_id)
        REFERENCES core.projects(workspace_id, id) ON DELETE CASCADE,
      CONSTRAINT issues_assignee_tenant_fk FOREIGN KEY (workspace_id, assignee_user_id)
        REFERENCES core.workspace_members(workspace_id, user_id)
        ON DELETE SET NULL (assignee_user_id)
    );
    CREATE INDEX core_issues_project_list_idx
      ON core.issues (workspace_id, project_id, created_at DESC, id DESC)
      WHERE deleted_at IS NULL;
    CREATE INDEX core_issues_project_status_idx
      ON core.issues (workspace_id, project_id, status, priority, created_at DESC)
      WHERE deleted_at IS NULL;
    CREATE INDEX core_issues_assignee_idx
      ON core.issues (workspace_id, assignee_user_id)
      WHERE deleted_at IS NULL AND assignee_user_id IS NOT NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP TABLE core.issues');
};
