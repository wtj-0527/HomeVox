# HomeVox Backend

Go API server for HomeVox.

## Run

```bash
go run ./cmd/server
```

Default listen address: `0.0.0.0:18088`.

The backend deliberately ignores `HOMEVOX_LISTEN_ADDR`; the Phase 0 service binds to the fixed address above.
