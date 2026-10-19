// The Core service owns these tables; auth.users remains owned by Auth.
// One shared DB is an intentional MVP coupling, NOT independent storage.
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE core.workspaces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(120) NOT NULL,
      created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT workspace_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 120)
    );
    CREATE TABLE core.workspace_members (
      workspace_id UUID NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
      role VARCHAR(10) NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE UNIQUE INDEX workspace_single_owner ON core.workspace_members(workspace_id)
      WHERE role = 'OWNER';
    CREATE INDEX workspace_members_user_idx ON core.workspace_members(user_id, workspace_id);
    CREATE INDEX workspace_created_by_idx ON core.workspaces(created_by);
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP TABLE core.workspace_members');
  pgm.sql('DROP TABLE core.workspaces');
};
