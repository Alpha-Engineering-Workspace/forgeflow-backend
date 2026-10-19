export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE core.workspace_invitations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
      email VARCHAR(254) NOT NULL CHECK (email = lower(btrim(email))),
      role VARCHAR(10) NOT NULL CHECK (role IN ('ADMIN','MEMBER')),
      token_hash CHAR(64) NOT NULL UNIQUE,
      status VARCHAR(10) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACCEPTED', 'CANCELED')),
      delivery_status VARCHAR(10) NOT NULL DEFAULT 'PENDING'
        CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED')),
      expires_at TIMESTAMPTZ NOT NULL,
      created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
      accepted_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT invitation_accept_state CHECK (
        (status='ACCEPTED' AND accepted_at IS NOT NULL AND accepted_by IS NOT NULL) OR
        (status <> 'ACCEPTED' AND accepted_at IS NULL AND accepted_by IS NULL)
      )
    );
    CREATE UNIQUE INDEX one_pending_invite_per_email
      ON core.workspace_invitations (workspace_id, email) WHERE status='PENDING';
    CREATE INDEX workspace_invites_list_idx ON core.workspace_invitations(workspace_id, created_at DESC);
  `);
};
export const down = (pgm) => { pgm.sql('DROP TABLE core.workspace_invitations'); };
