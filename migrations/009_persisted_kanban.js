// M8: one authoritative board version per project; backfill deterministic lane positions.
// Additive migration: M7 issue rows stay valid and their issue versions are not changed.
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE core.projects
      ADD COLUMN board_version INTEGER NOT NULL DEFAULT 1 CHECK (board_version > 0);

    WITH ordered AS (
      SELECT id, (ROW_NUMBER() OVER (
        PARTITION BY workspace_id, project_id, status
        ORDER BY created_at ASC, id ASC
      ) - 1)::BIGINT AS position
      FROM core.issues WHERE deleted_at IS NULL
    )
    UPDATE core.issues AS i SET board_position = ordered.position
    FROM ordered WHERE i.id = ordered.id;

    CREATE INDEX core_issues_board_order_idx
      ON core.issues (workspace_id, project_id, status, board_position, id)
      WHERE deleted_at IS NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX core.core_issues_board_order_idx;
    ALTER TABLE core.projects DROP COLUMN board_version;
    UPDATE core.issues SET board_position = NULL;
  `);
};
