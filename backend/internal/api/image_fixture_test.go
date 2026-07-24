package api

import (
	"encoding/base64"
	"testing"
)

const validPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAF0lEQVR4nGL6////fwZkwARjAAIAAP//YgEEAT/f/TcAAAAASUVORK5CYII="

func validPNG(t testing.TB) []byte {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString(validPNGBase64)
	if err != nil {
		t.Fatalf("decode controlled PNG fixture: %v", err)
	}
	return data
}
