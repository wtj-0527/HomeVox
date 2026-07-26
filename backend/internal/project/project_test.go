package project

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestValidateNameTrimsAndBounds(t *testing.T) {
	got, err := ValidateName("  Home\t")
	if err != nil {
		t.Fatalf("ValidateName returned error: %v", err)
	}
	if got != "Home" {
		t.Fatalf("name = %q, want %q", got, "Home")
	}

	if _, err := ValidateName(""); err == nil {
		t.Fatal("expected empty name error")
	}

	if _, err := ValidateName(strings.Repeat("界", MaxNameLength)); err != nil {
		t.Fatalf("120-rune name should be valid: %v", err)
	}
	if _, err := ValidateName(strings.Repeat("界", MaxNameLength+1)); err == nil {
		t.Fatal("expected long name error")
	}
}

func validDocumentJSON() []byte {
	return []byte(`{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`)
}

func TestNormalizeDocumentPreservesParseResponseAndNormalizesArrays(t *testing.T) {
	raw := []byte(`{"filename":"plan.png","contentType":"image/png","size":12,"result":{"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`)
	doc, err := NormalizeDocument(raw)
	if err != nil {
		t.Fatalf("NormalizeDocument returned error: %v", err)
	}
	if doc.Filename != "plan.png" || doc.ContentType != "image/png" || doc.Size != 12 {
		t.Fatalf("parse response metadata lost: %#v", doc)
	}
	if len(doc.Result.Rooms) != 0 || len(doc.Result.Walls) != 0 {
		t.Fatalf("unexpected arrays: %#v", doc)
	}
	if doc.Result.Rooms == nil || doc.Result.Walls == nil || doc.Result.Doors == nil || doc.Result.Windows == nil {
		t.Fatalf("normalize did not allocate empty doors/windows arrays")
	}
	if doc.Result.Scale.PixelToUnit != nil {
		t.Fatalf("unknown scale was changed to %#v", doc.Result.Scale.PixelToUnit)
	}
	encoded, err := json.Marshal(doc)
	if err != nil || !strings.Contains(string(encoded), `"filename":"plan.png"`) || !strings.Contains(string(encoded), `"pixel_to_unit":null`) {
		t.Fatalf("marshal durable document: %s, %v", encoded, err)
	}
}

