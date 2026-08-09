package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/db"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/project"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/storage"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fakeProjectRepo struct {
	projects         map[string]db.Project
	capabilityHashes map[string]string
	nextID           int
	lastCreatedID    string
	lastCreatedKey   string
	createErr        error
	initializeErr    error
	getCalls         int
}

const validProjectDocument = `{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`

func projectDocumentForSourceImage(t testing.TB) string {
	t.Helper()
	document := strings.Replace(validProjectDocument, `"size":12`, fmt.Sprintf(`"size":%d`, len(validPNG(t))), 1)
	document = strings.Replace(document, `"image_width":100`, `"image_width":2`, 1)
	return strings.Replace(document, `"image_height":80`, `"image_height":3`, 1)
}

func newFakeProjectRepo() *fakeProjectRepo {
	return &fakeProjectRepo{projects: make(map[string]db.Project), capabilityHashes: make(map[string]string)}
}

func (f *fakeProjectRepo) InitializeSchema(_ context.Context) error { return f.initializeErr }

func (f *fakeProjectRepo) Create(_ context.Context, id, capabilityHash, name, sourceImageKey, sourceImageContentType string, sourceImageSize int64, document json.RawMessage) (db.Project, error) {
	f.lastCreatedID = id
	f.lastCreatedKey = sourceImageKey
	if f.createErr != nil {
		return db.Project{}, f.createErr
	}
	f.nextID++
	if id == "" {
		id = fmt.Sprintf("00000000-0000-0000-0000-%012d", f.nextID)
	}
	project := db.Project{
		ID:                     id,
		Name:                   name,
		SourceImageKey:         sourceImageKey,
		SourceImageContentType: sourceImageContentType,
		SourceImageSize:        sourceImageSize,
		Document:               document,
		Revision:               1,
		CreatedAt:              time.Now().UTC(),
		UpdatedAt:              time.Now().UTC(),
	}
	f.projects[id] = project
	f.capabilityHashes[id] = capabilityHash
	return project, nil
}

func (f *fakeProjectRepo) Get(_ context.Context, id, capabilityHash string) (db.Project, error) {
	f.getCalls++
	project, ok := f.projects[id]
	if !ok || f.capabilityHashes[id] != capabilityHash {
		return db.Project{}, db.ErrProjectNotFound
	}
	return project, nil
}

func (f *fakeProjectRepo) Update(_ context.Context, id, capabilityHash string, expectedRevision int, name string, document json.RawMessage) (db.Project, error) {
	project, ok := f.projects[id]
	if !ok || f.capabilityHashes[id] != capabilityHash {
		return db.Project{}, db.ErrProjectNotFound
	}
	if project.Revision != expectedRevision {
		return db.Project{}, &db.RevisionConflictError{ID: id, Expected: expectedRevision, Current: project.Revision}
	}
	project.Name = name
	project.Document = document
	project.Revision++
	project.UpdatedAt = time.Now().UTC()
	f.projects[id] = project
	return project, nil
}

func (f *fakeProjectRepo) LegacyRecoveryCandidate(_ context.Context, id string) (db.Project, error) {
	project, ok := f.projects[id]
	if !ok {
		return db.Project{}, db.ErrProjectNotFound
	}
	return project, nil
}

func (f *fakeProjectRepo) RecoverLegacy(_ context.Context, id, capabilityHash, _ string, document json.RawMessage) (db.Project, error) {
	project, ok := f.projects[id]
	if !ok || f.capabilityHashes[id] != "" {
		return db.Project{}, db.ErrProjectNotFound
	}
	f.capabilityHashes[id] = capabilityHash
	project.Document = document
	f.projects[id] = project
	return project, nil
}

func (f *fakeProjectRepo) Close() {}

var _ db.ProjectRepository = (*fakeProjectRepo)(nil)

type fakeObject struct {
	data        []byte
	contentType string
}

type fakeObjectStore struct {
	objects             map[string]fakeObject
	deleteShouldFail    bool
	deleteShouldFailErr error
	verifyErr           error
	lastDeletedKey      string
}

