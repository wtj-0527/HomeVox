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
	AIBaseURL   string
	AIModel     string
}

func Load() Config {
	_ = godotenv.Load()
	return Config{
		ListenAddr:  fixedListenAddr(),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		S3Endpoint:  os.Getenv("S3_ENDPOINT"),
		S3Bucket:    os.Getenv("S3_BUCKET"),
		AIBaseURL:   getEnv("AI_BASE_URL", "https://api.openai.com/v1"),
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
