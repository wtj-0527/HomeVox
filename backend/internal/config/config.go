package config

import (
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	ListenAddr  string
	DatabaseURL string
	S3Endpoint  string
	S3Bucket    string
	S3AccessKey string
	S3SecretKey string
	AIBaseURL   string
	AIAPIKey    string
	AIModel     string
}

func Load() Config {
	_ = godotenv.Load()
	return Config{
		ListenAddr:  fixedListenAddr(),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		S3Endpoint:  os.Getenv("S3_ENDPOINT"),
		S3Bucket:    os.Getenv("S3_BUCKET"),
		S3AccessKey: os.Getenv("S3_ACCESS_KEY_ID"),
		S3SecretKey: os.Getenv("S3_SECRET_ACCESS_KEY"),
		AIBaseURL:   getEnv("AI_BASE_URL", "https://api.openai.com/v1"),
		AIAPIKey:    os.Getenv("AI_API_KEY"),
		AIModel:     getEnv("AI_MODEL", "gpt-4o-mini"),
	}
}

func fixedListenAddr() string {
	return "0.0.0.0:18088"
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