func newFakeObjectStore() *fakeObjectStore {
	return &fakeObjectStore{objects: make(map[string]fakeObject)}
}

func (s *fakeObjectStore) PutObject(_ context.Context, key string, contentType string, data []byte) error {
	s.objects[key] = fakeObject{data: data, contentType: contentType}
	return nil
}

func (s *fakeObjectStore) GetObject(_ context.Context, key string) (storage.Object, error) {
	obj, ok := s.objects[key]
	if !ok {
		return storage.Object{}, storage.ErrObjectNotFound
	}
	return storage.Object{Data: obj.data, ContentType: obj.contentType, Size: int64(len(obj.data))}, nil
}

func (s *fakeObjectStore) DeleteObject(_ context.Context, key string) error {
	s.lastDeletedKey = key
	if s.deleteShouldFail {
		if s.deleteShouldFailErr != nil {
			return s.deleteShouldFailErr
		}
		return fmt.Errorf("delete failed")
	}
	delete(s.objects, key)
	return nil
}

func (s *fakeObjectStore) VerifyBucket(_ context.Context) error { return s.verifyErr }
func (s *fakeObjectStore) ObjectURL(key string) string          { return "/objects/" + key }

var _ storage.ObjectStore = (*fakeObjectStore)(nil)

func readyDeps(repo db.ProjectRepository, store storage.ObjectStore) projectDependencies {
	return projectDependencies{
		databaseStatus: statusReady,
		s3Status:       statusReady,
		repo:           repo,
		store:          store,
	}
}

func newProjectRouter(repo db.ProjectRepository, store storage.ObjectStore) *gin.Engine {
	router := gin.New()
	registerProjectRoutes(router, readyDeps(repo, store))
	return router
}

func newLegacyRecoveryRouter(repo db.ProjectRepository, store storage.ObjectStore, key string) *gin.Engine {
	router := gin.New()
	deps := readyDeps(repo, store)
	deps.legacyRecoveryKey = key
	registerProjectRoutes(router, deps)
	return router
}

const testProjectCapability = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

func testCapabilityHash() string {
	sum := sha256.Sum256([]byte(testProjectCapability))
	return fmt.Sprintf("%x", sum[:])
}

func authorizeProjectRequest(request *http.Request, capability string) {
	request.Header.Set(projectCapabilityHeader, capability)
}

func seedAuthorizedProject(t testing.TB, repo *fakeProjectRepo, store *fakeObjectStore, projectID string) {
	t.Helper()
	repo.projects[projectID] = db.Project{
		ID: projectID, Name: "Private plan", SourceImageKey: sourceImageKey(projectID),
		SourceImageContentType: "image/png", SourceImageSize: int64(len(validPNG(t))),
		Document: json.RawMessage(projectDocumentForSourceImage(t)), Revision: 1,
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	repo.capabilityHashes[projectID] = testCapabilityHash()
	store.objects[sourceImageKey(projectID)] = fakeObject{data: validPNG(t), contentType: "image/png"}
}

func TestProjectRoutesRequireCapabilityInsteadOfProjectID(t *testing.T) {
	repo := newFakeProjectRepo()
	store := newFakeObjectStore()
	router := newProjectRouter(repo, store)
	projectID := "00000000-0000-0000-0000-000000000001"
	seedAuthorizedProject(t, repo, store, projectID)

	for _, target := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/projects"},
		{http.MethodGet, "/api/projects/" + projectID},
		{http.MethodGet, "/api/projects/" + projectID + "/source-image"},
		{http.MethodPut, "/api/projects/" + projectID},
	} {
		req := httptest.NewRequest(target.method, target.path, nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s status = %d, want %d", target.method, target.path, response.Code, http.StatusUnauthorized)
		}
		if strings.Contains(response.Body.String(), projectID) {
			t.Fatalf("%s %s leaked project identity: %s", target.method, target.path, response.Body.String())
		}
	}
}

