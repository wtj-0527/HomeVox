package floorplan

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/ai"
)

const visionSystemPrompt = "You extract residential floor-plan structure. Return only one strict JSON object matching this schema: {rooms:[{name,type,approximate_bounds:{x1,y1,x2,y2},area_ratio}], walls:[{id,x1,y1,x2,y2}], doors:[{id,kind,wallId,position,width,source,confirmed}], windows:[{id,kind,wallId,position,width,source,confirmed}], scale:{unit,pixel_to_unit}, metadata:{source,confidence,image_width,image_height}}. Every listed field is required, no additional fields are accepted, and arrays may be empty. All coordinates and opening widths are image pixels. scale.pixel_to_unit must be either a finite number or null, never a string: when no physical scale is explicitly visible, return exactly scale:{unit:\"px\",pixel_to_unit:null}; do not infer a conversion, orientation, height, thickness, or load-bearing status. metadata.confidence must be a finite number and image_width/image_height must be integers."
const visionUserPrompt = "Parse this floor-plan image into the required JSON structure. Do not include markdown fences. Omit an opening if its wall-local position or width cannot be established."
const dimensionedVisionUserPrompt = "Parse this floor-plan image into the required JSON structure. The original uploaded image is exactly %d pixels wide and %d pixels high. Use that exact original %d x %d pixel coordinate grid for every room bound, wall endpoint, and opening width, and return metadata.image_width exactly %d and metadata.image_height exactly %d. Do not include markdown fences. Omit an opening if its wall-local position or width cannot be established."
const candidateSystemPrompt = "Find reliable single-floor-plan crops in this source image. Return only one strict JSON object matching this schema: {mode:string,candidates:[{x:number,y:number,width:number,height:number}]}. mode must be exactly one of \"single\", \"composite\", or \"uncertain\". Candidates must be absolute integer-pixel rectangles on the source image. Return mode \"uncertain\" with candidates:[] when no reliable crop can be established. Return \"single\" with exactly one candidate; return \"composite\" with two or more non-overlapping candidates. Do not add fields or markdown."
const candidateUserPrompt = "Detect reliable crop rectangles that each contain one standalone floor plan. Do not guess a crop when the image is ambiguous."

const minCandidateAreaPixels = 64

type ParseErrorCode string

const (
	ParseErrorTransport ParseErrorCode = "transport"
	ParseErrorSchema    ParseErrorCode = "schema"
	ParseErrorContent   ParseErrorCode = "content"
)

type ParseError struct {
	Code ParseErrorCode
	Err  error
}

func (e *ParseError) Error() string { return e.Err.Error() }
func (e *ParseError) Unwrap() error { return e.Err }

func ErrorCode(err error) ParseErrorCode {
	var parseError *ParseError
	if errors.As(err, &parseError) {
		return parseError.Code
	}
	return ParseErrorTransport
}

type Parser struct {
	client *ai.Client
}

func NewParser(client *ai.Client) *Parser {
	return &Parser{client: client}
}

func (p *Parser) Parse(ctx context.Context, imageDataURL string) (ParseResult, error) {
	return p.parse(ctx, imageDataURL, visionUserPrompt, 0, 0)
}

func (p *Parser) ParseAtDimensions(ctx context.Context, imageDataURL string, imageWidth, imageHeight int) (ParseResult, error) {
	if imageWidth <= 0 || imageHeight <= 0 {
		return ParseResult{}, &ParseError{Code: ParseErrorContent, Err: fmt.Errorf("source image dimensions must be positive")}
	}
	prompt := fmt.Sprintf(dimensionedVisionUserPrompt, imageWidth, imageHeight, imageWidth, imageHeight, imageWidth, imageHeight)
	return p.parse(ctx, imageDataURL, prompt, imageWidth, imageHeight)
}

