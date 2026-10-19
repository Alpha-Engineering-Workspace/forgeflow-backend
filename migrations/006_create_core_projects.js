// M6: projects belong to Core; never move this migration into Auth.
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE core.projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES core.workspaces(id) ON DELETE RESTRICT,
      name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
      description VARCHAR(2000) NOT NULL DEFAULT '',
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      archived_at TIMESTAMPTZ,
      CONSTRAINT project_archive_state CHECK (
        (status = 'ACTIVE' AND archived_at IS NULL) OR
        (status = 'ARCHIVED' AND archived_at IS NOT NULL)
      ),
      UNIQUE (workspace_id, id)
    );
    CREATE INDEX core_projects_workspace_status_idx ON core.projects(workspace_id, status, created_at DESC, id DESC);
  `);
};

export const down = (pgm) => { pgm.sql('DROP TABLE core.projects'); };
