package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrProjectNotFound = errors.New("project not found")
)

type RevisionConflictError struct {
	ID       string
	Expected int
	Current  int
}

func (e *RevisionConflictError) Error() string {
	return fmt.Sprintf("project %s expected revision %d, current revision %d", e.ID, e.Expected, e.Current)
}

type Project struct {
	ID                     string
	Name                   string
	SourceImageKey         string
	SourceImageContentType string
	SourceImageSize        int64
	Document               json.RawMessage
	Revision               int
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

type ProjectRepository interface {
	InitializeSchema(ctx context.Context) error
	Create(ctx context.Context, id, capabilityHash, name, sourceImageKey, sourceImageContentType string, sourceImageSize int64, document json.RawMessage) (Project, error)
	Get(ctx context.Context, id, capabilityHash string) (Project, error)
	Update(ctx context.Context, id, capabilityHash string, expectedRevision int, name string, document json.RawMessage) (Project, error)
	RecoverLegacy(ctx context.Context, id, capabilityHash, actor string) (Project, error)
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(ctx context.Context, databaseURL string) (*PostgresRepository, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	return &PostgresRepository{pool: pool}, nil
}

func (r *PostgresRepository) Close() {
	r.pool.Close()
}

func (r *PostgresRepository) InitializeSchema(ctx context.Context) error {
	const schemaSQL = `
CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    source_image_key text NOT NULL UNIQUE,
    source_image_content_type text NOT NULL,
    source_image_size bigint NOT NULL CHECK (source_image_size > 0),
    document jsonb NOT NULL,
    revision integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('UTC', now())
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS capability_hash text;

-- Legacy rows retain NULL until an authorized one-time recovery claim. Never
-- overwrite them with an unrecoverable random digest.
CREATE TABLE IF NOT EXISTS legacy_project_recovery_audit (
    project_id uuid PRIMARY KEY REFERENCES projects(id),
    recovered_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    actor text NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_capability_hash_format'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects ADD CONSTRAINT projects_capability_hash_format CHECK (capability_hash ~ '^[0-9a-f]{64}$');
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS projects_updated_at_idx ON projects (updated_at DESC);
`
	if _, err := r.pool.Exec(ctx, schemaSQL); err != nil {
		return err
	}

	if _, err := r.pool.Exec(ctx, `CREATE OR REPLACE FUNCTION project_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
   NEW.updated_at = timezone('UTC', now());
   RETURN NEW;
END;
$$;`); err != nil {
		return err
	}

	if _, err := r.pool.Exec(ctx, `DROP TRIGGER IF EXISTS set_projects_updated_at ON projects;`); err != nil {
		return err
	}

	_, err := r.pool.Exec(ctx, `CREATE TRIGGER set_projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW
EXECUTE PROCEDURE project_touch_updated_at();`)
	return err
}

func (r *PostgresRepository) Create(ctx context.Context, id, capabilityHash, name, sourceImageKey, sourceImageContentType string, sourceImageSize int64, document json.RawMessage) (Project, error) {
	var created Project
	row := r.pool.QueryRow(ctx, `
INSERT INTO projects (id, capability_hash, name, source_image_key, source_image_content_type, source_image_size, document)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, name, source_image_key, source_image_content_type, source_image_size, revision, created_at, updated_at;`,
		id,
		capabilityHash,
		name,
		sourceImageKey,
		sourceImageContentType,
		sourceImageSize,
		document,
	)
	err := row.Scan(&created.ID, &created.Name, &created.SourceImageKey, &created.SourceImageContentType, &created.SourceImageSize, &created.Revision, &created.CreatedAt, &created.UpdatedAt)
	if err != nil {
		return Project{}, fmt.Errorf("insert project: %w", err)
	}
	created.Document = projectJSONCopy(document)
	return normalizeProjectTimes(created), nil
}

func (r *PostgresRepository) Get(ctx context.Context, id, capabilityHash string) (Project, error) {
	var project Project
	row := r.pool.QueryRow(ctx, `
SELECT id, name, source_image_key, source_image_content_type, source_image_size, revision, document, created_at, updated_at
FROM projects
WHERE id = $1 AND capability_hash = $2;
`, id, capabilityHash)
	err := row.Scan(&project.ID, &project.Name, &project.SourceImageKey, &project.SourceImageContentType, &project.SourceImageSize, &project.Revision, &project.Document, &project.CreatedAt, &project.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Project{}, ErrProjectNotFound
		}
		return Project{}, fmt.Errorf("select project: %w", err)
	}
	return normalizeProjectTimes(project), nil
}

func (r *PostgresRepository) Update(ctx context.Context, id, capabilityHash string, expectedRevision int, name string, document json.RawMessage) (Project, error) {
	var updated Project
	row := r.pool.QueryRow(ctx, `
UPDATE projects
SET name = $2,
    document = $3,
    revision = revision + 1
WHERE id = $1 AND revision = $4 AND capability_hash = $5
RETURNING id, name, source_image_key, source_image_content_type, source_image_size, revision, created_at, updated_at;`,
		id,
		name,
		document,
		expectedRevision,
		capabilityHash,
	)
	err := row.Scan(&updated.ID, &updated.Name, &updated.SourceImageKey, &updated.SourceImageContentType, &updated.SourceImageSize, &updated.Revision, &updated.CreatedAt, &updated.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var current int
			errFound := r.pool.QueryRow(ctx, `SELECT revision FROM projects WHERE id = $1 AND capability_hash = $2;`, id, capabilityHash).Scan(&current)
			if errFound == nil {
				return Project{}, &RevisionConflictError{ID: id, Expected: expectedRevision, Current: current}
			}
			if errors.Is(errFound, pgx.ErrNoRows) {
				return Project{}, ErrProjectNotFound
			}
			return Project{}, fmt.Errorf("select revision: %w", errFound)
		}
		return Project{}, fmt.Errorf("update project: %w", err)
	}
	updated.Document = projectJSONCopy(document)
	return normalizeProjectTimes(updated), nil
}

func (r *PostgresRepository) RecoverLegacy(ctx context.Context, id, capabilityHash, actor string) (Project, error) {
	var recovered Project
	err := r.pool.QueryRow(ctx, `
WITH claimed AS (
  UPDATE projects SET capability_hash = $2 WHERE id = $1 AND capability_hash IS NULL
  RETURNING id, name, source_image_key, source_image_content_type, source_image_size, revision, document, created_at, updated_at
), audit AS (
  INSERT INTO legacy_project_recovery_audit (project_id, actor) SELECT id, $3 FROM claimed
)
SELECT id, name, source_image_key, source_image_content_type, source_image_size, revision, document, created_at, updated_at FROM claimed;`, id, capabilityHash, actor).Scan(&recovered.ID, &recovered.Name, &recovered.SourceImageKey, &recovered.SourceImageContentType, &recovered.SourceImageSize, &recovered.Revision, &recovered.Document, &recovered.CreatedAt, &recovered.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Project{}, ErrProjectNotFound
	}
	if err != nil {
		return Project{}, fmt.Errorf("recover legacy project: %w", err)
	}
	return normalizeProjectTimes(recovered), nil
}

func normalizeProjectTimes(project Project) Project {
	project.CreatedAt = project.CreatedAt.UTC()
	project.UpdatedAt = project.UpdatedAt.UTC()
	return project
}

func projectJSONCopy(document json.RawMessage) json.RawMessage {
	copied := make(json.RawMessage, len(document))
	copy(copied, document)
	return copied
}
