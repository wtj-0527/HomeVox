package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

func TestConfigReportsUnavailableDatabaseWhenConfiguredConnectionFails(t *testing.T) {
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
	if body["databaseStatus"] != "unavailable" {
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

func TestConfiguredUnresponsivePersistenceOnlyDisablesProjectAPIs(t *testing.T) {
	frontendDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(frontendDir, "index.html"), []byte("<main>HomeVox shell</main>"), 0o644); err != nil {
		t.Fatalf("write index: %v", err)
	}

	started := time.Now()
	router, cleanup := newRouterWithCleanup(
		config.Config{DatabaseURL: "postgres://unresponsive"},
		20*time.Millisecond,
		func(ctx context.Context, _ databaseConfig) projectDependencies {
			<-ctx.Done()
			return projectDependencies{databaseStatus: statusUnavailable, s3Status: statusNotConfigured}
		},
		frontendDir,
	)
	defer cleanup()
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("router startup took %s despite bounded persistence context", elapsed)
	}

	for _, tc := range []struct {
		path       string
		wantStatus int
		wantBody   string
	}{
		{path: "/api/health", wantStatus: http.StatusOK, wantBody: `"status":"ok"`},
		{path: "/", wantStatus: http.StatusOK, wantBody: "HomeVox shell"},
		{path: "/api/projects", wantStatus: http.StatusServiceUnavailable, wantBody: "persistence_unavailable"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if w.Code != tc.wantStatus {
				t.Fatalf("%s status = %d, want %d; body=%s", tc.path, w.Code, tc.wantStatus, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), tc.wantBody) {
				t.Fatalf("%s body = %q, want substring %q", tc.path, w.Body.String(), tc.wantBody)
			}
		})
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
	_, _ = part.Write(validPNG(t))
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

func TestParseFloorplanBindsProviderCoordinatesToDecodedImageDimensions(t *testing.T) {
	content := `{"rooms":[],"walls":[{"id":"wall-1","x1":0,"y1":0,"x2":1,"y2":0}],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"vision","confidence":0.8,"image_width":20,"image_height":30}}`
	vision := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Messages []struct {
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || len(request.Messages) != 2 {
			t.Fatalf("decode request: %v", err)
		}
		var user []struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal(request.Messages[1].Content, &user); err != nil || len(user) != 2 ||
			!strings.Contains(user[0].Text, "exactly 2 pixels wide and 3 pixels high") {
			t.Fatalf("dimension-bound prompt = %s", request.Messages[1].Content)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"choices":[{"message":{"content":%q}}]}`, content)
	}))
	defer vision.Close()
	router := NewRouter(config.Config{AIBaseURL: vision.URL, AIAPIKey: "controlled-test-key", AIModel: "test-model"})
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("floorplan", "effective-crop.png")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(validPNG(t)) // 2 × 3 pixels
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/floorplans/parse", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var parsed struct {
		Result struct {
			Metadata struct {
				ImageWidth  int `json:"image_width"`
				ImageHeight int `json:"image_height"`
			} `json:"metadata"`
		} `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if parsed.Result.Metadata.ImageWidth != 2 || parsed.Result.Metadata.ImageHeight != 3 {
		t.Fatalf("metadata dimensions = %dx%d, want decoded 2x3", parsed.Result.Metadata.ImageWidth, parsed.Result.Metadata.ImageHeight)
	}
}

func TestParseFloorplanClassifiesInvalidAIOutputWithoutLeakingDiagnostics(t *testing.T) {
	tests := map[string]struct {
		content  string
		wantCode string
		wantText string
	}{
		"schema": {
			content:  `{"rooms":[],"walls":[{"id":"wall-1","x1":0,"y1":0,"x2":100,"y2":0}],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":"unknown"},"metadata":{"source":"vision","confidence":0.8,"image_width":100,"image_height":80}}`,
			wantCode: "ai_schema_invalid",
			wantText: "格式不完整",
		},
		"unreliable topology": {
			content:  `{"rooms":[],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"vision","confidence":0.2,"image_width":100,"image_height":80}}`,
			wantCode: "ai_content_unreliable",
			wantText: "裁切",
		},
	}
	for name, testCase := range tests {
		t.Run(name, func(t *testing.T) {
			vision := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprintf(w, `{"choices":[{"message":{"content":%q}}]}`, testCase.content)
			}))
			defer vision.Close()
			router := NewRouter(config.Config{AIBaseURL: vision.URL, AIAPIKey: "test-key", AIModel: "test-model"})
			body := &bytes.Buffer{}
			writer := multipart.NewWriter(body)
			part, err := writer.CreateFormFile("floorplan", "plan.png")
			if err != nil {
				t.Fatalf("create form file: %v", err)
			}
			_, _ = part.Write(validPNG(t))
			if err := writer.Close(); err != nil {
				t.Fatalf("close multipart writer: %v", err)
			}
			request := httptest.NewRequest(http.MethodPost, "/api/floorplans/parse", body)
			request.Header.Set("Content-Type", writer.FormDataContentType())
			response := httptest.NewRecorder()

			router.ServeHTTP(response, request)

			if response.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
			}
			var payload struct {
				Code  string `json:"code"`
				Error string `json:"error"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if payload.Code != testCase.wantCode || !strings.Contains(payload.Error, testCase.wantText) {
				t.Fatalf("payload = %#v", payload)
			}
			if strings.Contains(payload.Error, "pixel_to_unit") || strings.Contains(payload.Error, "decode ai") {
				t.Fatalf("internal parser diagnostics leaked: %q", payload.Error)
			}
		})
	}
}

type routerTestCase struct {
	name        string
	method      string
	path        string
	wantStatus  int
	wantBody    string
	contentType string
}

func TestRouterServesFrontendAndSPAFallback(t *testing.T) {
	frontendDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(frontendDir, "assets"), 0o755); err != nil {
		t.Fatalf("create assets dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(frontendDir, "index.html"), []byte("<main>HomeVox shell</main>"), 0o644); err != nil {
		t.Fatalf("write index: %v", err)
	}
	if err := os.WriteFile(filepath.Join(frontendDir, "assets", "app.js"), []byte("window.homevox = true"), 0o644); err != nil {
		t.Fatalf("write asset: %v", err)
	}
	if err := os.WriteFile(filepath.Join(frontendDir, "assets", "homevox.wasm"), []byte("\x00asm"), 0o644); err != nil {
		t.Fatalf("write wasm asset: %v", err)
	}

	router := NewRouter(config.Config{}, frontendDir)

	for _, tc := range []routerTestCase{
		{name: "root", method: http.MethodGet, path: "/", wantStatus: http.StatusOK, wantBody: "HomeVox shell", contentType: "text/html"},
		{name: "asset", method: http.MethodGet, path: "/assets/app.js", wantStatus: http.StatusOK, wantBody: "window.homevox = true", contentType: "text/javascript"},
		{name: "wasm asset", method: http.MethodGet, path: "/assets/homevox.wasm", wantStatus: http.StatusOK, wantBody: "\x00asm", contentType: "application/wasm"},
		{name: "wasm asset head", method: http.MethodHead, path: "/assets/homevox.wasm", wantStatus: http.StatusOK, contentType: "application/wasm"},
		{name: "client route", method: http.MethodGet, path: "/projects/demo", wantStatus: http.StatusOK, wantBody: "HomeVox shell", contentType: "text/html"},
		{name: "post client route", method: http.MethodPost, path: "/projects/demo", wantStatus: http.StatusNotFound},
		{name: "missing asset", method: http.MethodGet, path: "/assets/missing.js", wantStatus: http.StatusNotFound},
		{name: "extensionless missing asset", method: http.MethodGet, path: "/assets/missing", wantStatus: http.StatusNotFound},
		{name: "api namespace root", method: http.MethodGet, path: "/api", wantStatus: http.StatusNotFound, contentType: "application/json"},
		{name: "unknown api", method: http.MethodGet, path: "/api/missing", wantStatus: http.StatusNotFound, contentType: "application/json"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Fatalf("GET %s status = %d, want %d; body=%s", tc.path, w.Code, tc.wantStatus, w.Body.String())
			}
			if tc.wantBody != "" && !strings.Contains(w.Body.String(), tc.wantBody) {
				t.Fatalf("GET %s body = %q, want substring %q", tc.path, w.Body.String(), tc.wantBody)
			}
			if tc.contentType != "" && !strings.Contains(w.Header().Get("Content-Type"), tc.contentType) {
				t.Fatalf("GET %s Content-Type = %q, want %q", tc.path, w.Header().Get("Content-Type"), tc.contentType)
			}
		})
	}
}

func TestParseFloorplanRejectsCorruptImagesBeforeVision(t *testing.T) {
	visionCalls := 0
	vision := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		visionCalls++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer vision.Close()
	router := NewRouter(config.Config{AIBaseURL: vision.URL, AIAPIKey: "test-key", AIModel: "vision-test"})

	for name, data := range map[string][]byte{
		"PNG":  {0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'},
		"JPEG": {0xff, 0xd8, 0xff},
		"GIF":  []byte("GIF89a\x02\x00"),
		"WebP": []byte("RIFF\x24\x00\x00\x00WEBPVP8 "),
	} {
		t.Run(name, func(t *testing.T) {
			body := &bytes.Buffer{}
			writer := multipart.NewWriter(body)
			part, err := writer.CreateFormFile("floorplan", "corrupt-image")
			if err != nil {
				t.Fatalf("create form file: %v", err)
			}
			if _, err := part.Write(data); err != nil {
				t.Fatalf("write image: %v", err)
			}
			if err := writer.Close(); err != nil {
				t.Fatalf("close multipart writer: %v", err)
			}
			req := httptest.NewRequest(http.MethodPost, "/api/floorplans/parse", body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
			}
		})
	}
	if visionCalls != 0 {
		t.Fatalf("corrupt images reached Vision %d times", visionCalls)
	}
}

func TestAnalyzeFloorplanCandidatesReturnsSourcePixelRectsAndFailsClosed(t *testing.T) {
	vision := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"mode\":\"single\",\"candidates\":[{\"x\":1,\"y\":2,\"width\":10,\"height\":10}]}"}}]}`))
	}))
	defer vision.Close()
	router := NewRouter(config.Config{AIBaseURL: vision.URL, AIAPIKey: "test-key", AIModel: "test-model"})
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("floorplan", "plan.png")
	if err != nil {
		t.Fatal(err)
	}
	imageData := &bytes.Buffer{}
	if err := png.Encode(imageData, image.NewRGBA(image.Rect(0, 0, 20, 20))); err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(imageData.Bytes())
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/floorplans/candidates", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"mode":"single"`) || !strings.Contains(response.Body.String(), `"width":10`) {
		t.Fatalf("body=%s", response.Body.String())
	}
}