func (p *Parser) parse(ctx context.Context, imageDataURL, userPrompt string, imageWidth, imageHeight int) (ParseResult, error) {
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
				{"type": "text", "text": userPrompt},
				{"type": "image_url", "image_url": map[string]string{"url": imageDataURL}},
			},
		},
	}

	response, err := p.client.Chat(ctx, messages)
	if err != nil {
		return ParseResult{}, &ParseError{Code: ParseErrorTransport, Err: err}
	}
	content, err := firstChoiceContent(response)
	if err != nil {
		return ParseResult{}, &ParseError{Code: ParseErrorSchema, Err: err}
	}

	result, err := decodeCanonicalParseResult(content)
	if err != nil {
		return ParseResult{}, &ParseError{Code: ParseErrorSchema, Err: err}
	}
	if imageWidth > 0 && imageHeight > 0 {
		// Provider preprocessing may self-report different dimensions even when
		// the returned geometry follows the requested source-pixel grid. Decoded
		// upload bytes remain authoritative; geometry is checked against those
		// bounds below instead of trusting provider metadata.
		result.Metadata.ImageWidth = imageWidth
		result.Metadata.ImageHeight = imageHeight
	}
	if err := validateParsedResult(result); err != nil {
		return ParseResult{}, &ParseError{Code: ParseErrorContent, Err: err}
	}
	if imageWidth > 0 && imageHeight > 0 {
		if err := validateParsedBounds(result, imageWidth, imageHeight); err != nil {
			return ParseResult{}, &ParseError{Code: ParseErrorContent, Err: err}
		}
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

func validateParsedBounds(result ParseResult, imageWidth, imageHeight int) error {
	inBounds := func(x, y float64) bool {
		return x >= 0 && x <= float64(imageWidth) && y >= 0 && y <= float64(imageHeight)
	}
	for i, room := range result.Rooms {
		bounds := room.ApproximateBounds
		if bounds.X1 > bounds.X2 || bounds.Y1 > bounds.Y2 || !inBounds(bounds.X1, bounds.Y1) || !inBounds(bounds.X2, bounds.Y2) {
			return fmt.Errorf("room[%d] exceeds source image bounds", i)
		}
	}
	for i, wall := range result.Walls {
		if !inBounds(wall.X1, wall.Y1) || !inBounds(wall.X2, wall.Y2) {
			return fmt.Errorf("wall[%d] exceeds source image bounds", i)
		}
	}
	return nil
}

// AnalyzeCandidates finds reliable source-image crop candidates without
// creating a fallback rectangle. Returned coordinates stay in original pixels.
func (p *Parser) AnalyzeCandidates(ctx context.Context, imageDataURL string, imageWidth, imageHeight int) (CandidateDetection, error) {
	if p.client == nil || p.client.APIKey == "" {
		return CandidateDetection{}, fmt.Errorf("AI_API_KEY is required to analyze floor-plan candidates")
	}
	if p.client.BaseURL == "" || p.client.Model == "" {
		return CandidateDetection{}, fmt.Errorf("AI_BASE_URL and AI_MODEL are required to analyze floor-plan candidates")
	}
	if imageWidth <= 0 || imageHeight <= 0 {
		return CandidateDetection{}, &ParseError{Code: ParseErrorContent, Err: fmt.Errorf("source image dimensions must be positive")}
	}
	response, err := p.client.Chat(ctx, []ai.Message{
		{Role: "system", Content: candidateSystemPrompt},
		{Role: "user", Content: []map[string]any{
			{"type": "text", "text": candidateUserPrompt},
			{"type": "image_url", "image_url": map[string]string{"url": imageDataURL}},
		}},
	})
	if err != nil {
		return CandidateDetection{}, &ParseError{Code: ParseErrorTransport, Err: err}
	}
	content, err := firstChoiceContent(response)
	if err != nil {
		return CandidateDetection{}, &ParseError{Code: ParseErrorSchema, Err: err}
	}
	result, err := decodeCandidateDetection(content)
	if err != nil {
		return CandidateDetection{}, &ParseError{Code: ParseErrorSchema, Err: err}
	}
	if err := validateCandidateDetection(result, imageWidth, imageHeight); err != nil {
		return CandidateDetection{}, &ParseError{Code: ParseErrorContent, Err: err}
	}
	return result, nil
}

func decodeCandidateDetection(content string) (CandidateDetection, error) {
	decoder := json.NewDecoder(strings.NewReader(content))
	if err := validateJSONValue(decoder, true); err != nil {
		return CandidateDetection{}, fmt.Errorf("decode ai candidate result: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return CandidateDetection{}, fmt.Errorf("decode ai candidate result: trailing JSON value")
		}
		return CandidateDetection{}, fmt.Errorf("decode ai candidate result: trailing content: %w", err)
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal([]byte(content), &root); err != nil {
		return CandidateDetection{}, fmt.Errorf("decode ai candidate result: %w", err)
	}
	if err := validateObject(root, map[string]rawValidator{
		"mode": validateString, "candidates": validateCandidateRects,
	}); err != nil {
		return CandidateDetection{}, fmt.Errorf("decode ai candidate result: %w", err)
	}
	var result CandidateDetection
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return CandidateDetection{}, fmt.Errorf("decode ai candidate result: %w", err)
	}
	return result, nil
}

func validateCandidateRects(raw json.RawMessage) error {
	return validateArray(raw, func(item json.RawMessage) error {
		object, err := decodeObject(item)
		if err != nil {
			return err
		}
		return validateObject(object, map[string]rawValidator{
			"x": validateNumber, "y": validateNumber, "width": validateNumber, "height": validateNumber,
		})
	})
}

func validateCandidateDetection(result CandidateDetection, imageWidth, imageHeight int) error {
	switch result.Mode {
	case CandidateModeUncertain:
		if len(result.Candidates) != 0 {
			return fmt.Errorf("uncertain candidate detection must not fabricate candidates")
		}
		return nil
	case CandidateModeSingle:
		if len(result.Candidates) != 1 {
			return fmt.Errorf("single candidate detection must contain exactly one candidate")
		}
	case CandidateModeComposite:
		if len(result.Candidates) < 2 {
			return fmt.Errorf("composite candidate detection must contain at least two candidates")
		}
	default:
		return fmt.Errorf("candidate detection has invalid mode")
	}
	for i, candidate := range result.Candidates {
		if !finite(candidate.X) || !finite(candidate.Y) || !finite(candidate.Width) || !finite(candidate.Height) ||
			math.Trunc(candidate.X) != candidate.X || math.Trunc(candidate.Y) != candidate.Y ||
			math.Trunc(candidate.Width) != candidate.Width || math.Trunc(candidate.Height) != candidate.Height ||
			candidate.X < 0 || candidate.Y < 0 || candidate.Width <= 0 || candidate.Height <= 0 ||
			candidate.Width*candidate.Height < minCandidateAreaPixels ||
			candidate.X+candidate.Width > float64(imageWidth) || candidate.Y+candidate.Height > float64(imageHeight) {
			return fmt.Errorf("candidate[%d] has invalid source-pixel rectangle", i)
		}
		for j := 0; j < i; j++ {
			if overlaps(candidate, result.Candidates[j]) {
				return fmt.Errorf("candidate[%d] overlaps candidate[%d]", i, j)
			}
		}
	}
	return nil
}

func overlaps(a, b CandidateRect) bool {
	left, top := math.Max(a.X, b.X), math.Max(a.Y, b.Y)
	right, bottom := math.Min(a.X+a.Width, b.X+b.Width), math.Min(a.Y+a.Height, b.Y+b.Height)
	return right > left && bottom > top
}

func validateParsedResult(result ParseResult) error {
	if strings.TrimSpace(result.Metadata.Source) == "" || strings.TrimSpace(result.Scale.Unit) == "" ||
		!result.Scale.HasPixelToUnit() || !result.Metadata.HasRequiredFields() {
		return fmt.Errorf("ai result is missing required schema fields")
	}
	if !finite(result.Metadata.Confidence) {
		return fmt.Errorf("ai result has invalid numeric metadata")
	}
	if result.Scale.PixelToUnit == nil {
		if result.Scale.Unit != "px" {
			return fmt.Errorf("unknown scale must use pixel coordinates")
		}
	} else if !finite(*result.Scale.PixelToUnit) || *result.Scale.PixelToUnit <= 0 {
		return fmt.Errorf("ai result has invalid scale conversion")
	}
	if len(result.Walls) == 0 {
		return fmt.Errorf("ai result has no reliable wall topology")
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

func validateNullableNumber(raw json.RawMessage) error {
	if string(raw) == "null" {
		return nil
	}
	return validateNumber(raw)
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
	return validateObject(object, map[string]rawValidator{"unit": validateString, "pixel_to_unit": validateNullableNumber})
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
