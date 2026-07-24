package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/db"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/project"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/storage"
	"github.com/gin-gonic/gin"
)

type fakeProjectRepo struct {
	projects       map[string]db.Project
	nextID         int
	lastCreatedID  string
	lastCreatedKey string
	createErr      error
	initializeErr  error
	getCalls       int
}

const validProjectDocument = `{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px"},"metadata":{"source":"fixture","image_width":100,"image_height":80}}}`

func projectDocumentForSourceImage(t testing.TB) string {
	t.Helper()
	return strings.Replace(validProjectDocument, `"size":12`, fmt.Sprintf(`"size":%d`, len(validPNG(t))), 1)
}

func newFakeProjectRepo() *fakeProjectRepo {
	return &fakeProjectRepo{projects: make(map[string]db.Project)}
}

func (f *fakeProjectRepo) InitializeSchema(_ context.Context) error { return f.initializeErr }

func (f *fakeProjectRepo) Create(_ context.Context, id, name, sourceImageKey, sourceImageContentType string, sourceImageSize int64, document json.RawMessage) (db.Project, error) {
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
	return project, nil
}

func (f *fakeProjectRepo) Get(_ context.Context, id string) (db.Project, error) {
	f.getCalls++
	project, ok := f.projects[id]
	if !ok {
		return db.Project{}, db.ErrProjectNotFound
	}
	return project, nil
}

func (f *fakeProjectRepo) Update(_ context.Context, id string, expectedRevision int, name string, document json.RawMessage) (db.Project, error) {
	project, ok := f.projects[id]
	if !ok {
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

func (f *fakeProjectRepo) List(_ context.Context, limit int) ([]db.ProjectSummary, error) {
	if limit <= 0 {
		limit = 1
	}
	if limit > 100 {
		limit = 100
	}
	items := make([]db.ProjectSummary, 0, len(f.projects))
	for _, project := range f.projects {
		items = append(items, db.ProjectSummary{
			ID:        project.ID,
			Name:      project.Name,
			Revision:  project.Revision,
			CreatedAt: project.CreatedAt,
			UpdatedAt: project.UpdatedAt,
		})
	}
	if len(items) > limit {
		return items[:limit], nil
	}
	return items, nil
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

func TestProjectAPIReturnsUnavailableWhenPersistenceNotReady(t *testing.T) {
	router := gin.New()
	registerProjectRoutes(router, projectDependencies{databaseStatus: statusUnavailable, s3Status: statusUnavailable})

	req := httptest.NewRequest(http.MethodGet, "/api/projects", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusServiceUnavailable)
	}

	if !strings.Contains(w.Body.String(), "project persistence unavailable") {
		t.Fatalf("unexpected body: %s", w.Body.String())
	}
}

func TestProjectCreateGetsListAndSourceImage(t *testing.T) {
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

	var created map[string]any
	if err := json.Unmarshal(createW.Body.Bytes(), &created); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	id := created["id"].(string)
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

	listReq := httptest.NewRequest(http.MethodGet, "/api/projects?limit=1", nil)
	listW := httptest.NewRecorder()
	router.ServeHTTP(listW, listReq)
	if listW.Code != http.StatusOK {
		t.Fatalf("list status = %d", listW.Code)
	}
	var list []map[string]any
	if err := json.Unmarshal(listW.Body.Bytes(), &list); err != nil {
		t.Fatalf("unmarshal list: %v", err)
	}
	if got := list[0]["id"].(string); got != id {
		t.Fatalf("list first id = %s, want %s", got, id)
	}

	sourceImageReq := httptest.NewRequest(http.MethodGet, created["sourceImageURL"].(string), nil)
	sourceImageW := httptest.NewRecorder()
	router.ServeHTTP(sourceImageW, sourceImageReq)
	if sourceImageW.Code != http.StatusOK {
		t.Fatalf("source image status = %d", sourceImageW.Code)
	}
	if sourceImageW.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("content type = %s", sourceImageW.Header().Get("Content-Type"))
	}
	if sourceImageW.Body.String() != string(image) {
		t.Fatalf("image body mismatch")
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/projects/"+id, nil)
	getW := httptest.NewRecorder()
	router.ServeHTTP(getW, getReq)
	if getW.Code != http.StatusOK {
		t.Fatalf("get status = %d", getW.Code)
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

func TestProjectListRejectsLimitAbove100(t *testing.T) {
	router := newProjectRouter(newFakeProjectRepo(), newFakeObjectStore())
	req := httptest.NewRequest(http.MethodGet, "/api/projects?limit=101", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"code":"invalid_limit"`) {
		t.Fatalf("status/body = %d/%s, want invalid_limit", w.Code, w.Body.String())
	}
}

func TestProjectGetMissingReturnsNotFound(t *testing.T) {
	router := newProjectRouter(newFakeProjectRepo(), newFakeObjectStore())
	req := httptest.NewRequest(http.MethodGet, "/api/projects/00000000-0000-0000-0000-000000000000", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestProjectUpdateConflict(t *testing.T) {
	repo := newFakeProjectRepo()
	created, err := repo.Create(context.Background(), "00000000-0000-4000-8000-000000000001", "Plan", "source", "image/png", 12, []byte(validProjectDocument))
	if err != nil {
		t.Fatalf("create fake project: %v", err)
	}
	router := newProjectRouter(repo, newFakeObjectStore())

	payload := `{"name":"Plan","document":` + validProjectDocument + `,"expectedRevision":2}`
	updateReq := httptest.NewRequest(http.MethodPut, "/api/projects/"+created.ID, strings.NewReader(payload))
	updateReq.Header.Set("Content-Type", "application/json")
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
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestProjectUpdateRejectsSourceImageMetadataMutation(t *testing.T) {
	repo := newFakeProjectRepo()
	_, err := repo.Create(context.Background(), "00000000-0000-0000-0000-000000000001", "Plan", "source", "image/png", 12, []byte(validProjectDocument))
	if err != nil {
		t.Fatalf("create fixture: %v", err)
	}
	router := newProjectRouter(repo, newFakeObjectStore())
	payload := `{"name":"Plan","document":` + strings.Replace(validProjectDocument, `"contentType":"image/png"`, `"contentType":"image/jpeg"`, 1) + `,"expectedRevision":1}`
	req := httptest.NewRequest(http.MethodPut, "/api/projects/00000000-0000-0000-0000-000000000001", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "source_image_metadata_mismatch") {
		t.Fatalf("expected metadata mismatch; status=%d body=%s", w.Code, w.Body.String())
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
func (f newFailingProjectRepo) Create(context.Context, string, string, string, string, int64, json.RawMessage) (db.Project, error) {
	return db.Project{}, fmt.Errorf("forced failure")
}
func (f newFailingProjectRepo) Get(context.Context, string) (db.Project, error) {
	return db.Project{}, db.ErrProjectNotFound
}
func (f newFailingProjectRepo) Update(context.Context, string, int, string, json.RawMessage) (db.Project, error) {
	return db.Project{}, fmt.Errorf("forced failure")
}
func (f newFailingProjectRepo) List(context.Context, int) ([]db.ProjectSummary, error) {
	return nil, fmt.Errorf("forced failure")
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
	_, err := project.NormalizeDocument([]byte(`{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[{"name":"a","type":"room","approximate_bounds":{"x1":0,"y1":0,"x2":1,"y2":2}}],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px"},"metadata":{"source":"fixture"}}}`))
	if err != nil {
		t.Fatalf("unexpected document validation error: %v", err)
	}
}
