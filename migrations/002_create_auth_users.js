export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      name VARCHAR(120) NOT NULL,
      email VARCHAR(254) NOT NULL,
      password_hash TEXT NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT users_name_not_blank
        CHECK (length(btrim(name)) > 0),

      CONSTRAINT users_email_canonical
        CHECK (
          email = lower(btrim(email))
          AND length(email) > 0
        ),

      CONSTRAINT users_password_hash_not_blank
        CHECK (length(btrim(password_hash)) > 0),

      CONSTRAINT users_email_unique
        UNIQUE (email)
    );
  `);
};

export const down = (pgm) => {
  pgm.sql("DROP TABLE auth.users");
};
