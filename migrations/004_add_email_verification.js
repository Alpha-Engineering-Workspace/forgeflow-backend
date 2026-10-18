// Previously registered accounts remain unverified until mailbox ownership is proven.
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE auth.users ADD COLUMN email_verified_at TIMESTAMPTZ;
    CREATE TABLE auth.email_verification_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      CONSTRAINT verification_expiry_valid CHECK (expires_at > created_at)
    );
    CREATE INDEX email_verification_user_idx ON auth.email_verification_tokens(user_id);
  `);
};
export const down = (pgm) => {
  pgm.sql('DROP TABLE auth.email_verification_tokens');
  pgm.sql('ALTER TABLE auth.users DROP COLUMN email_verified_at');
};
