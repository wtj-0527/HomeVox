package project

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/floorplan"
)

const (
	MaxNameLength            = 120
	MaxDocumentBytes         = 2 * 1024 * 1024
	MaxSourceImageBytes      = 10 * 1024 * 1024
	MaxCreateRequestOverhead = 1 * 1024 * 1024
	MaxCreateRequestBytes    = MaxDocumentBytes + MaxSourceImageBytes + MaxCreateRequestOverhead
	MaxUpdateRequestBytes    = MaxDocumentBytes + MaxCreateRequestOverhead
	MinNameLength            = 1
)

var SupportedImageContentTypes = []string{"image/png", "image/jpeg", "image/gif", "image/webp"}

var imageContentTypeSet = map[string]struct{}{}

func init() {
	for _, contentType := range SupportedImageContentTypes {
		imageContentTypeSet[contentType] = struct{}{}
	}
}

func NormalizeDocument(raw json.RawMessage) (floorplan.ParseResponse, error) {
	trimmed := strings.TrimSpace(string(raw))
	if len(trimmed) == 0 {
		return floorplan.ParseResponse{}, errors.New("document is required")
	}

	if len(raw) > MaxDocumentBytes {
		return floorplan.ParseResponse{}, fmt.Errorf("document exceeds %d bytes", MaxDocumentBytes)
	}

	var doc floorplan.ParseResponse
	if err := json.Unmarshal([]byte(trimmed), &doc); err != nil {
		return floorplan.ParseResponse{}, fmt.Errorf("invalid document JSON: %w", err)
	}

	if err := normalizeStableGeometry(&doc); err != nil {
		return floorplan.ParseResponse{}, err
	}
	if err := validateDocumentEnvelope(doc); err != nil {
		return floorplan.ParseResponse{}, err
	}

	if doc.Result.Rooms == nil {
		doc.Result.Rooms = []floorplan.Room{}
	}
	if doc.Result.Walls == nil {
		doc.Result.Walls = []floorplan.Segment{}
	}
	if doc.Result.Doors == nil {
		doc.Result.Doors = []floorplan.Opening{}
	}
	if doc.Result.Windows == nil {
		doc.Result.Windows = []floorplan.Opening{}
	}

	return doc, nil
}

func validateDocumentEnvelope(doc floorplan.ParseResponse) error {
	if strings.TrimSpace(doc.Filename) == "" {
		return errors.New("document filename is required")
	}
	if !IsSupportedContentType(doc.ContentType) {
		return errors.New("document contentType must be a supported image type")
	}
	if doc.Size <= 0 || doc.Size > MaxSourceImageBytes {
		return errors.New("document size must be a positive supported image size")
	}
	if strings.TrimSpace(doc.Result.Scale.Unit) == "" {
		return errors.New("document scale unit is required")
	}
	if strings.TrimSpace(doc.Result.Metadata.Source) == "" {
		return errors.New("document metadata source is required")
	}
	if doc.Result.Metadata.ImageWidth < 0 || doc.Result.Metadata.ImageHeight < 0 {
		return errors.New("document metadata image dimensions must not be negative")
	}
	if isNotFinite(doc.Result.Metadata.Confidence) || isNotFinite(doc.Result.Scale.PixelToUnit) {
		return errors.New("document has invalid numeric metadata")
	}
	if err := validateSegmentSet(doc.Result.Walls); err != nil {
		return err
	}
	if err := validateBounds(doc.Result.Rooms); err != nil {
		return err
	}
	allOpenings := append(append([]floorplan.Opening{}, doc.Result.Doors...), doc.Result.Windows...)
	if err := validateOpenings(doc.Result.Walls, allOpenings); err != nil {
		return err
	}
	return nil
}

func validateSegmentSet(segments []floorplan.Segment) error {
	seen := map[string]struct{}{}
	for i, segment := range segments {
		if strings.TrimSpace(segment.ID) == "" {
			return fmt.Errorf("wall[%d] id is required", i)
		}
		if _, ok := seen[segment.ID]; ok {
			return fmt.Errorf("wall[%d] has duplicate id", i)
		}
		seen[segment.ID] = struct{}{}
		if isNotFinite(segment.X1) || isNotFinite(segment.Y1) || isNotFinite(segment.X2) || isNotFinite(segment.Y2) {
			return fmt.Errorf("wall[%d] has invalid numeric value", i)
		}
		if math.Hypot(segment.X2-segment.X1, segment.Y2-segment.Y1) <= 0 {
			return fmt.Errorf("wall[%d] is degenerate", i)
		}
	}
	return nil
}

