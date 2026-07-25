package main

import (
	"image"
	"image/color"
	"testing"
)

func TestPixelDigestProvesCropPositionNotOnlyDimensions(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 12, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 12; x++ {
			source.Set(x, y, color.RGBA{R: uint8(x * 11), G: uint8(y * 17), B: uint8(x + y), A: 255})
		}
	}
	want := cropImage(source, image.Rect(2, 1, 8, 6))
	wrong := cropImage(source, image.Rect(3, 1, 9, 6))
	if pixelDigest(want) == pixelDigest(wrong) {
		t.Fatal("same-size crops from different source positions must have different pixel digests")
	}
}
