// 002 already owns auth.users. Never edit an applied migration.
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE auth.refresh_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      family_id UUID NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      rotated_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      replaced_by UUID REFERENCES auth.refresh_sessions(id),
      CONSTRAINT refresh_expiry_valid CHECK (expires_at > created_at)
    );
    CREATE INDEX refresh_sessions_user_idx ON auth.refresh_sessions(user_id);
    CREATE INDEX refresh_sessions_family_idx ON auth.refresh_sessions(family_id);

    CREATE TABLE auth.password_resets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      CONSTRAINT reset_expiry_valid CHECK (expires_at > created_at)
    );
    CREATE INDEX password_resets_user_idx ON auth.password_resets(user_id);
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP TABLE auth.password_resets');
  pgm.sql('DROP TABLE auth.refresh_sessions');
};
