package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/config"
)

func TestChatSanitizesHTTPErrorWithoutProviderBodyLeak(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"private provider detail"}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "", "test-model")
	_, err := client.Chat(context.Background(), []Message{{Role: "user", Content: "hi"}})
	if err == nil {
		t.Fatal("Chat returned nil error for HTTP 429")
	}
	if !strings.Contains(err.Error(), "HTTP 429") || strings.Contains(err.Error(), "private provider detail") {
		t.Fatalf("sanitized error = %q", err)
	}
}

func TestChatFailsClosedForServerErrorAndTimeout(t *testing.T) {
	for name, handler := range map[string]http.HandlerFunc{
		"server error": func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) },
		"timeout":      func(_ http.ResponseWriter, _ *http.Request) { time.Sleep(100 * time.Millisecond) },
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(handler)
			defer server.Close()
			client := NewClient(server.URL, "", "test-model")
			if name == "timeout" {
				client.HTTP.Timeout = time.Millisecond
			}
			if _, err := client.Chat(context.Background(), []Message{{Role: "user", Content: "hi"}}); err == nil {
				t.Fatal("expected fail-closed error")
			}
		})
	}
}

func TestNewClientFromConfigUsesAPIKey(t *testing.T) {
	client := NewClientFromConfig(config.Config{
		AIBaseURL: "https://example.test/v1",
		AIAPIKey:  "test-key",
		AIModel:   "test-model",
	})
	if client.BaseURL != "https://example.test/v1" {
		t.Fatalf("BaseURL = %q", client.BaseURL)
	}
	if client.APIKey != "test-key" {
		t.Fatal("APIKey was not copied from config")
	}
	if client.Model != "test-model" {
		t.Fatalf("Model = %q", client.Model)
	}
}
