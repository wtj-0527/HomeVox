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
	if err := validateOpenings(doc.Result.Doors, "door"); err != nil {
		return err
	}
	if err := validateOpenings(doc.Result.Windows, "window"); err != nil {
		return err
	}
	return nil
}

func validateSegmentSet(segments []floorplan.Segment) error {
	for i, segment := range segments {
		if isNotFinite(segment.X1) || isNotFinite(segment.Y1) || isNotFinite(segment.X2) || isNotFinite(segment.Y2) {
			return fmt.Errorf("wall[%d] has invalid numeric value", i)
		}
	}
	return nil
}

func validateBounds(rooms []floorplan.Room) error {
	for i, room := range rooms {
		if isNotFinite(room.ApproximateBounds.X1) || isNotFinite(room.ApproximateBounds.Y1) || isNotFinite(room.ApproximateBounds.X2) || isNotFinite(room.ApproximateBounds.Y2) {
			return fmt.Errorf("room[%d] has invalid bounds", i)
		}
		if room.ApproximateBounds.X1 > room.ApproximateBounds.X2 {
			return fmt.Errorf("room[%d] has invalid bounds ordering", i)
		}
		if room.ApproximateBounds.Y1 > room.ApproximateBounds.Y2 {
			return fmt.Errorf("room[%d] has invalid bounds ordering", i)
		}
		if isNotFinite(room.AreaRatio) {
			return fmt.Errorf("room[%d] has invalid area ratio", i)
		}
	}
	return nil
}

func validateOpenings(openings []floorplan.Opening, kind string) error {
	for i, opening := range openings {
		if isNotFinite(opening.X) || isNotFinite(opening.Y) {
			return fmt.Errorf("%s[%d] has invalid numeric value", kind, i)
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
