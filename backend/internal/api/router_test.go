package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
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

func TestParseFloorplanRequiresImageFile(t *testing.T) {
	router := NewRouter(config.Config{})
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("floorplan", "plan.txt")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	_, _ = part.Write([]byte("not an image"))
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/floorplans/parse", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("parse status = %d, want %d; body=%s", w.Code, http.StatusBadRequest, w.Body.String())
	}
}

func TestParseFloorplanReportsMissingAIConfig(t *testing.T) {
	router := NewRouter(config.Config{AIBaseURL: "https://example.test/v1", AIModel: "test-model"})
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("floorplan", "plan.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	_, _ = part.Write([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0})
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/floorplans/parse", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("parse status = %d, want %d; body=%s", w.Code, http.StatusServiceUnavailable, w.Body.String())
	}
}
