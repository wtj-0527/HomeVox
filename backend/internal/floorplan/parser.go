package floorplan

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strings"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/ai"
)

const visionSystemPrompt = "You extract residential floor-plan structure. Return only one strict JSON object matching this schema: {rooms:[{name,type,approximate_bounds:{x1,y1,x2,y2},area_ratio}], walls:[{id,x1,y1,x2,y2}], doors:[{id,kind,wallId,position,width,source,confirmed}], windows:[{id,kind,wallId,position,width,source,confirmed}], scale:{unit,pixel_to_unit}, metadata:{source,confidence,image_width,image_height}}. Every listed field is required, no additional fields are accepted, and arrays may be empty. Use pixel coordinates when exact scale is unknown. Never infer or fabricate wall associations, opening widths, architectural dimensions, scale, orientation, height, thickness, or load-bearing status."
const visionUserPrompt = "Parse this floor-plan image into the required JSON structure. Do not include markdown fences. Omit an opening if its wall-local position or width cannot be established."

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
			Content: visionSystemPrompt,
		},
		{
			Role: "user",
			Content: []map[string]any{
				{"type": "text", "text": visionUserPrompt},
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

	result, err := decodeCanonicalParseResult(content)
	if err != nil {
		return ParseResult{}, err
	}
	if err := validateParsedResult(result); err != nil {
		return ParseResult{}, err
	}
	// Vision output is an unmeasured interpretation, never an architectural
	// confirmation. Preserve only explicit manual/measurement confirmations.
	for i := range result.Doors {
		result.Doors[i].Confirmed = false
	}
	for i := range result.Windows {
		result.Windows[i].Confirmed = false
	}
	return result, nil
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
		if opening.ID == "" || (opening.Kind != "door" && opening.Kind != "window") || opening.WallID == "" || strings.TrimSpace(opening.Source) == "" || opening.Width <= 0 || opening.Position < 0 || opening.Position > 1 || !finite(opening.Width) || !finite(opening.Position) {
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

// decodeCanonicalParseResult validates raw model output before decoding it.
// encoding/json otherwise silently accepts unknown and duplicate object keys,
// and cannot distinguish omitted scalar values from their Go zero values.
func decodeCanonicalParseResult(content string) (ParseResult, error) {
	decoder := json.NewDecoder(strings.NewReader(content))
	if err := validateJSONValue(decoder, true); err != nil {
		return ParseResult{}, fmt.Errorf("decode ai parse result: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return ParseResult{}, fmt.Errorf("decode ai parse result: trailing JSON value")
		}
		return ParseResult{}, fmt.Errorf("decode ai parse result: trailing content: %w", err)
	}

	var root map[string]json.RawMessage
	if err := json.Unmarshal([]byte(content), &root); err != nil {
		return ParseResult{}, fmt.Errorf("decode ai parse result: %w", err)
	}
	if err := validateObject(root, map[string]rawValidator{
		"rooms":    validateRooms,
		"walls":    validateWalls,
		"doors":    validateDoors("door"),
		"windows":  validateDoors("window"),
		"scale":    validateScale,
		"metadata": validateMetadata,
	}); err != nil {
		return ParseResult{}, fmt.Errorf("decode ai parse result: %w", err)
	}

	var result ParseResult
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return ParseResult{}, fmt.Errorf("decode ai parse result: %w", err)
	}
	return result, nil
}

type rawValidator func(json.RawMessage) error

func validateJSONValue(decoder *json.Decoder, root bool) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delim, isDelim := token.(json.Delim)
	if !isDelim {
		if root {
			return fmt.Errorf("top-level value must be an object")
		}
		return nil
	}
	switch delim {
	case '{':
		seen := map[string]struct{}{}
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return fmt.Errorf("object key is not a string")
			}
			if _, duplicate := seen[key]; duplicate {
				return fmt.Errorf("duplicate key %q", key)
			}
			seen[key] = struct{}{}
			if err := validateJSONValue(decoder, false); err != nil {
				return err
			}
		}
		end, err := decoder.Token()
		if err != nil || end != json.Delim('}') {
			return fmt.Errorf("invalid object termination")
		}
	case '[':
		for decoder.More() {
			if err := validateJSONValue(decoder, false); err != nil {
				return err
			}
		}
		end, err := decoder.Token()
		if err != nil || end != json.Delim(']') {
			return fmt.Errorf("invalid array termination")
		}
	default:
		return fmt.Errorf("invalid JSON delimiter")
	}
	return nil
}

