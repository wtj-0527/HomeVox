package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/config"
)

func TestChatReturnsHTTPErrorWithBodySummary(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"missing api key"}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "", "test-model")
	_, err := client.Chat(context.Background(), []Message{{Role: "user", Content: "hi"}})
	if err == nil {
		t.Fatal("Chat returned nil error for HTTP 401")
	}
	msg := err.Error()
	if !strings.Contains(msg, "401 Unauthorized") || !strings.Contains(msg, "missing api key") {
		t.Fatalf("error = %q, want status and body summary", msg)
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
