// Package imagevalidate verifies image bytes before they are sent to AI or stored.
package imagevalidate

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/webp"
)

var supported = map[string]string{
	"png":  "image/png",
	"jpeg": "image/jpeg",
	"gif":  "image/gif",
	"webp": "image/webp",
}

// Decode validates the complete encoded image and returns its canonical MIME
// type and dimensions. Decode, rather than a signature check, rejects truncated
// and corrupt images before they can reach a provider or object storage.
func Decode(data []byte) (contentType string, width, height int, err error) {
	if len(data) == 0 {
		return "", 0, 0, fmt.Errorf("image is empty")
	}
	imageValue, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", 0, 0, fmt.Errorf("decode image: %w", err)
	}
	contentType, ok := supported[format]
	if !ok {
		return "", 0, 0, fmt.Errorf("unsupported decoded image format %q", format)
	}
	bounds := imageValue.Bounds()
	width, height = bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return "", 0, 0, fmt.Errorf("image dimensions must be positive")
	}
	return contentType, width, height, nil
}
