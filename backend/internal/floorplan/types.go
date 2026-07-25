package floorplan

import (
	"encoding/json"
	"fmt"
)

type Bounds struct {
	X1 float64 `json:"x1"`
	Y1 float64 `json:"y1"`
	X2 float64 `json:"x2"`
	Y2 float64 `json:"y2"`
}

type Room struct {
	Name              string  `json:"name"`
	Type              string  `json:"type"`
	ApproximateBounds Bounds  `json:"approximate_bounds"`
	AreaRatio         float64 `json:"area_ratio"`
}

type Segment struct {
	ID string  `json:"id"`
	X1 float64 `json:"x1"`
	Y1 float64 `json:"y1"`
	X2 float64 `json:"x2"`
	Y2 float64 `json:"y2"`
}

// Opening is a durable local-wall opening. Position is the center fraction from
// the owning wall start. Confirmed=false explicitly preserves unknown building
// parameters rather than fabricating measured dimensions.
type Opening struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	WallID    string  `json:"wallId"`
	Position  float64 `json:"position"`
	Width     float64 `json:"width"`
	Source    string  `json:"source"`
	Confirmed bool    `json:"confirmed"`
	Type      string  `json:"type,omitempty"`
	X         float64 `json:"x,omitempty"`
	Y         float64 `json:"y,omitempty"`
	From      string  `json:"from,omitempty"`
	To        string  `json:"to,omitempty"`
}

type Scale struct {
	Unit        string   `json:"unit"`
	PixelToUnit *float64 `json:"pixel_to_unit"`

	pixelToUnitPresent bool
}

type Metadata struct {
	Source      string  `json:"source"`
	Confidence  float64 `json:"confidence"`
	ImageWidth  int     `json:"image_width"`
	ImageHeight int     `json:"image_height"`

	confidencePresent  bool
	imageWidthPresent  bool
	imageHeightPresent bool
}

type ParseResult struct {
	Rooms    []Room    `json:"rooms"`
	Walls    []Segment `json:"walls"`
	Doors    []Opening `json:"doors"`
	Windows  []Opening `json:"windows"`
	Scale    Scale     `json:"scale"`
	Metadata Metadata  `json:"metadata"`
}

// ParseResponse is the complete durable editor document. It preserves the
// source metadata returned by the parse endpoint together with the editable
// floorplan result; only the result's walls are subsequently changed by the
// editor.
type ParseResponse struct {
	Filename    string      `json:"filename"`
	ContentType string      `json:"contentType"`
	Size        int         `json:"size"`
	Result      ParseResult `json:"result"`
}

// HasPixelToUnit distinguishes an explicit null (an honest unknown physical
// conversion) from an omitted field.  The field is part of the durable schema
// and must always be present as either a finite number or null.
func (s Scale) HasPixelToUnit() bool {
	return s.pixelToUnitPresent
}

func (m Metadata) HasRequiredFields() bool {
	return m.confidencePresent && m.imageWidthPresent && m.imageHeightPresent
}

func (s *Scale) UnmarshalJSON(data []byte) error {
	fields, err := requiredObjectFields(data, "scale")
	if err != nil {
		return err
	}
	unit, err := requiredStringField(fields, "unit")
	if err != nil {
		return fmt.Errorf("scale: %w", err)
	}
	rawConversion, present := fields["pixel_to_unit"]
	if !present {
		return fmt.Errorf("scale: missing required field %q", "pixel_to_unit")
	}
	s.Unit = unit
	s.pixelToUnitPresent = true
	if string(rawConversion) == "null" {
		s.PixelToUnit = nil
		return nil
	}
	var conversion float64
	if err := json.Unmarshal(rawConversion, &conversion); err != nil {
		return fmt.Errorf("scale pixel_to_unit: %w", err)
	}
	s.PixelToUnit = &conversion
	return nil
}

func (m *Metadata) UnmarshalJSON(data []byte) error {
	fields, err := requiredObjectFields(data, "metadata")
	if err != nil {
		return err
	}
	source, err := requiredStringField(fields, "source")
	if err != nil {
		return fmt.Errorf("metadata: %w", err)
	}
	confidence, err := requiredFloatField(fields, "confidence")
	if err != nil {
		return fmt.Errorf("metadata: %w", err)
	}
	width, err := requiredIntegerField(fields, "image_width")
	if err != nil {
		return fmt.Errorf("metadata: %w", err)
	}
	height, err := requiredIntegerField(fields, "image_height")
	if err != nil {
		return fmt.Errorf("metadata: %w", err)
	}
	m.Source = source
	m.Confidence = confidence
	m.ImageWidth = width
	m.ImageHeight = height
	m.confidencePresent = true
	m.imageWidthPresent = true
	m.imageHeightPresent = true
	return nil
}

func requiredObjectFields(data []byte, name string) (map[string]json.RawMessage, error) {
	if string(data) == "null" {
		return nil, fmt.Errorf("%s must be an object", name)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("%s must be an object", name)
	}
	return fields, nil
}

func requiredStringField(fields map[string]json.RawMessage, name string) (string, error) {
	raw, present := fields[name]
	if !present || string(raw) == "null" {
		return "", fmt.Errorf("missing required field %q", name)
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	return value, nil
}

func requiredFloatField(fields map[string]json.RawMessage, name string) (float64, error) {
	raw, present := fields[name]
	if !present || string(raw) == "null" {
		return 0, fmt.Errorf("missing required field %q", name)
	}
	var value float64
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, err
	}
	return value, nil
}

func requiredIntegerField(fields map[string]json.RawMessage, name string) (int, error) {
	raw, present := fields[name]
	if !present || string(raw) == "null" {
		return 0, fmt.Errorf("missing required field %q", name)
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, err
	}
	return value, nil
}