func TestNormalizeDocumentRequiresExplicitScaleAndMetadataFields(t *testing.T) {
	for name, raw := range map[string]string{
		"missing conversion":       `{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px"},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`,
		"unknown unit is physical": `{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[],"doors":[],"windows":[],"scale":{"unit":"m","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`,
		"missing confidence":       `{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","image_width":100,"image_height":80}}}`,
		"null dimensions":          `{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":null,"image_height":80}}}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := NormalizeDocument([]byte(raw)); err == nil {
				t.Fatal("expected strict durable document validation error")
			}
		})
	}
}

func TestNormalizeDocumentRejectsInvalidJSON(t *testing.T) {
	if _, err := NormalizeDocument([]byte(`invalid`)); err == nil {
		t.Fatal("expected invalid json error")
	}
}

func TestNormalizeDocumentRejectsInvalidBoundsOrdering(t *testing.T) {
	raw := []byte(`{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[{"name":"A","type":"room","approximate_bounds":{"x1":10,"y1":0,"x2":1,"y2":1}}],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`)
	if _, err := NormalizeDocument(raw); err == nil {
		t.Fatal("expected invalid bounds error")
	}
}

func TestNormalizeDocumentRejectsOutOfRangeNumbers(t *testing.T) {
	raw := []byte(`{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[{"x1":NaN,"y1":0,"x2":1,"y2":1}],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`)
	if _, err := NormalizeDocument(raw); err == nil {
		t.Fatal("expected numeric validation error")
	}
}

func TestNormalizeDocumentRejectsInvalidDurableFields(t *testing.T) {
	tests := map[string]string{
		"missing filename": `{"contentType":"image/png","size":12,"result":{"rooms":[],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`,
		"unsupported mime": `{"filename":"a.bmp","contentType":"image/bmp","size":12,"result":{"rooms":[],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`,
		"zero size":        `{"filename":"a.png","contentType":"image/png","size":0,"result":{"rooms":[],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`,
		"invalid opening":  `{"filename":"a.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[],"doors":[{"x":1e309}],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`,
		"invalid scale":    `{"filename":"a.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[],"doors":[],"windows":[],"scale":{"unit":""},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`,
		"invalid metadata": `{"filename":"a.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"","image_width":-1}}}`,
	}
	for name, raw := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := NormalizeDocument([]byte(raw)); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestNormalizeDocumentRejectsOversizedJSON(t *testing.T) {
	raw := append(validDocumentJSON(), []byte(strings.Repeat(" ", MaxDocumentBytes))...)
	if _, err := NormalizeDocument(raw); err == nil {
		t.Fatal("expected oversized document error")
	}
}

func TestNormalizeDocumentRejectsGeometryOutsideSourceImage(t *testing.T) {
	raw := []byte(`{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[{"id":"wall-1","x1":0,"y1":0,"x2":101,"y2":0}],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`)
	if _, err := NormalizeDocument(raw); err == nil || !strings.Contains(err.Error(), "image bounds") {
		t.Fatalf("NormalizeDocument error = %v, want image bounds rejection", err)
	}
}

func TestNormalizeDocumentUsesCanonicalMinimumWallLength(t *testing.T) {
	for name, x2 := range map[string]float64{"below": 0.0009, "equal": 0.001} {
		t.Run(name, func(t *testing.T) {
			raw := []byte(fmt.Sprintf(`{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[{"id":"wall-1","x1":0,"y1":0,"x2":%g,"y2":0}],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`, x2))
			if _, err := NormalizeDocument(raw); err == nil {
				t.Fatalf("wall length %g should be rejected", x2)
			}
		})
	}
	raw := []byte(`{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[{"id":"wall-1","x1":0,"y1":0,"x2":0.0011,"y2":0}],"doors":[],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`)
	if _, err := NormalizeDocument(raw); err != nil {
		t.Fatalf("wall above canonical minimum rejected: %v", err)
	}
}

func TestValidateSourceImageMetadata(t *testing.T) {
	doc, err := NormalizeDocument(validDocumentJSON())
	if err != nil {
		t.Fatalf("NormalizeDocument returned error: %v", err)
	}
	if err := ValidateSourceImageMetadata(doc, "plan.png", "image/png", 12, 100, 80); err != nil {
		t.Fatalf("valid source-image metadata rejected: %v", err)
	}
	if err := ValidateSourceImageMetadata(doc, "other.png", "image/png", 12, 100, 80); err == nil {
		t.Fatal("expected filename mismatch error")
	}
	if err := ValidateSourceImageMetadata(doc, "plan.png", "image/jpeg", 12, 100, 80); err == nil {
		t.Fatal("expected content type mismatch error")
	}
	if err := ValidateSourceImageMetadata(doc, "plan.png", "image/png", 13, 100, 80); err == nil {
		t.Fatal("expected size mismatch error")
	}
	if err := ValidateSourceImageMetadata(doc, "plan.png", "image/png", 12, 99, 80); err == nil {
		t.Fatal("expected width mismatch error")
	}
	if err := ValidateSourceImageMetadata(doc, "plan.png", "image/png", 12, 100, 79); err == nil {
		t.Fatal("expected height mismatch error")
	}
}

func TestNormalizeDocumentBindsStableOpeningAndRejectsOverlap(t *testing.T) {
	raw := []byte(`{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[{"id":"wall-a","x1":0,"y1":0,"x2":100,"y2":0}],"doors":[{"id":"door-a","kind":"door","wallId":"wall-a","position":0.5,"width":20,"confirmed":false}],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`)
	doc, err := NormalizeDocument(raw)
	if err != nil {
		t.Fatalf("valid local opening rejected: %v", err)
	}
	if doc.Result.Doors[0].WallID != "wall-a" || doc.Result.Doors[0].Position != 0.5 {
		t.Fatalf("opening was not preserved: %#v", doc.Result.Doors[0])
	}
	raw = []byte(`{"filename":"plan.png","contentType":"image/png","size":12,"result":{"rooms":[],"walls":[{"id":"wall-a","x1":0,"y1":0,"x2":100,"y2":0}],"doors":[{"id":"door-a","kind":"door","wallId":"wall-a","position":0.5,"width":40},{"id":"door-b","kind":"door","wallId":"wall-a","position":0.6,"width":40}],"windows":[],"scale":{"unit":"px","pixel_to_unit":null},"metadata":{"source":"fixture","confidence":0.5,"image_width":100,"image_height":80}}}`)
	if _, err := NormalizeDocument(raw); err == nil {
		t.Fatal("expected overlap to fail closed")
	}
}
