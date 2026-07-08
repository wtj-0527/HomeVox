package floorplan

import "testing"

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
