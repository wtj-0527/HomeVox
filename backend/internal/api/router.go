package api

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/ai"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/config"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/floorplan"
	"github.com/gin-gonic/gin"
)

const maxFloorplanUploadBytes = 10 << 20

type healthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
	Time    string `json:"time"`
}

func NewRouter(cfg config.Config) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery(), corsMiddleware())
	parser := floorplan.NewParser(ai.NewClientFromConfig(cfg))

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
			"s3Configured":       cfg.S3Endpoint != "" && cfg.S3Bucket != "" && cfg.S3AccessKey != "" && cfg.S3SecretKey != "",
			"s3Status":           storageStatus(cfg),
			"databaseConfigured": false,
			"databaseStatus":     databaseStatus(cfg),
		})
	})

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

		contentType := http.DetectContentType(data)
		if contentType != "image/png" && contentType != "image/jpeg" && contentType != "image/gif" && contentType != "image/webp" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "floorplan must be a PNG, JPEG, GIF, or WebP image"})
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

		c.JSON(http.StatusOK, gin.H{
			"filename":    header.Filename,
			"contentType": contentType,
			"size":        len(data),
			"result":      result,
		})
	})

	return router
}

func storageStatus(cfg config.Config) string {
	if cfg.S3Endpoint == "" && cfg.S3Bucket == "" && cfg.S3AccessKey == "" && cfg.S3SecretKey == "" {
		return "not_configured"
	}
	if cfg.S3Endpoint == "" || cfg.S3Bucket == "" || cfg.S3AccessKey == "" || cfg.S3SecretKey == "" {
		return "incomplete_config"
	}
	return "configured_unverified"
}

func databaseStatus(cfg config.Config) string {
	if cfg.DatabaseURL == "" {
		return "not_configured"
	}
	return "phase0_placeholder_unverified"
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