func validateBounds(rooms []floorplan.Room) error {
	for i, room := range rooms {
		if isNotFinite(room.ApproximateBounds.X1) || isNotFinite(room.ApproximateBounds.Y1) || isNotFinite(room.ApproximateBounds.X2) || isNotFinite(room.ApproximateBounds.Y2) {
			return fmt.Errorf("room[%d] has invalid bounds", i)
		}
		if room.ApproximateBounds.X1 > room.ApproximateBounds.X2 || room.ApproximateBounds.Y1 > room.ApproximateBounds.Y2 {
			return fmt.Errorf("room[%d] has invalid bounds ordering", i)
		}
		if isNotFinite(room.AreaRatio) {
			return fmt.Errorf("room[%d] has invalid area ratio", i)
		}
	}
	return nil
}

func normalizeStableGeometry(doc *floorplan.ParseResponse) error {
	for i := range doc.Result.Walls {
		if doc.Result.Walls[i].ID == "" {
			doc.Result.Walls[i].ID = fmt.Sprintf("wall-%d", i+1)
		}
	}
	normalize := func(items []floorplan.Opening, kind string) error {
		for i := range items {
			o := &items[i]
			if o.ID == "" {
				o.ID = fmt.Sprintf("%s-%d", kind, i+1)
			}
			if o.Kind == "" {
				o.Kind = kind
			}
			if o.Source == "" {
				o.Source = "parsed"
			}
			if o.WallID == "" {
				return fmt.Errorf("%s[%d] lacks wall-local geometry", kind, i)
			}
		}
		return nil
	}
	if err := normalize(doc.Result.Doors, "door"); err != nil {
		return err
	}
	return normalize(doc.Result.Windows, "window")
}

func validateOpenings(walls []floorplan.Segment, openings []floorplan.Opening) error {
	wallByID := map[string]floorplan.Segment{}
	for _, wall := range walls {
		wallByID[wall.ID] = wall
	}
	seen := map[string]struct{}{}
	grouped := map[string][]floorplan.Opening{}
	for i, o := range openings {
		if strings.TrimSpace(o.ID) == "" {
			return fmt.Errorf("opening[%d] id is required", i)
		}
		if _, ok := seen[o.ID]; ok {
			return fmt.Errorf("opening[%d] has duplicate id", i)
		}
		seen[o.ID] = struct{}{}
		if o.Kind != "door" && o.Kind != "window" {
			return fmt.Errorf("opening[%d] has invalid kind", i)
		}
		wall, ok := wallByID[o.WallID]
		if !ok {
			return fmt.Errorf("opening[%d] references missing wall", i)
		}
		if isNotFinite(o.Position) || isNotFinite(o.Width) || o.Position < 0 || o.Position > 1 || o.Width < 8 {
			return fmt.Errorf("opening[%d] has invalid local geometry", i)
		}
		length := math.Hypot(wall.X2-wall.X1, wall.Y2-wall.Y1)
		half := o.Width / length / 2
		if o.Width >= length || o.Position-half < 0 || o.Position+half > 1 {
			return fmt.Errorf("opening[%d] exceeds wall endpoints", i)
		}
		grouped[o.WallID] = append(grouped[o.WallID], o)
	}
	for wallID, items := range grouped {
		wall := wallByID[wallID]
		length := math.Hypot(wall.X2-wall.X1, wall.Y2-wall.Y1)
		for i := range items {
			for j := i + 1; j < len(items); j++ {
				if math.Abs(items[i].Position-items[j].Position) < (items[i].Width+items[j].Width)/length/2 {
					return fmt.Errorf("openings overlap on wall %s", wallID)
				}
			}
		}
	}
	return nil
}

func isNotFinite(v float64) bool {
	return math.IsInf(v, 0) || math.IsNaN(v)
}

func ValidateName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if utf8.RuneCountInString(name) < MinNameLength {
		return "", errors.New("name is required")
	}
	if utf8.RuneCountInString(name) > MaxNameLength {
		return "", fmt.Errorf("name must be at most %d characters", MaxNameLength)
	}
	return name, nil
}

func IsSupportedContentType(contentType string) bool {
	_, ok := imageContentTypeSet[contentType]
	return ok
}

// ValidateSourceImageMetadata makes the durable document's source-image
// metadata agree with the immutable object bytes stored for the project.
func ValidateSourceImageMetadata(doc floorplan.ParseResponse, filename, contentType string, size int64) error {
	if doc.Filename != filename {
		return errors.New("document filename must match source_image filename")
	}
	if doc.ContentType != contentType {
		return errors.New("document contentType must match source_image content type")
	}
	if int64(doc.Size) != size {
		return errors.New("document size must match source_image size")
	}
	return nil
}
