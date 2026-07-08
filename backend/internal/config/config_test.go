package config

import "testing"

func TestLoadUsesFixedListenAddrWhenEnvMissing(t *testing.T) {
	t.Setenv("HOMEVOX_LISTEN_ADDR", "")

	cfg := Load()

	if cfg.ListenAddr != "0.0.0.0:18088" {
		t.Fatalf("ListenAddr = %q, want fixed 0.0.0.0:18088", cfg.ListenAddr)
	}
}

func TestLoadRejectsListenAddrDrift(t *testing.T) {
	t.Setenv("HOMEVOX_LISTEN_ADDR", "127.0.0.1:8080")

	cfg := Load()

	if cfg.ListenAddr != "0.0.0.0:18088" {
		t.Fatalf("ListenAddr = %q, want drift rejected to fixed 0.0.0.0:18088", cfg.ListenAddr)
	}
}