func TestProjectCreateRequiresValidatedInput(t *testing.T) {
	router := newProjectRouter(newFakeProjectRepo(), newFakeObjectStore())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("name", "   ")
	_ = writer.WriteField("document", projectDocumentForSourceImage(t))
	part, err := writer.CreateFormFile("source_image", "plan.txt")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	_, _ = part.Write([]byte("not image"))
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/projects", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("create status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestProjectCreateReturnsUnavailableWhenPersistenceNotReady(t *testing.T) {
	router := gin.New()
	registerProjectRoutes(router, projectDependencies{databaseStatus: statusUnavailable, s3Status: statusUnavailable})

	req := httptest.NewRequest(http.MethodPost, "/api/projects", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusServiceUnavailable)
	}

	if !strings.Contains(w.Body.String(), "project persistence unavailable") {
		t.Fatalf("unexpected body: %s", w.Body.String())
	}
}

func TestProjectCreateReturnsCapabilityAndAuthorizesReads(t *testing.T) {
	repo := newFakeProjectRepo()
	store := newFakeObjectStore()
	router := newProjectRouter(repo, store)

	image := validPNG(t)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("name", "My Plan")
	_ = writer.WriteField("document", projectDocumentForSourceImage(t))
	part, err := writer.CreateFormFile("source_image", "plan.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	_, _ = part.Write(image)
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	createReq := httptest.NewRequest(http.MethodPost, "/api/projects", body)
	createReq.Header.Set("Content-Type", writer.FormDataContentType())
	createW := httptest.NewRecorder()
	router.ServeHTTP(createW, createReq)
	if createW.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body=%s", createW.Code, createW.Body.String())
	}
	if got := createW.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("create Cache-Control = %q, want no-store for one-time capability response", got)
	}

	var created map[string]any
	if err := json.Unmarshal(createW.Body.Bytes(), &created); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	id := created["id"].(string)
	capability, ok := created["capability"].(string)
	if !ok || !projectCapabilityRegex.MatchString(capability) {
		t.Fatalf("create capability is missing or malformed")
	}
	if repo.lastCreatedID != id {
		t.Fatalf("repo ID = %s, response ID = %s", repo.lastCreatedID, id)
	}
	wantKey := sourceImageKey(id)
	if repo.lastCreatedKey != wantKey {
		t.Fatalf("source key = %s, want %s", repo.lastCreatedKey, wantKey)
	}
	if _, ok := store.objects[wantKey]; !ok {
		t.Fatalf("upload did not use project UUID key %s", wantKey)
	}
	storedHash := repo.capabilityHashes[id]
	if storedHash == "" || storedHash == capability || storedHash != hashProjectCapability(capability) {
		t.Fatalf("repository must receive only the capability hash")
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/projects?limit=1", nil)
	listW := httptest.NewRecorder()
	router.ServeHTTP(listW, listReq)
	if listW.Code != http.StatusUnauthorized || strings.Contains(listW.Body.String(), id) {
		t.Fatalf("list must not enumerate projects; status=%d body=%s", listW.Code, listW.Body.String())
	}

	sourceImageReq := httptest.NewRequest(http.MethodGet, created["sourceImageURL"].(string), nil)
	authorizeProjectRequest(sourceImageReq, capability)
	sourceImageW := httptest.NewRecorder()
	router.ServeHTTP(sourceImageW, sourceImageReq)
	if sourceImageW.Code != http.StatusOK {
		t.Fatalf("source image status = %d", sourceImageW.Code)
	}
	if got := sourceImageW.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("source image Cache-Control = %q, want no-store", got)
	}
	if sourceImageW.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("content type = %s", sourceImageW.Header().Get("Content-Type"))
	}
	if sourceImageW.Body.String() != string(image) {
		t.Fatalf("image body mismatch")
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/projects/"+id, nil)
	authorizeProjectRequest(getReq, capability)
	getW := httptest.NewRecorder()
	router.ServeHTTP(getW, getReq)
	if getW.Code != http.StatusOK {
		t.Fatalf("get status = %d", getW.Code)
	}
	if strings.Contains(getW.Body.String(), capability) {
		t.Fatal("project detail must not echo the capability")
	}
}