func validateObject(object map[string]json.RawMessage, fields map[string]rawValidator) error {
	if len(object) != len(fields) {
		for key := range object {
			if _, known := fields[key]; !known {
				return fmt.Errorf("unknown field %q", key)
			}
		}
		for key := range fields {
			if _, present := object[key]; !present {
				return fmt.Errorf("missing required field %q", key)
			}
		}
		return fmt.Errorf("invalid object field count")
	}
	for key, validator := range fields {
		value, present := object[key]
		if !present {
			return fmt.Errorf("missing required field %q", key)
		}
		if err := validator(value); err != nil {
			return fmt.Errorf("field %q: %w", key, err)
		}
	}
	return nil
}

func decodeObject(raw json.RawMessage) (map[string]json.RawMessage, error) {
	if string(raw) == "null" {
		return nil, fmt.Errorf("must be an object, not null")
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return nil, fmt.Errorf("must be an object")
	}
	return object, nil
}

func validateArray(raw json.RawMessage, item rawValidator) error {
	if string(raw) == "null" {
		return fmt.Errorf("must be an array, not null")
	}
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil || items == nil {
		return fmt.Errorf("must be an array")
	}
	for i, value := range items {
		if err := item(value); err != nil {
			return fmt.Errorf("item[%d]: %w", i, err)
		}
	}
	return nil
}

func validateString(raw json.RawMessage) error {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	if _, ok := value.(string); !ok {
		return fmt.Errorf("must be a string")
	}
	return nil
}

func validateBoolean(raw json.RawMessage) error {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	if _, ok := value.(bool); !ok {
		return fmt.Errorf("must be a boolean")
	}
	return nil
}

func validateNumber(raw json.RawMessage) error {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	if _, ok := value.(float64); !ok {
		return fmt.Errorf("must be a number")
	}
	return nil
}

func validateInteger(raw json.RawMessage) error {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	number, ok := value.(float64)
	if !ok || math.Trunc(number) != number {
		return fmt.Errorf("must be an integer")
	}
	return nil
}

func validateRooms(raw json.RawMessage) error {
	return validateArray(raw, func(item json.RawMessage) error {
		object, err := decodeObject(item)
		if err != nil {
			return err
		}
		return validateObject(object, map[string]rawValidator{
			"name":               validateString,
			"type":               validateString,
			"approximate_bounds": validateBounds,
			"area_ratio":         validateNumber,
		})
	})
}

func validateBounds(raw json.RawMessage) error {
	object, err := decodeObject(raw)
	if err != nil {
		return err
	}
	return validateObject(object, map[string]rawValidator{
		"x1": validateNumber, "y1": validateNumber, "x2": validateNumber, "y2": validateNumber,
	})
}

func validateWalls(raw json.RawMessage) error {
	return validateArray(raw, func(item json.RawMessage) error {
		object, err := decodeObject(item)
		if err != nil {
			return err
		}
		return validateObject(object, map[string]rawValidator{
			"id": validateString, "x1": validateNumber, "y1": validateNumber, "x2": validateNumber, "y2": validateNumber,
		})
	})
}

func validateDoors(expectedKind string) rawValidator {
	return func(raw json.RawMessage) error {
		return validateArray(raw, func(item json.RawMessage) error {
			object, err := decodeObject(item)
			if err != nil {
				return err
			}
			if err := validateObject(object, map[string]rawValidator{
				"id": validateString, "kind": validateString, "wallId": validateString, "position": validateNumber,
				"width": validateNumber, "source": validateString, "confirmed": validateBoolean,
			}); err != nil {
				return err
			}
			var kind string
			if err := json.Unmarshal(object["kind"], &kind); err != nil || kind != expectedKind {
				return fmt.Errorf("kind must be %q", expectedKind)
			}
			return nil
		})
	}
}

func validateScale(raw json.RawMessage) error {
	object, err := decodeObject(raw)
	if err != nil {
		return err
	}
	return validateObject(object, map[string]rawValidator{"unit": validateString, "pixel_to_unit": validateNumber})
}

func validateMetadata(raw json.RawMessage) error {
	object, err := decodeObject(raw)
	if err != nil {
		return err
	}
	return validateObject(object, map[string]rawValidator{
		"source": validateString, "confidence": validateNumber, "image_width": validateInteger, "image_height": validateInteger,
	})
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
	if !ok || strings.TrimSpace(content) == "" {
		return "", fmt.Errorf("ai response message content is empty")
	}
	return content, nil
}
