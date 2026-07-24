package floorplan

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/ai"
)

func TestFirstChoiceContent(t *testing.T) {
	got, err := firstChoiceContent(map[string]any{
		"choices": []any{
			map[string]any{
				"message": map[string]any{"content": `{"rooms":[]}`},
			},
		},
	})
	if err != nil {
		t.Fatalf("firstChoiceContent returned error: %v", err)
	}
	if got != `{"rooms":[]}` {
		t.Fatalf("content = %q", got)
	}
}

func TestFirstChoiceContentRejectsMissingChoices(t *testing.T) {
	_, err := firstChoiceContent(map[string]any{})
	if err == nil {
		t.Fatal("firstChoiceContent returned nil error for missing choices")
	}
}

func TestNormalizeParseResultKeepsCollectionsAsEmptyArrays(t *testing.T) {
	result := normalizeParseResult(ParseResult{})

	body, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal normalized result: %v", err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("decode normalized result: %v", err)
	}
	for _, field := range []string{"rooms", "walls", "doors", "windows"} {
		items, ok := decoded[field].([]any)
		if !ok {
			t.Fatalf("%s marshaled as %T, want empty JSON array; body=%s", field, decoded[field], body)
		}
		if len(items) != 0 {
			t.Fatalf("%s length = %d, want 0", field, len(items))
		}
	}
}

func TestParseUsesOpenAICompatibleVisionContractAndRejectsUnconfirmedOpeningGeometry(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("authorization = %q", got)
		}
		var request struct {
			Model    string `json:"model"`
			Messages []struct {
				Content any `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request.Model != "vision-test" || len(request.Messages) != 2 {
			t.Fatalf("unexpected request: %#v", request)
		}
		parts, ok := request.Messages[1].Content.([]any)
		if !ok || len(parts) != 2 {
			t.Fatalf("multimodal content = %#v", request.Messages[1].Content)
		}
		image, ok := parts[1].(map[string]any)
		if !ok || !strings.HasPrefix(image["image_url"].(map[string]any)["url"].(string), "data:image/png;base64,") {
			t.Fatalf("image content = %#v", parts[1])
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"rooms\":[],\"walls\":[{\"x1\":0,\"y1\":0,\"x2\":100,\"y2\":0}],\"doors\":[{\"type\":\"door\",\"x\":50,\"y\":0}],\"windows\":[],\"scale\":{\"unit\":\"px\"},\"metadata\":{\"source\":\"fake\"}}"}}]}`))
	}))
	defer server.Close()

	parser := NewParser(ai.NewClient(server.URL+"/v1", "test-key", "vision-test"))
	_, err := parser.Parse(context.Background(), "data:image/png;base64,cG5n")
	if err == nil || !strings.Contains(err.Error(), "lacks valid local wall geometry") {
		t.Fatalf("error = %v, want fail-closed local-geometry error", err)
	}
}

func TestParseRejectsInvalidOpenAIEnvelopes(t *testing.T) {
	for name, body := range map[string]string{
		"non JSON":       `not-json`,
		"empty choices":  `{"choices":[]}`,
		"empty content":  `{"choices":[{"message":{"content":""}}]}`,
		"markdown fence": "{\"choices\":[{\"message\":{\"content\":\"```json\\n{}\\n```\"}}]}",
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }))
			defer server.Close()
			_, err := NewParser(ai.NewClient(server.URL, "test-key", "vision-test")).Parse(context.Background(), "data:image/png;base64,cG5n")
			if err == nil {
				t.Fatal("expected fail-closed parser error")
			}
		})
	}
}
