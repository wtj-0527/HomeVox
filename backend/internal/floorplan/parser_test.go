package floorplan

import (
	"encoding/json"
	"testing"
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
