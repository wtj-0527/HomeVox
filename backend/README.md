# HomeVox Backend

Go API server for HomeVox.

## Run

Build the frontend first, then pass its absolute output directory to the Go server:

```bash
cd frontend
npm ci
npm run build

cd ../backend
HOMEVOX_FRONTEND_DIR="$(cd ../frontend/dist && pwd)" go run ./cmd/server
```

The service uses one fixed public listener, `0.0.0.0:18088`:

- `/api/*` is served by Go.
- Existing frontend assets are served from `HOMEVOX_FRONTEND_DIR`.
- Browser client routes fall back to `index.html`.
- Missing assets and unknown API routes return `404`.

`HOMEVOX_FRONTEND_DIR` is required and must contain `index.html`; startup fails closed when the frontend build is missing. The backend deliberately ignores `HOMEVOX_LISTEN_ADDR` and never drifts from the fixed listener above.

## d53 legacy-project recovery

The historical `d53b949` schema replaced legacy `NULL` capabilities with random
64-hex digests. Those values cannot be distinguished automatically from a valid
bearer digest. Do **not** bulk-clear `capability_hash`.

After out-of-band ownership verification, an operator must add exactly one
`legacy_project_recovery_authorizations` row containing the project ID, the
currently observed retired digest, operator identity, and case reference. The
existing operator-key-gated recovery endpoint can then issue a replacement
capability; it writes `legacy_project_recovery_audit` and cannot be repeated.
Rows without that authorization (including ordinary bearer projects) remain
untouched.
