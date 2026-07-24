package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/ai"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/config"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/floorplan"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/imagevalidate"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/project"
	"github.com/gin-gonic/gin"
)

const maxFloorplanUploadBytes = 10 << 20
const persistenceStartupTimeout = 5 * time.Second

type healthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
	Time    string `json:"time"`
}

func NewRouter(cfg config.Config, frontendDirs ...string) *gin.Engine {
	router, _ := NewRouterWithCleanup(cfg, frontendDirs...)
	return router
}

// NewRouterWithCleanup exposes the persistence-resource cleanup required by
// the long-running server while keeping the lightweight test constructor.
func NewRouterWithCleanup(cfg config.Config, frontendDirs ...string) (*gin.Engine, func()) {
	return newRouterWithCleanup(cfg, persistenceStartupTimeout, newProjectDependencies, frontendDirs...)
}

type projectDependenciesInitializer func(context.Context, databaseConfig) projectDependencies

func newRouterWithCleanup(cfg config.Config, startupTimeout time.Duration, initializeDependencies projectDependenciesInitializer, frontendDirs ...string) (*gin.Engine, func()) {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery(), corsMiddleware())
	parser := floorplan.NewParser(ai.NewClientFromConfig(cfg))
	startupContext, cancelStartup := context.WithTimeout(context.Background(), startupTimeout)
	deps := initializeDependencies(startupContext, databaseConfig{
		DatabaseURL: cfg.DatabaseURL,
		S3Endpoint:  cfg.S3Endpoint,
		S3Bucket:    cfg.S3Bucket,
		S3AccessKey: cfg.S3AccessKey,
		S3SecretKey: cfg.S3SecretKey,
	})
	cancelStartup()
	databaseStatus, s3Status, databaseConfigured, s3Configured := projectStatusesFromDependencies(deps)

	router.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, healthResponse{
			Status:  "ok",
			Service: "homevox-backend",
			Time:    time.Now().UTC().Format(time.RFC3339),
		})
	})

	router.GET("/api/config", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"aiModel":            cfg.AIModel,
			"aiConfigured":       cfg.AIAPIKey != "" && cfg.AIBaseURL != "" && cfg.AIModel != "",
			"s3Configured":       s3Configured,
			"s3Status":           s3Status,
			"databaseConfigured": databaseConfigured,
			"databaseStatus":     databaseStatus,
		})
	})

	registerProjectRoutes(router, deps)

	router.POST("/api/floorplans/parse", func(c *gin.Context) {
		file, header, err := c.Request.FormFile("floorplan")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "field floorplan is required"})
			return
		}
		defer file.Close()

		if header.Size > maxFloorplanUploadBytes {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "floorplan image must be 10 MiB or smaller"})
			return
		}

		data, err := io.ReadAll(io.LimitReader(file, maxFloorplanUploadBytes+1))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read floorplan image"})
			return
		}
		if len(data) > maxFloorplanUploadBytes {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "floorplan image must be 10 MiB or smaller"})
			return
		}

		contentType, _, _, err := imagevalidate.Decode(data)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "floorplan must be a valid PNG, JPEG, GIF, or WebP image"})
			return
		}

		imageDataURL := fmt.Sprintf("data:%s;base64,%s", contentType, base64.StdEncoding.EncodeToString(data))
		result, err := parser.Parse(c.Request.Context(), imageDataURL)
		if err != nil {
			status := http.StatusBadGateway
			if cfg.AIAPIKey == "" || cfg.AIBaseURL == "" || cfg.AIModel == "" {
				status = http.StatusServiceUnavailable
			}
			c.JSON(status, gin.H{"error": err.Error()})
			return
		}

		document := floorplan.ParseResponse{
			Filename:    header.Filename,
			ContentType: contentType,
			Size:        len(data),
			Result:      result,
		}
		canonical, err := project.NormalizeDocument(mustJSON(document))
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "ai returned an invalid floorplan document"})
			return
		}
		c.JSON(http.StatusOK, canonical)
	})

	if len(frontendDirs) > 0 && frontendDirs[0] != "" {
		registerFrontend(router, frontendDirs[0])
	}

	return router, deps.Close
}

func mustJSON(value any) json.RawMessage {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(fmt.Sprintf("marshal canonical floorplan document: %v", err))
	}
	return encoded
}

func registerFrontend(router *gin.Engine, frontendDir string) {
	indexPath := filepath.Join(frontendDir, "index.html")

	router.NoRoute(func(c *gin.Context) {
		requestPath := c.Request.URL.Path
		if requestPath == "/api" || strings.HasPrefix(requestPath, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "API route not found"})
			return
		}
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.Status(http.StatusNotFound)
			return
		}

		cleanPath := filepath.Clean("/" + requestPath)
		if cleanPath == "/" {
			c.File(indexPath)
			return
		}

		candidate := filepath.Join(frontendDir, filepath.FromSlash(strings.TrimPrefix(cleanPath, "/")))
		info, err := os.Stat(candidate)
		if err == nil && !info.IsDir() {
			c.File(candidate)
			return
		}

		if strings.HasPrefix(cleanPath, "/assets/") || strings.Contains(filepath.Base(cleanPath), ".") {
			c.Status(http.StatusNotFound)
			return
		}
		c.File(indexPath)
	})
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
