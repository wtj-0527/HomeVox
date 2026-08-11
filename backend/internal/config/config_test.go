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

func TestLoadReadsAIAPIKey(t *testing.T) {
	t.Setenv("AI_API_KEY", "test-key")

	cfg := Load()

	if cfg.AIAPIKey != "test-key" {
		t.Fatal("AIAPIKey was not loaded from AI_API_KEY")
	}
}

func TestLoadReadsLegacyRecoveryKey(t *testing.T) {
	t.Setenv("HOMEVOX_LEGACY_RECOVERY_KEY", "operator-only-recovery-key")

	cfg := Load()

	if cfg.LegacyRecoveryKey != "operator-only-recovery-key" {
		t.Fatal("LegacyRecoveryKey was not loaded from HOMEVOX_LEGACY_RECOVERY_KEY")
	}
}

func TestLoadRequiresExplicitFrontendDirectory(t *testing.T) {
	t.Setenv("HOMEVOX_FRONTEND_DIR", "")

	cfg := Load()

	if cfg.FrontendDir != "" {
		t.Fatalf("FrontendDir = %q, want empty until explicitly configured", cfg.FrontendDir)
	}
}

func TestLoadUsesConfiguredFrontendDirectory(t *testing.T) {
	t.Setenv("HOMEVOX_FRONTEND_DIR", "/srv/homevox/frontend")

	cfg := Load()

	if cfg.FrontendDir != "/srv/homevox/frontend" {
		t.Fatalf("FrontendDir = %q, want configured directory", cfg.FrontendDir)
	}
}
