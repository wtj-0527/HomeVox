package db

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
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

func TestInitializeSchemaRetiresLegacyProjectsAndConstrainsCapabilityHash(t *testing.T) {
	dsn := mustTestDatabaseURL(t)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("new setup pool: %v", err)
	}
	defer pool.Close()

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
    updated_at timestamptz NOT NULL DEFAULT timezone('UTC', now())
);
INSERT INTO projects (id, name, source_image_key, source_image_content_type, source_image_size, document)
VALUES ('00000000-0000-4000-8000-000000000099', 'Legacy', 'legacy/source.png', 'image/png', 12, '{}');`); err != nil {
		t.Fatalf("create legacy schema: %v", err)
	}

	repo := &PostgresRepository{pool: pool}
	if err := repo.InitializeSchema(ctx); err != nil {
		t.Fatalf("migrate legacy schema: %v", err)
	}
	if err := repo.InitializeSchema(ctx); err != nil {
		t.Fatalf("repeat legacy migration: %v", err)
	}
	var nullable string
	if err := pool.QueryRow(ctx, `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'capability_hash'`).Scan(&nullable); err != nil {
		t.Fatalf("read capability nullability: %v", err)
	}
	if nullable != "NO" {
		t.Fatalf("capability_hash nullable = %s, want NO", nullable)
	}
	var hash string
	if err := pool.QueryRow(ctx, `SELECT capability_hash FROM projects WHERE id = '00000000-0000-4000-8000-000000000099'`).Scan(&hash); err != nil {
		t.Fatalf("read retired legacy hash: %v", err)
	}
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(hash) {
		t.Fatalf("legacy hash = %q, want retired random digest", hash)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO projects (id, capability_hash, name, source_image_key, source_image_content_type, source_image_size, document) VALUES ('00000000-0000-4000-8000-000000000098', 'invalid', 'Invalid', 'invalid/source.png', 'image/png', 12, '{}')`); err == nil {
		t.Fatal("invalid capability hash should violate database constraint")
	}
}

func truncateProjectsTable(ctx context.Context, dsn string) error {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()

	_, err = pool.Exec(ctx, `TRUNCATE TABLE projects;`)
	return err
}
