package floorplan

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"

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
			Content: "You extract residential floor-plan structure. Return only one strict JSON object matching this schema: {rooms:[{name,type,approximate_bounds:{x1,y1,x2,y2},area_ratio}], walls:[{id,x1,y1,x2,y2}], doors:[{id,kind,wallId,position,width,confirmed}], windows:[{id,kind,wallId,position,width,confirmed}], scale:{unit,pixel_to_unit}, metadata:{source,confidence,image_width,image_height}}. Use pixel coordinates when exact scale is unknown. Never infer or fabricate wall associations, opening widths, architectural dimensions, scale, orientation, height, thickness, or load-bearing status.",
		},
		{
			Role: "user",
			Content: []map[string]any{
				{"type": "text", "text": "Parse this floor-plan image into the required JSON structure. Do not include markdown fences. Omit an opening if its wall-local position or width cannot be established."},
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
	result = normalizeParseResult(result)
	if err := validateParsedResult(result); err != nil {
		return ParseResult{}, err
	}
	return result, nil
}

func normalizeParseResult(result ParseResult) ParseResult {
	if result.Rooms == nil {
		result.Rooms = []Room{}
	}
	if result.Walls == nil {
		result.Walls = []Segment{}
	}
	if result.Doors == nil {
		result.Doors = []Opening{}
	}
	if result.Windows == nil {
		result.Windows = []Opening{}
	}
	for i := range result.Walls {
		if result.Walls[i].ID == "" {
			result.Walls[i].ID = fmt.Sprintf("wall-%d", i+1)
		}
	}
	normalize := func(items []Opening, kind string) {
		for i := range items {
			if items[i].ID == "" {
				items[i].ID = fmt.Sprintf("%s-%d", kind, i+1)
			}
			items[i].Kind = kind
			if items[i].Source == "" {
				items[i].Source = "ai"
			}
		}
	}
	normalize(result.Doors, "door")
	normalize(result.Windows, "window")
	return result
}

func validateParsedResult(result ParseResult) error {
	if strings.TrimSpace(result.Metadata.Source) == "" || strings.TrimSpace(result.Scale.Unit) == "" {
		return fmt.Errorf("ai result is missing required schema fields")
	}
	if !finite(result.Metadata.Confidence) || !finite(result.Scale.PixelToUnit) {
		return fmt.Errorf("ai result has invalid numeric metadata")
	}
	wallIDs := make(map[string]Segment, len(result.Walls))
	for i, wall := range result.Walls {
		if wall.ID == "" {
			return fmt.Errorf("wall[%d] id is required", i)
		}
		if _, exists := wallIDs[wall.ID]; exists {
			return fmt.Errorf("wall[%d] has duplicate id", i)
		}
		if !finite(wall.X1) || !finite(wall.Y1) || !finite(wall.X2) || !finite(wall.Y2) || math.Hypot(wall.X2-wall.X1, wall.Y2-wall.Y1) <= 0 {
			return fmt.Errorf("wall[%d] has invalid geometry", i)
		}
		wallIDs[wall.ID] = wall
	}
	seen := map[string]struct{}{}
	openings := append(append([]Opening{}, result.Doors...), result.Windows...)
	for i, opening := range openings {
		if opening.ID == "" || opening.WallID == "" || opening.Width <= 0 || opening.Position < 0 || opening.Position > 1 || !finite(opening.Width) || !finite(opening.Position) {
			return fmt.Errorf("opening[%d] lacks valid local wall geometry", i)
		}
		wall, ok := wallIDs[opening.WallID]
		if !ok {
			return fmt.Errorf("opening[%d] references missing wall", i)
		}
		if _, exists := seen[opening.ID]; exists {
			return fmt.Errorf("opening[%d] has duplicate id", i)
		}
		seen[opening.ID] = struct{}{}
		length := math.Hypot(wall.X2-wall.X1, wall.Y2-wall.Y1)
		half := opening.Width / length / 2
		if opening.Width >= length || opening.Position-half < 0 || opening.Position+half > 1 {
			return fmt.Errorf("opening[%d] exceeds wall endpoints", i)
		}
	}
	return nil
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

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
	if !ok || strings.TrimSpace(content) == "" {
		return "", fmt.Errorf("ai response message content is empty")
	}
	return content, nil
}
