package imagevalidate

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"testing"
)

const webpFixture = "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoCAAMAAgA0JaQAA3AA/vuUAAA="

func testImage() image.Image {
	value := image.NewRGBA(image.Rect(0, 0, 2, 3))
	value.Set(0, 0, color.White)
	return value
}

func TestDecodeAcceptsSupportedStructuredImages(t *testing.T) {
	fixtures := map[string]struct {
		data []byte
		mime string
	}{
		"PNG":  {mustEncode(t, func(w *bytes.Buffer, value image.Image) error { return png.Encode(w, value) }), "image/png"},
		"JPEG": {mustEncode(t, func(w *bytes.Buffer, value image.Image) error { return jpeg.Encode(w, value, nil) }), "image/jpeg"},
		"GIF":  {mustEncode(t, func(w *bytes.Buffer, value image.Image) error { return gif.Encode(w, value, nil) }), "image/gif"},
		"WebP": {mustDecodeBase64(t, webpFixture), "image/webp"},
	}
	for name, fixture := range fixtures {
		t.Run(name, func(t *testing.T) {
			mime, width, height, err := Decode(fixture.data)
			if err != nil {
				t.Fatalf("Decode() error = %v", err)
			}
			if mime != fixture.mime || width <= 0 || height <= 0 {
				t.Fatalf("Decode() = %q, %dx%d", mime, width, height)
			}
		})
	}
}

func TestDecodeRejectsTruncatedOrCorruptImages(t *testing.T) {
	fixtures := [][]byte{
		mustEncode(t, func(w *bytes.Buffer, value image.Image) error { return png.Encode(w, value) }),
		mustEncode(t, func(w *bytes.Buffer, value image.Image) error { return jpeg.Encode(w, value, nil) }),
		mustEncode(t, func(w *bytes.Buffer, value image.Image) error { return gif.Encode(w, value, nil) }),
		mustDecodeBase64(t, webpFixture),
	}
	for _, fixture := range fixtures {
		if _, _, _, err := Decode(fixture[:len(fixture)/2]); err == nil {
			t.Fatal("Decode accepted truncated image")
		}
	}
}

func mustEncode(t *testing.T, encode func(*bytes.Buffer, image.Image) error) []byte {
	t.Helper()
	var out bytes.Buffer
	if err := encode(&out, testImage()); err != nil {
		t.Fatalf("encode fixture: %v", err)
	}
	return out.Bytes()
}
func mustDecodeBase64(t *testing.T, encoded string) []byte {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	return data
}
