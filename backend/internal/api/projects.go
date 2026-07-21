package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/db"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/floorplan"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/project"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/storage"
	"github.com/gin-gonic/gin"
)

type persistenceStatus string

type projectErrorEnvelope struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type projectDependencies struct {
	databaseStatus persistenceStatus
	s3Status       persistenceStatus
	repo           db.ProjectRepository
	store          storage.ObjectStore
}

func (deps projectDependencies) Close() {
	if closer, ok := deps.repo.(interface{ Close() }); ok {
		closer.Close()
	}
}

type databaseConfig struct {
	DatabaseURL string
	S3Endpoint  string
	S3Bucket    string
	S3AccessKey string
	S3SecretKey string
}

const (
	statusNotConfigured persistenceStatus = "not_configured"
	statusIncomplete    persistenceStatus = "incomplete_config"
	statusUnavailable   persistenceStatus = "unavailable"
	statusReady         persistenceStatus = "ready"
	projectListLimitMax                   = 100
)

var uuidRegex = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type projectRepositoryFactory func(context.Context, string) (db.ProjectRepository, error)
type objectStoreFactory func(storage.Config) (storage.ObjectStore, error)

func newProjectDependencies(ctx context.Context, cfg databaseConfig) projectDependencies {
	return newProjectDependenciesWithFactories(ctx, cfg,
		func(ctx context.Context, databaseURL string) (db.ProjectRepository, error) {
			return db.NewPostgresRepository(ctx, databaseURL)
		},
		storage.NewS3Store,
	)
}

// newProjectDependenciesWithFactories initializes each persistence dependency
// independently. A verified database remains "ready" even when S3 is incomplete
// or unavailable (and vice versa); routes still require both dependencies.
func newProjectDependenciesWithFactories(ctx context.Context, cfg databaseConfig, newRepo projectRepositoryFactory, newStore objectStoreFactory) projectDependencies {
	deps := projectDependencies{}

	if cfg.DatabaseURL == "" {
		deps.databaseStatus = statusNotConfigured
	} else {
		deps.databaseStatus = statusUnavailable
		repo, err := newRepo(ctx, cfg.DatabaseURL)
		if err == nil {
			if err = repo.InitializeSchema(ctx); err == nil {
				deps.repo = repo
				deps.databaseStatus = statusReady
			} else if closer, ok := repo.(interface{ Close() }); ok {
				closer.Close()
			}
		}
	}

	if cfg.S3Endpoint == "" && cfg.S3Bucket == "" && cfg.S3AccessKey == "" && cfg.S3SecretKey == "" {
		deps.s3Status = statusNotConfigured
	} else if !s3ConfigComplete(cfg) {
		deps.s3Status = statusIncomplete
	} else {
		deps.s3Status = statusUnavailable
		store, err := newStore(storage.Config{
			Endpoint: cfg.S3Endpoint, Bucket: cfg.S3Bucket,
			AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey,
		})
		if err == nil && store.VerifyBucket(ctx) == nil {
			deps.store = store
			deps.s3Status = statusReady
		}
	}

	return deps
}

func s3ConfigComplete(cfg databaseConfig) bool {
	return cfg.S3Endpoint != "" && cfg.S3Bucket != "" && cfg.S3AccessKey != "" && cfg.S3SecretKey != ""
}

func (deps projectDependencies) ready() bool {
	return deps.repo != nil && deps.store != nil && deps.databaseStatus == statusReady && deps.s3Status == statusReady
}

