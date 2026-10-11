# M18 · Tool passes (11 Oct 2026)

**Goal.** Staff signed in to the Hub open an external APEX app without a second login.

**Why it is safe.** Every Hub user has passed Cloudflare Access with a firm email, which the Vault verifies on every
request (M01). The Vault vouches for that person to an app with a short-lived pass the app can check by itself.

## Contract
- `POST /api/tool-pass {tool}` → `{tool, pass, expires_at}`. Any Hub person (partner or associate); a `service` caller
  gets 403; a tool outside `PASS_TOOLS` gets 400. One audit event `tool-pass.issue` with `{tool}`.
- `GET /api/tool-pass/key` → `{alg: 'Ed25519', public_key}` (base64url, raw 32 bytes). Not a secret.
- Both answer `503 not_configured` until `TOOL_PASS_SEED` (32+ random characters) is set. The Ed25519 key pair is
  derived from it (SHA-256 of `atc-tool-pass-v1:<seed>`), so changing it ends every pass already issued.
- Pass: `hub1.<base64url(payload)>.<base64url(signature)>`, the signature over the text before the last dot.
  Payload `{aud, sub: email, name, role, iat, exp}`, `exp − iat` = 12 h.
- The Hub (`hub/project.js`, `PASS_APPS`) puts it after the `#` of the app link (`#hubpass=…`), which a browser never
  sends to a server. One request per tool an hour; no pass leaves the plain link.

## Apps
- `apex-3d-model` from v1.121.0 (`src/io/hubpass.jl`): checks signature, audience, expiry and a life of at most 24 h;
  a pass is a full-access client key, never admin, attributed to `hub:<email>`.

## Deliverables
`vault/src/api/toolpass.routes.ts`, `vault/test/toolpass.test.ts`, `hub/project.js`,
`test/e2e/hub-project-toolbar.spec.mjs`, `render.yml`, `vault/.env.example`, this file.
