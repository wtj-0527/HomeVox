package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/config"
)

func TestRouterAppliesCorsHeaders(t *testing.T) {
	router := NewRouter(config.Config{})
	req := httptest.NewRequest(http.MethodOptions, "/api/config", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", http.MethodGet)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want *", got)
	}
	if got := w.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Fatal("Access-Control-Allow-Methods header missing")
	}
	if w.Code != http.StatusNoContent {
		t.Fatalf("OPTIONS status = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestConfigDoesNotReportDatabaseReadyFromURLAlone(t *testing.T) {
	router := NewRouter(config.Config{DatabaseURL: "postgres://example"})
	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["databaseConfigured"] != false {
		t.Fatalf("databaseConfigured = %v, want false until connection checks exist", body["databaseConfigured"])
	}
	if body["databaseStatus"] != "phase0_placeholder_unverified" {
		t.Fatalf("databaseStatus = %v", body["databaseStatus"])
	}
}

func TestConfigRequiresCompleteS3Credentials(t *testing.T) {
	router := NewRouter(config.Config{S3Endpoint: "https://s3.example", S3Bucket: "homevox"})
	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["s3Configured"] != false {
		t.Fatalf("s3Configured = %v, want false without credentials", body["s3Configured"])
	}
	if body["s3Status"] != "incomplete_config" {
		t.Fatalf("s3Status = %v", body["s3Status"])
	}
}
