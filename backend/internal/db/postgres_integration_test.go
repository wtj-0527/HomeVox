package db

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/floorplan"
	"github.com/jackc/pgx/v5/pgxpool"
)

func mustTestDatabaseURL(t *testing.T) string {
	dsn := os.Getenv("HOMEVOX_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("HOMEVOX_TEST_DATABASE_URL not set; skipping integration test")
	}
	return dsn
}

func TestPostgresRepositoryLifecycle(t *testing.T) {
	dsn := mustTestDatabaseURL(t)

	ctx := context.Background()
	repo, err := NewPostgresRepository(ctx, dsn)
	if err != nil {
		t.Fatalf("new repository: %v", err)
	}
	defer repo.Close()

	if err := repo.InitializeSchema(ctx); err != nil {
		t.Fatalf("initialize schema: %v", err)
	}

	if err := truncateProjectsTable(ctx, dsn); err != nil {
		t.Fatalf("truncate table: %v", err)
	}

	doc := floorplan.ParseResult{Walls: []floorplan.Segment{{X1: 0, Y1: 0, X2: 1, Y2: 0}}}
	docJSON, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal doc: %v", err)
	}

	const capabilityHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	created, err := repo.Create(ctx, "00000000-0000-4000-8000-000000000001", capabilityHash, "Suite 1", "source/one.png", "image/png", 12, docJSON)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID != "00000000-0000-4000-8000-000000000001" {
		t.Fatalf("created ID = %s, want explicit server ID", created.ID)
	}
	if created.Revision != 1 {
		t.Fatalf("revision = %d, want 1", created.Revision)
	}
	if created.CreatedAt.Location() != time.UTC {
		t.Fatalf("created_at not UTC: %v", created.CreatedAt.Location())
	}

	got, err := repo.Get(ctx, created.ID, capabilityHash)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ID != created.ID {
		t.Fatalf("get id = %s, want %s", got.ID, created.ID)
	}
	if _, err := repo.Get(ctx, created.ID, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"); err != ErrProjectNotFound {
		t.Fatalf("wrong capability hash error = %v, want ErrProjectNotFound", err)
	}
	var storedCapabilityHash string
	if err := repo.pool.QueryRow(ctx, `SELECT capability_hash FROM projects WHERE id = $1`, created.ID).Scan(&storedCapabilityHash); err != nil {
		t.Fatalf("read stored capability hash: %v", err)
	}
	if storedCapabilityHash != capabilityHash {
		t.Fatalf("stored capability hash mismatch")
	}

	updatedDoc := floorplan.ParseResult{Walls: []floorplan.Segment{{X1: 0, Y1: 0, X2: 2, Y2: 0}}}
	updatedDocJSON, err := json.Marshal(updatedDoc)
	if err != nil {
		t.Fatalf("marshal updated doc: %v", err)
	}
	updated, err := repo.Update(ctx, created.ID, capabilityHash, 1, "Suite 1+", updatedDocJSON)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Revision != 2 {
		t.Fatalf("updated revision = %d, want 2", updated.Revision)
	}
	if _, err := repo.Update(ctx, created.ID, capabilityHash, 1, "bad", updatedDocJSON); err == nil {
		t.Fatal("expected revision conflict")
	}
}

func TestInitializeSchemaRecoversAuthorizedD53LegacyProjectWithoutTouchingBearerProjects(t *testing.T) {
	dsn := mustTestDatabaseURL(t)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("new setup pool: %v", err)
	}
	defer pool.Close()

	const legacyID = "00000000-0000-4000-8000-000000000099"
	const bearerID = "00000000-0000-4000-8000-000000000098"
	const retiredHash = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	const bearerHash = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
	const recoveredHash = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	if _, err := pool.Exec(ctx, `DROP TABLE IF EXISTS projects CASCADE;
CREATE TABLE projects (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    source_image_key text NOT NULL UNIQUE,
    source_image_content_type text NOT NULL,
    source_image_size bigint NOT NULL,
    document jsonb NOT NULL,
    revision integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    capability_hash text NOT NULL
);
INSERT INTO projects (id, capability_hash, name, source_image_key, source_image_content_type, source_image_size, document) VALUES
('00000000-0000-4000-8000-000000000099', '`+retiredHash+`', 'd53 legacy', 'legacy/source.png', 'image/png', 12, '{}'),
('00000000-0000-4000-8000-000000000098', '`+bearerHash+`', 'bearer project', 'bearer/source.png', 'image/png', 12, '{}');`); err != nil {
		t.Fatalf("create d53 schema: %v", err)
	}

	repo := &PostgresRepository{pool: pool}
	if err := repo.InitializeSchema(ctx); err != nil {
		t.Fatalf("migrate d53 schema: %v", err)
	}
	if _, err := repo.RecoverLegacy(ctx, legacyID, recoveredHash, "operator", json.RawMessage(`{}`)); err != ErrProjectNotFound {
		t.Fatalf("unauthorized d53 recovery = %v, want ErrProjectNotFound", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO legacy_project_recovery_authorizations (project_id, retired_capability_hash, authorized_by, case_reference) VALUES ($1, $2, 'operator', 'INC-19')`, legacyID, retiredHash); err != nil {
		t.Fatalf("authorize d53 recovery: %v", err)
	}
	recovered, err := repo.RecoverLegacy(ctx, legacyID, recoveredHash, "operator", json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("recover authorized d53 project: %v", err)
	}
	if recovered.ID != legacyID {
		t.Fatalf("recovered id = %s, want %s", recovered.ID, legacyID)
	}
	if _, err := repo.Get(ctx, legacyID, recoveredHash); err != nil {
		t.Fatalf("get recovered project: %v", err)
	}
	if _, err := repo.RecoverLegacy(ctx, bearerID, recoveredHash, "operator", json.RawMessage(`{}`)); err != ErrProjectNotFound {
		t.Fatalf("bearer recovery = %v, want ErrProjectNotFound", err)
	}
	if _, err := repo.Get(ctx, bearerID, bearerHash); err != nil {
		t.Fatalf("bearer project was changed: %v", err)
	}
	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM legacy_project_recovery_audit WHERE project_id = $1`, legacyID).Scan(&auditCount); err != nil {
		t.Fatalf("read recovery audit: %v", err)
	}
	if auditCount != 1 {
		t.Fatalf("recovery audit count = %d, want 1", auditCount)
	}
}

func truncateProjectsTable(ctx context.Context, dsn string) error {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()

	_, err = pool.Exec(ctx, `TRUNCATE TABLE projects CASCADE;`)
	return err
}