func registerProjectRoutes(router *gin.Engine, deps projectDependencies) {
	group := router.Group("/api/projects")
	group.POST("", func(c *gin.Context) {
		if !deps.ready() {
			writeProjectError(c, http.StatusServiceUnavailable, "persistence_unavailable", "project persistence unavailable")
			return
		}

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, project.MaxCreateRequestBytes)
		if err := c.Request.ParseMultipartForm(project.MaxCreateRequestBytes); err != nil {
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				writeProjectError(c, http.StatusRequestEntityTooLarge, "request_too_large", "project create request is too large")
				return
			}
			writeProjectError(c, http.StatusBadRequest, "invalid_multipart_request", "request must be valid multipart form data")
			return
		}

		name := c.Request.Form.Get("name")
		name, err := project.ValidateName(name)
		if err != nil {
			writeProjectError(c, http.StatusBadRequest, "invalid_name", err.Error())
			return
		}

		rawDocument := c.Request.Form.Get("document")
		doc, err := project.NormalizeDocument([]byte(rawDocument))
		if err != nil {
			writeProjectError(c, http.StatusBadRequest, "invalid_document", err.Error())
			return
		}

		file, header, err := c.Request.FormFile("source_image")
		if err != nil {
			writeProjectError(c, http.StatusBadRequest, "source_image_required", "field source_image is required")
			return
		}
		defer file.Close()

		data, err := io.ReadAll(io.LimitReader(file, project.MaxSourceImageBytes+1))
		if err != nil {
			writeProjectError(c, http.StatusBadRequest, "invalid_source_image", "failed to read source_image")
			return
		}
		if len(data) > project.MaxSourceImageBytes {
			writeProjectError(c, http.StatusRequestEntityTooLarge, "source_image_too_large", "source_image must be 10 MiB or smaller")
			return
		}
		if header.Size > 0 && header.Size > project.MaxSourceImageBytes {
			writeProjectError(c, http.StatusRequestEntityTooLarge, "source_image_too_large", "source_image must be 10 MiB or smaller")
			return
		}

		contentType := http.DetectContentType(data)
		if !project.IsSupportedContentType(contentType) {
			writeProjectError(c, http.StatusBadRequest, "unsupported_source_image", "source_image must be a PNG, JPEG, GIF, or WebP image")
			return
		}
		if err := project.ValidateSourceImageMetadata(doc, header.Filename, contentType, int64(len(data))); err != nil {
			writeProjectError(c, http.StatusBadRequest, "source_image_metadata_mismatch", err.Error())
			return
		}

		projectID, err := newProjectID()
		if err != nil {
			writeProjectError(c, http.StatusServiceUnavailable, "persistence_unavailable", "failed to allocate project ID")
			return
		}
		key := sourceImageKey(projectID)
		err = deps.store.PutObject(c.Request.Context(), key, contentType, data)
		if err != nil {
			writeProjectError(c, http.StatusServiceUnavailable, "storage_unavailable", "failed to upload source image")
			return
		}

		rawDoc, err := json.Marshal(doc)
		if err != nil {
			_ = deps.store.DeleteObject(c.Request.Context(), key)
			writeProjectError(c, http.StatusBadRequest, "invalid_document", "invalid document")
			return
		}
		created, err := deps.repo.Create(c.Request.Context(), projectID, name, key, contentType, int64(len(data)), rawDoc)
		if err != nil {
			if deleteErr := deps.store.DeleteObject(c.Request.Context(), key); deleteErr != nil {
				log.Printf("project create rollback failed for object key=%s: %v", key, deleteErr)
				writeProjectError(c, http.StatusServiceUnavailable, "persistence_cleanup_failed", "failed to commit project and cleanup temporary source image")
				return
			}
			writeProjectError(c, http.StatusServiceUnavailable, "database_unavailable", "failed to create project")
			return
		}

		writeFullProject(c, http.StatusCreated, created)
	})

	group.PUT(":id", func(c *gin.Context) {
		if !deps.ready() {
			writeProjectError(c, http.StatusServiceUnavailable, "persistence_unavailable", "project persistence unavailable")
			return
		}
		id := c.Param("id")
		if !uuidRegex.MatchString(id) {
			writeProjectError(c, http.StatusBadRequest, "invalid_project_id", "id must be UUID")
			return
		}

		var payload struct {
			Name             string          `json:"name"`
			Document         json.RawMessage `json:"document"`
			ExpectedRevision int             `json:"expectedRevision"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			writeProjectError(c, http.StatusBadRequest, "invalid_request", "invalid JSON payload")
			return
		}

		name, err := project.ValidateName(payload.Name)
		if err != nil {
			writeProjectError(c, http.StatusBadRequest, "invalid_name", err.Error())
			return
		}
		doc, err := project.NormalizeDocument(payload.Document)
		if err != nil {
			writeProjectError(c, http.StatusBadRequest, "invalid_document", err.Error())
			return
		}
		if payload.ExpectedRevision <= 0 {
			writeProjectError(c, http.StatusBadRequest, "invalid_expected_revision", "expectedRevision is required")
			return
		}

		current, err := deps.repo.Get(c.Request.Context(), id)
		if err != nil {
			if err == db.ErrProjectNotFound {
				writeProjectError(c, http.StatusNotFound, "project_not_found", "project not found")
				return
			}
			writeProjectError(c, http.StatusServiceUnavailable, "database_unavailable", "failed to get project")
			return
		}
		currentDocument, err := project.NormalizeDocument(current.Document)
		if err != nil {
			writeProjectError(c, http.StatusInternalServerError, "corrupt_project_document", "failed to decode project document")
			return
		}
		if err := project.ValidateSourceImageMetadata(doc, currentDocument.Filename, current.SourceImageContentType, current.SourceImageSize); err != nil {
			writeProjectError(c, http.StatusBadRequest, "source_image_metadata_mismatch", err.Error())
			return
		}

		rawDoc, err := json.Marshal(doc)
		if err != nil {
			writeProjectError(c, http.StatusBadRequest, "invalid_document", "invalid document")
			return
		}

		updated, err := deps.repo.Update(c.Request.Context(), id, payload.ExpectedRevision, name, rawDoc)
		if err != nil {
			if err == db.ErrProjectNotFound {
				writeProjectError(c, http.StatusNotFound, "project_not_found", "project not found")
				return
			}
			if _, ok := err.(*db.RevisionConflictError); ok {
				writeProjectError(c, http.StatusConflict, "revision_conflict", err.Error())
				return
			}
			writeProjectError(c, http.StatusServiceUnavailable, "database_unavailable", "failed to update project")
			return
		}

		writeFullProject(c, http.StatusOK, updated)
	})

	group.GET("", func(c *gin.Context) {
		if !deps.ready() {
			writeProjectError(c, http.StatusServiceUnavailable, "persistence_unavailable", "project persistence unavailable")
			return
		}

		limit := projectListLimitMax
		if q := c.Query("limit"); q != "" {
			parsed, err := strconv.Atoi(q)
			if err != nil || parsed <= 0 || parsed > projectListLimitMax {
				writeProjectError(c, http.StatusBadRequest, "invalid_limit", "limit must be an integer between 1 and 100")
				return
			}
			limit = parsed
		}

		summaries, err := deps.repo.List(c.Request.Context(), limit)
		if err != nil {
			writeProjectError(c, http.StatusServiceUnavailable, "database_unavailable", "failed to list projects")
			return
		}

		items := make([]gin.H, 0, len(summaries))
		for _, summary := range summaries {
			items = append(items, gin.H{
				"id":             summary.ID,
				"name":           summary.Name,
				"revision":       summary.Revision,
				"createdAt":      summary.CreatedAt.UTC().Format(time.RFC3339),
				"updatedAt":      summary.UpdatedAt.UTC().Format(time.RFC3339),
				"sourceImageURL": fmt.Sprintf("/api/projects/%s/source-image", summary.ID),
			})
		}
		c.JSON(http.StatusOK, items)
	})

	group.GET(":id", func(c *gin.Context) {
		if !deps.ready() {
			writeProjectError(c, http.StatusServiceUnavailable, "persistence_unavailable", "project persistence unavailable")
			return
		}
		id := c.Param("id")
		if !uuidRegex.MatchString(id) {
			writeProjectError(c, http.StatusBadRequest, "invalid_project_id", "id must be UUID")
			return
		}

		projectModel, err := deps.repo.Get(c.Request.Context(), id)
		if err != nil {
			if err == db.ErrProjectNotFound {
				writeProjectError(c, http.StatusNotFound, "project_not_found", "project not found")
				return
			}
			writeProjectError(c, http.StatusServiceUnavailable, "database_unavailable", "failed to get project")
			return
		}
		writeFullProject(c, http.StatusOK, projectModel)
	})

	group.GET(":id/source-image", func(c *gin.Context) {
		if !deps.ready() {
			writeProjectError(c, http.StatusServiceUnavailable, "persistence_unavailable", "project persistence unavailable")
			return
		}
		id := c.Param("id")
		if !uuidRegex.MatchString(id) {
			writeProjectError(c, http.StatusBadRequest, "invalid_project_id", "id must be UUID")
			return
		}

		projectModel, err := deps.repo.Get(c.Request.Context(), id)
		if err != nil {
			if err == db.ErrProjectNotFound {
				writeProjectError(c, http.StatusNotFound, "project_not_found", "project not found")
				return
			}
			writeProjectError(c, http.StatusServiceUnavailable, "database_unavailable", "failed to get project")
			return
		}

		obj, err := deps.store.GetObject(c.Request.Context(), projectModel.SourceImageKey)
		if err != nil {
			if err == storage.ErrObjectNotFound {
				writeProjectError(c, http.StatusNotFound, "source_image_not_found", "source image not found")
				return
			}
			writeProjectError(c, http.StatusServiceUnavailable, "storage_unavailable", "failed to get source image")
			return
		}

		c.Header("Content-Type", obj.ContentType)
		c.Header("Content-Length", strconv.FormatInt(obj.Size, 10))
		c.Status(http.StatusOK)
		if _, err := io.Copy(c.Writer, bytes.NewReader(obj.Data)); err != nil {
			writeProjectError(c, http.StatusServiceUnavailable, "storage_unavailable", "failed to stream source image")
		}
	})
}

func writeProjectError(c *gin.Context, status int, code, message string) {
	body := projectErrorEnvelope{}
	body.Error.Code = code
	body.Error.Message = message
	c.JSON(status, body)
}

func writeFullProject(c *gin.Context, status int, projectModel db.Project) {
	var parsed floorplan.ParseResponse
	if err := json.Unmarshal(projectModel.Document, &parsed); err != nil {
		writeProjectError(c, http.StatusInternalServerError, "corrupt_project_document", "failed to decode project document")
		return
	}

	c.JSON(status, gin.H{
		"id":                     projectModel.ID,
		"name":                   projectModel.Name,
		"revision":               projectModel.Revision,
		"document":               parsed,
		"sourceImageContentType": projectModel.SourceImageContentType,
		"sourceImageSize":        projectModel.SourceImageSize,
		"createdAt":              projectModel.CreatedAt.UTC().Format(time.RFC3339),
		"updatedAt":              projectModel.UpdatedAt.UTC().Format(time.RFC3339),
		"sourceImageURL":         fmt.Sprintf("/api/projects/%s/source-image", projectModel.ID),
	})
}

func newProjectID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	// RFC 4122 version 4 UUID, allocated before object upload so one identity
	// consistently names both the database row and its immutable source object.
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	hexID := hex.EncodeToString(raw[:])
	return fmt.Sprintf("%s-%s-%s-%s-%s", hexID[:8], hexID[8:12], hexID[12:16], hexID[16:20], hexID[20:]), nil
}

func sourceImageKey(projectID string) string {
	return fmt.Sprintf("projects/%s/source-image", projectID)
}

func projectStatusesFromDependencies(deps projectDependencies) (string, string, bool, bool) {
	dbConfigured := deps.databaseStatus == statusReady
	s3Configured := deps.s3Status == statusReady
	return string(deps.databaseStatus), string(deps.s3Status), dbConfigured, s3Configured
}
