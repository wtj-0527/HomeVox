package api

import (
	"net/http"
	"time"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/config"
	"github.com/gin-gonic/gin"
)

type healthResponse struct {
	Status string `json:"status"`
	Service string `json:"service"`
	Time string `json:"time"`
}

func NewRouter(cfg config.Config) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())

	router.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, healthResponse{
			Status: "ok",
			Service: "homevox-backend",
			Time: time.Now().UTC().Format(time.RFC3339),
		})
	})

	router.GET("/api/config", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"aiModel": cfg.AIModel,
			"s3Configured": cfg.S3Endpoint != "" && cfg.S3Bucket != "",
			"databaseConfigured": cfg.DatabaseURL != "",
		})
	})

	return router
}
