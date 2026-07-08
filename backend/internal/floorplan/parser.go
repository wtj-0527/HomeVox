package floorplan

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/ai"
)

type Parser struct {
	client *ai.Client
}

func NewParser(client *ai.Client) *Parser {
	return &Parser{client: client}
}

func (p *Parser) Parse(ctx context.Context, imageDataURL string) (ParseResult, error) {
	if p.client == nil || p.client.APIKey == "" {
		return ParseResult{}, fmt.Errorf("AI_API_KEY is required to parse floor plans")
	}
	if p.client.BaseURL == "" || p.client.Model == "" {
		return ParseResult{}, fmt.Errorf("AI_BASE_URL and AI_MODEL are required to parse floor plans")
	}

	messages := []ai.Message{
		{
			Role:    "system",
			Content: "You extract residential floor-plan structure. Return only strict JSON matching this schema: {rooms:[{name,type,approximate_bounds:{x1,y1,x2,y2},area_ratio}], walls:[{x1,y1,x2,y2}], doors:[{type,x,y,from,to}], windows:[{type,x,y,from,to}], scale:{unit,pixel_to_unit}, metadata:{source,confidence,image_width,image_height}}. Use pixel coordinates when exact scale is unknown.",
		},
		{
			Role: "user",
			Content: []map[string]any{
				{"type": "text", "text": "Parse this floor-plan image into the required JSON structure. Do not include markdown fences."},
				{"type": "image_url", "image_url": map[string]string{"url": imageDataURL}},
			},
		},
	}

	response, err := p.client.Chat(ctx, messages)
	if err != nil {
		return ParseResult{}, err
	}
	content, err := firstChoiceContent(response)
	if err != nil {
		return ParseResult{}, err
	}

	var result ParseResult
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return ParseResult{}, fmt.Errorf("decode ai parse result: %w", err)
	}
	if result.Scale.Unit == "" {
		result.Scale.Unit = "pixel"
	}
	if result.Metadata.Source == "" {
		result.Metadata.Source = "ai"
	}
	return result, nil
}

func firstChoiceContent(response map[string]any) (string, error) {
	choices, ok := response["choices"].([]any)
	if !ok || len(choices) == 0 {
		return "", fmt.Errorf("ai response missing choices")
	}
	choice, ok := choices[0].(map[string]any)
	if !ok {
		return "", fmt.Errorf("ai response choice has invalid shape")
	}
	message, ok := choice["message"].(map[string]any)
	if !ok {
		return "", fmt.Errorf("ai response choice missing message")
	}
	content, ok := message["content"].(string)
	if !ok || content == "" {
		return "", fmt.Errorf("ai response message content is empty")
	}
	return content, nil
}