func TestProjectReadWithWrongCapabilityReturnsGenericNotFound(t *testing.T) {
	repo := newFakeProjectRepo()
	store := newFakeObjectStore()
	projectID := "00000000-0000-0000-0000-000000000001"
	seedAuthorizedProject(t, repo, store, projectID)
	router := newProjectRouter(repo, store)

	req := httptest.NewRequest(http.MethodGet, "/api/projects/"+projectID, nil)
	authorizeProjectRequest(req, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusNotFound, w.Body.String())
	}
	if strings.Contains(w.Body.String(), projectID) || strings.Contains(w.Body.String(), testProjectCapability) {
		t.Fatalf("unauthorized response leaked project identity or capability: %s", w.Body.String())
	}
}

func TestLegacyProjectRecoveryRequiresOperatorKeyAndIssuesOneNewCapability(t *testing.T) {
	repo := newFakeProjectRepo()
	store := newFakeObjectStore()
	id := "00000000-0000-0000-0000-000000000019"
	repo.projects[id] = db.Project{
		ID: id, Name: "Legacy plan", SourceImageKey: sourceImageKey(id),
		SourceImageContentType: "image/png", SourceImageSize: int64(len(validPNG(t))),
		Document: json.RawMessage(projectDocumentForSourceImage(t)), Revision: 1,
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	store.objects[sourceImageKey(id)] = fakeObject{data: validPNG(t), contentType: "image/png"}
	router := newLegacyRecoveryRouter(repo, store, "operator-only-key")

	for _, key := range []string{"", "wrong-key"} {
		req := httptest.NewRequest(http.MethodPost, "/api/projects/"+id+"/recover", nil)
		req.Header.Set("X-HomeVox-Legacy-Recovery-Key", key)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Fatalf("recovery with %q status=%d body=%s", key, w.Code, w.Body.String())
		}
	}

	req := httptest.NewRequest(http.MethodPost, "/api/projects/"+id+"/recover", nil)
	req.Header.Set("X-HomeVox-Legacy-Recovery-Key", "operator-only-key")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("recovery status=%d body=%s", w.Code, w.Body.String())
	}
	var recovered struct {
		ID         string `json:"id"`
		Capability string `json:"capability"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &recovered); err != nil {
		t.Fatal(err)
	}
	if recovered.ID != id || !projectCapabilityRegex.MatchString(recovered.Capability) {
		t.Fatalf("unexpected recovery response: %+v", recovered)
	}
	if repo.capabilityHashes[id] != hashProjectCapability(recovered.Capability) {
		t.Fatal("recovery did not atomically assign the returned capability")
	}

	again := httptest.NewRequest(http.MethodPost, "/api/projects/"+id+"/recover", nil)
	again.Header.Set("X-HomeVox-Legacy-Recovery-Key", "operator-only-key")
	againW := httptest.NewRecorder()
	router.ServeHTTP(againW, again)
	if againW.Code != http.StatusNotFound {
		t.Fatalf("second recovery status=%d body=%s", againW.Code, againW.Body.String())
	}
}

func TestLegacyRecoveryPostgresRouteUpgradesOldDocumentBeforeOneTimeClaim(t *testing.T) {
	dsn := os.Getenv("HOMEVOX_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("HOMEVOX_TEST_DATABASE_URL not set; skipping PostgreSQL route regression")
	}
	ctx := context.Background()
	repo, err := db.NewPostgresRepository(ctx, dsn)
	if err != nil {
		t.Fatalf("new postgres repository: %v", err)
	}
	defer repo.Close()
	if err := repo.InitializeSchema(ctx); err != nil {
		t.Fatalf("initialize schema: %v", err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("new postgres pool: %v", err)
	}
	defer pool.Close()
	if _, err := pool.Exec(ctx, `TRUNCATE TABLE projects CASCADE`); err != nil {
		t.Fatalf("truncate projects: %v", err)
	}

	const id = "00000000-0000-4000-8000-000000000053"
	const retiredHash = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	image := validPNG(t)
	var legacyDocument map[string]any
	if err := json.Unmarshal([]byte(projectDocumentForSourceImage(t)), &legacyDocument); err != nil {
		t.Fatalf("decode fixture document: %v", err)
	}
	result := legacyDocument["result"].(map[string]any)
	delete(result["scale"].(map[string]any), "pixel_to_unit")
	metadata := result["metadata"].(map[string]any)
	delete(metadata, "confidence")
	delete(metadata, "image_width")
	delete(metadata, "image_height")
	legacyDocumentJSON, err := json.Marshal(legacyDocument)
	if err != nil {
		t.Fatalf("encode legacy fixture document: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO projects (id, capability_hash, name, source_image_key, source_image_content_type, source_image_size, document)
VALUES ($1, $2, 'legacy', $3, 'image/png', $4, $5::jsonb)`, id, retiredHash, sourceImageKey(id), len(image), legacyDocumentJSON); err != nil {
		t.Fatalf("insert legacy project: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO legacy_project_recovery_authorizations (project_id, retired_capability_hash, authorized_by, case_reference)
VALUES ($1, $2, 'operator', 'INC-53')`, id, retiredHash); err != nil {
		t.Fatalf("authorize legacy project: %v", err)
	}
	store := newFakeObjectStore()
	store.objects[sourceImageKey(id)] = fakeObject{data: image, contentType: "image/png"}
	router := newLegacyRecoveryRouter(repo, store, "operator-only-key")

	recover := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/projects/"+id+"/recover", nil)
		req.Header.Set("X-HomeVox-Legacy-Recovery-Key", "operator-only-key")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	first := recover()
	if first.Code != http.StatusOK {
		t.Fatalf("first recovery status=%d body=%s", first.Code, first.Body.String())
	}
	var body struct {
		Capability string `json:"capability"`
		Document   struct {
			Result struct {
				Scale struct {
					PixelToUnit *float64 `json:"pixel_to_unit"`
				} `json:"scale"`
				Metadata struct {
					Confidence  float64 `json:"confidence"`
					ImageWidth  int     `json:"image_width"`
					ImageHeight int     `json:"image_height"`
				} `json:"metadata"`
			} `json:"result"`
		} `json:"document"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode recovery response: %v", err)
	}
	if !projectCapabilityRegex.MatchString(body.Capability) || body.Document.Result.Scale.PixelToUnit != nil ||
		body.Document.Result.Metadata.Confidence != 0 || body.Document.Result.Metadata.ImageWidth != 2 || body.Document.Result.Metadata.ImageHeight != 3 {
		t.Fatalf("legacy recovery did not return normalized document: %+v", body)
	}
	second := recover()
	if second.Code != http.StatusNotFound {
		t.Fatalf("second recovery status=%d body=%s", second.Code, second.Body.String())
	}
	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM legacy_project_recovery_audit WHERE project_id = $1`, id).Scan(&auditCount); err != nil {
		t.Fatalf("read recovery audit: %v", err)
	}
	if auditCount != 1 {
		t.Fatalf("recovery audit count = %d, want 1", auditCount)
	}
}

func TestProjectCreateRejectsOversizedMultipartBodyBeforeParsing(t *testing.T) {
	router := newProjectRouter(newFakeProjectRepo(), newFakeObjectStore())
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("oversized", strings.Repeat("x", project.MaxCreateRequestBytes+1)); err != nil {
		t.Fatalf("write oversized form field: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/projects", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusRequestEntityTooLarge, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "request_too_large") {
		t.Fatalf("expected stable oversized-request error, body=%s", w.Body.String())
	}
}

func TestProjectCreateRejectsSourceImageMetadataMismatch(t *testing.T) {
	router := newProjectRouter(newFakeProjectRepo(), newFakeObjectStore())
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("name", "My Plan")
	_ = writer.WriteField("document", strings.Replace(validProjectDocument, `"size":12`, `"size":13`, 1))
	part, err := writer.CreateFormFile("source_image", "plan.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	_, _ = part.Write(validPNG(t))
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/projects", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "source_image_metadata_mismatch") {
		t.Fatalf("expected metadata mismatch; status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestProjectCreateRejectsEffectiveSourceDimensionMismatch(t *testing.T) {
	router := newProjectRouter(newFakeProjectRepo(), newFakeObjectStore())
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("name", "My Plan")
	document := strings.Replace(projectDocumentForSourceImage(t), `"image_width":2`, `"image_width":200`, 1)
	_ = writer.WriteField("document", document)
	part, err := writer.CreateFormFile("source_image", "plan.png")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(validPNG(t))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/projects", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "source_image_metadata_mismatch") {
		t.Fatalf("expected dimension mismatch; status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestProjectListCannotEnumerateEvenWithLimit(t *testing.T) {
	router := newProjectRouter(newFakeProjectRepo(), newFakeObjectStore())
	req := httptest.NewRequest(http.MethodGet, "/api/projects?limit=101", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), `"code":"project_capability_required"`) {
		t.Fatalf("status/body = %d/%s, want capability rejection", w.Code, w.Body.String())
	}
}

func TestProjectGetMissingReturnsNotFound(t *testing.T) {
	router := newProjectRouter(newFakeProjectRepo(), newFakeObjectStore())
	req := httptest.NewRequest(http.MethodGet, "/api/projects/00000000-0000-0000-0000-000000000000", nil)
	authorizeProjectRequest(req, testProjectCapability)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestProjectUpdateConflict(t *testing.T) {
	repo := newFakeProjectRepo()
	created, err := repo.Create(context.Background(), "00000000-0000-4000-8000-000000000001", testCapabilityHash(), "Plan", "source", "image/png", 12, []byte(validProjectDocument))
	if err != nil {
		t.Fatalf("create fake project: %v", err)
	}
	router := newProjectRouter(repo, newFakeObjectStore())

	payload := `{"name":"Plan","document":` + validProjectDocument + `,"expectedRevision":2}`
	updateReq := httptest.NewRequest(http.MethodPut, "/api/projects/"+created.ID, strings.NewReader(payload))
	updateReq.Header.Set("Content-Type", "application/json")
	authorizeProjectRequest(updateReq, testProjectCapability)
	updateW := httptest.NewRecorder()
	router.ServeHTTP(updateW, updateReq)
	if updateW.Code != http.StatusConflict {
		t.Fatalf("update status = %d, want %d", updateW.Code, http.StatusConflict)
	}
}

func TestProjectUpdateRejectsOversizedJSONBodyBeforeBinding(t *testing.T) {
	repo := newFakeProjectRepo()
	router := newProjectRouter(repo, newFakeObjectStore())
	id := "00000000-0000-0000-0000-000000000001"
	payload := `{"name":"Plan","document":` + validProjectDocument +
		strings.Repeat(" ", project.MaxUpdateRequestBytes) + `,"expectedRevision":1}`

	req := httptest.NewRequest(http.MethodPut, "/api/projects/"+id, strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	authorizeProjectRequest(req, testProjectCapability)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusRequestEntityTooLarge, w.Body.String())
	}
	var response projectErrorEnvelope
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if response.Error.Code != "request_too_large" {
		t.Fatalf("error code = %q, want request_too_large", response.Error.Code)
	}
	if repo.getCalls != 0 {
		t.Fatalf("repository Get calls = %d, want 0 because oversized request must fail before binding and persistence reads", repo.getCalls)
	}
}

func TestProjectUpdateReturnsNotFoundForUnknownID(t *testing.T) {
	router := newProjectRouter(newFakeProjectRepo(), newFakeObjectStore())
	payload := `{"name":"Plan","document":` + validProjectDocument + `,"expectedRevision":1}`
	req := httptest.NewRequest(http.MethodPut, "/api/projects/00000000-0000-0000-0000-000000000001", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	authorizeProjectRequest(req, testProjectCapability)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestProjectUpdateRejectsSourceImageMetadataMutation(t *testing.T) {
	repo := newFakeProjectRepo()
	image := validPNG(t)
	document := projectDocumentForSourceImage(t)
	_, err := repo.Create(context.Background(), "00000000-0000-0000-0000-000000000001", testCapabilityHash(), "Plan", "source", "image/png", int64(len(image)), []byte(document))
	if err != nil {
		t.Fatalf("create fixture: %v", err)
	}
	store := newFakeObjectStore()
	store.objects["source"] = fakeObject{data: image, contentType: "image/png"}
	router := newProjectRouter(repo, store)
	payload := `{"name":"Plan","document":` + strings.Replace(document, `"contentType":"image/png"`, `"contentType":"image/jpeg"`, 1) + `,"expectedRevision":1}`
	req := httptest.NewRequest(http.MethodPut, "/api/projects/00000000-0000-0000-0000-000000000001", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	authorizeProjectRequest(req, testProjectCapability)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "source_image_metadata_mismatch") {
		t.Fatalf("expected metadata mismatch; status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestProjectUpdateRejectsEffectiveSourceDimensionMutation(t *testing.T) {
	repo := newFakeProjectRepo()
	image := validPNG(t)
	document := projectDocumentForSourceImage(t)
	_, err := repo.Create(context.Background(), "00000000-0000-0000-0000-000000000001", testCapabilityHash(), "Plan", "source", "image/png", int64(len(image)), []byte(document))
	if err != nil {
		t.Fatal(err)
	}
	store := newFakeObjectStore()
	store.objects["source"] = fakeObject{data: image, contentType: "image/png"}
	router := newProjectRouter(repo, store)
	mutatedDocument := strings.Replace(document, `"image_width":2`, `"image_width":101`, 1)
	payload := `{"name":"Plan","document":` + mutatedDocument + `,"expectedRevision":1}`
	req := httptest.NewRequest(http.MethodPut, "/api/projects/00000000-0000-0000-0000-000000000001", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	authorizeProjectRequest(req, testProjectCapability)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "source_image_metadata_mismatch") {
		t.Fatalf("expected dimension mismatch; status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestProjectUpdateChecksImmutableSourceObjectDimensions(t *testing.T) {
	repo := newFakeProjectRepo()
	image := validPNG(t)
	document := strings.Replace(validProjectDocument, `"size":12`, fmt.Sprintf(`"size":%d`, len(image)), 1)
	_, err := repo.Create(context.Background(), "00000000-0000-0000-0000-000000000001", testCapabilityHash(), "Plan", "source", "image/png", int64(len(image)), []byte(document))
	if err != nil {
		t.Fatal(err)
	}
	store := newFakeObjectStore()
	store.objects["source"] = fakeObject{data: image, contentType: "image/png"}
	router := newProjectRouter(repo, store)
	payload := `{"name":"Plan","document":` + document + `,"expectedRevision":1}`
	req := httptest.NewRequest(http.MethodPut, "/api/projects/00000000-0000-0000-0000-000000000001", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	authorizeProjectRequest(req, testProjectCapability)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "source_image_metadata_mismatch") {
		t.Fatalf("expected immutable object dimension mismatch; status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestProjectCreateCompensationDeletesUploadedObjectWhenRepoFails(t *testing.T) {
	repo := newFakeProjectRepo()
	repo.createErr = fmt.Errorf("forced failure")
	s := newFakeObjectStore()
	router := newProjectRouter(repo, s)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("name", "Plan")
	_ = writer.WriteField("document", projectDocumentForSourceImage(t))
	part, err := writer.CreateFormFile("source_image", "plan.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	_, _ = part.Write(validPNG(t))
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/projects", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusServiceUnavailable)
	}
	if len(s.objects) != 0 {
		t.Fatalf("expected cleanup object, got %d", len(s.objects))
	}
	if repo.lastCreatedID == "" || s.lastDeletedKey != sourceImageKey(repo.lastCreatedID) {
		t.Fatalf("rollback deleted %q; want key derived from pre-upload project UUID %q", s.lastDeletedKey, sourceImageKey(repo.lastCreatedID))
	}
}

func TestProjectCreateFailsWhenCleanupFailsReturnsInfraError(t *testing.T) {
	repo := newFailingProjectRepo{}
	s := newFakeObjectStore()
	s.deleteShouldFail = true
	router := newProjectRouter(repo, s)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("name", "Plan")
	_ = writer.WriteField("document", projectDocumentForSourceImage(t))
	part, err := writer.CreateFormFile("source_image", "plan.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	_, _ = part.Write(validPNG(t))
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/projects", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusServiceUnavailable)
	}
}

type newFailingProjectRepo struct{}

func (f newFailingProjectRepo) InitializeSchema(context.Context) error { return nil }
func (f newFailingProjectRepo) Create(context.Context, string, string, string, string, string, int64, json.RawMessage) (db.Project, error) {
	return db.Project{}, fmt.Errorf("forced failure")
}
func (f newFailingProjectRepo) Get(context.Context, string, string) (db.Project, error) {
	return db.Project{}, db.ErrProjectNotFound
}
func (f newFailingProjectRepo) Update(context.Context, string, string, int, string, json.RawMessage) (db.Project, error) {
	return db.Project{}, fmt.Errorf("forced failure")
}
func (f newFailingProjectRepo) LegacyRecoveryCandidate(context.Context, string) (db.Project, error) {
	return db.Project{}, db.ErrProjectNotFound
}
func (f newFailingProjectRepo) RecoverLegacy(context.Context, string, string, string, json.RawMessage) (db.Project, error) {
	return db.Project{}, db.ErrProjectNotFound
}
func (f newFailingProjectRepo) Close() {}

func TestProjectDependenciesReadinessMatrix(t *testing.T) {
	readyRepo := func() *fakeProjectRepo { return newFakeProjectRepo() }
	readyStore := func() *fakeObjectStore { return newFakeObjectStore() }
	completeS3 := databaseConfig{S3Endpoint: "http://s3", S3Bucket: "bucket", S3AccessKey: "key", S3SecretKey: "secret"}

	tests := []struct {
		name      string
		cfg       databaseConfig
		repo      *fakeProjectRepo
		store     *fakeObjectStore
		wantDB    persistenceStatus
		wantS3    persistenceStatus
		wantReady bool
	}{
		{name: "both absent", wantDB: statusNotConfigured, wantS3: statusNotConfigured},
		{name: "database configured S3 incomplete", cfg: databaseConfig{DatabaseURL: "postgres://ready", S3Endpoint: "http://s3"}, repo: readyRepo(), wantDB: statusReady, wantS3: statusIncomplete},
		{name: "database unavailable S3 ready", cfg: func() databaseConfig { c := completeS3; c.DatabaseURL = "postgres://bad"; return c }(), repo: &fakeProjectRepo{initializeErr: fmt.Errorf("schema failed")}, store: readyStore(), wantDB: statusUnavailable, wantS3: statusReady},
		{name: "database ready S3 unavailable", cfg: func() databaseConfig { c := completeS3; c.DatabaseURL = "postgres://ready"; return c }(), repo: readyRepo(), store: &fakeObjectStore{objects: map[string]fakeObject{}, verifyErr: fmt.Errorf("bucket unavailable")}, wantDB: statusReady, wantS3: statusUnavailable},
		{name: "both ready", cfg: func() databaseConfig { c := completeS3; c.DatabaseURL = "postgres://ready"; return c }(), repo: readyRepo(), store: readyStore(), wantDB: statusReady, wantS3: statusReady, wantReady: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			deps := newProjectDependenciesWithFactories(context.Background(), tt.cfg,
				func(context.Context, string) (db.ProjectRepository, error) {
					if tt.repo == nil {
						return nil, fmt.Errorf("unexpected database initialization")
					}
					return tt.repo, nil
				},
				func(storage.Config) (storage.ObjectStore, error) {
					if tt.store == nil {
						return nil, fmt.Errorf("unexpected S3 initialization")
					}
					return tt.store, nil
				},
			)
			defer deps.Close()
			if deps.databaseStatus != tt.wantDB || deps.s3Status != tt.wantS3 || deps.ready() != tt.wantReady {
				t.Fatalf("statuses/ready = %s/%s/%t, want %s/%s/%t", deps.databaseStatus, deps.s3Status, deps.ready(), tt.wantDB, tt.wantS3, tt.wantReady)
			}
		})
	}
}

func TestProjectDocumentValidationBounds(t *testing.T) {
	_, err := project.NormalizeDocument([]byte(`{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[{"name":"a","type":"room","approximate_bounds":{"x1":0,"y1":0,"x2":1,"y2":2}}],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`))
	if err != nil {
		t.Fatalf("unexpected document validation error: %v", err)
	}
}
