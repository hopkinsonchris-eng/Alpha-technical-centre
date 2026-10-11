/**
 * Tool passes (11 Oct 2026). Staff signed in to the Hub open an external APEX app without a second login.
 *
 * The caller has already passed Cloudflare Access with a firm email (auth.ts). For an app that trusts the Vault, the
 * Hub asks for a short-lived pass naming that person and puts it after the `#` of the app link, which browsers never
 * send to a server. The app checks the Ed25519 signature against the Vault's public key and lets the person in as a
 * full user. Every Hub user may have one (partners and associates alike); a service caller may not.
 *
 *   POST /api/tool-pass       {tool}   → {tool, pass, expires_at}. 400 for an app that does not take passes.
 *   GET  /api/tool-pass/key            → {alg: 'Ed25519', public_key}: the key an app is configured with.
 * Both answer 503 not_configured until TOOL_PASS_SEED is set.
 *
 * Pass: hub1.<base64url(payload JSON)>.<base64url(signature)>, the signature over the text before the last dot.
 * Payload: {aud: <tool id>, sub: <email>, name, role, iat, exp} with exp − iat = 12 h. The app's verifier is
 * src/io/hubpass.jl in APEX-3D-Reservoir-Model.
 *
 * The key pair is derived from TOOL_PASS_SEED (any random string of 32+ characters, e.g. Render's Generate), so
 * setting one environment variable is the whole setup. Changing the seed changes the public key and ends every
 * pass already issued; deleting it switches passes off.
 */
import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, bad, forbidden, jsonBody, route } from './common.ts';

/** The apps that accept a pass. Each verifies the audience, so a pass for one is refused by another. */
export const PASS_TOOLS = new Set(['apex-3d-model']);
export const PASS_LIFE_S = 12 * 3600;
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

const b64url = (b: Uint8Array | string) => Buffer.from(b).toString('base64url');

let cached: { seed: string; priv: KeyObject; pub: string } | null = null;
/** The signing key derived from TOOL_PASS_SEED, and its raw public half (base64url); null when unset or too short. */
export function passKey(seed = process.env.TOOL_PASS_SEED ?? ''): { priv: KeyObject; pub: string } | null {
  seed = seed.trim();
  if (seed.length < 32) return null;
  if (cached?.seed === seed) return cached;
  const d = createHash('sha256').update('atc-tool-pass-v1:' + seed).digest();
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, d]), format: 'der', type: 'pkcs8' });
  const pub = b64url(createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(-32));
  cached = { seed, priv, pub };
  return cached;
}

/** Sign a pass for `tool` naming `person`, valid from `now` for PASS_LIFE_S. */
export function issuePass(priv: KeyObject, tool: string, person: { email: string; name: string; role: string }, now: Date) {
  const iat = Math.floor(now.getTime() / 1000), exp = iat + PASS_LIFE_S;
  const head = 'hub1.' + b64url(JSON.stringify({ aud: tool, sub: person.email, name: person.name, role: person.role, iat, exp }));
  return { pass: head + '.' + b64url(sign(null, Buffer.from(head), priv)), expires_at: new Date(exp * 1000).toISOString() };
}

const notConfigured = () => new ApiError(503, 'not_configured', 'tool passes are not set up on this Vault (TOOL_PASS_SEED)');

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'POST', '/api/tool-pass', 'tool-pass.issue', async (x) => {
    if (x.person.role === 'service') throw forbidden('tool passes are for people signed in to the Hub');
    const body = await jsonBody(x.c);
    const tool = typeof body.tool === 'string' ? body.tool : '';
    if (!PASS_TOOLS.has(tool)) throw bad(`tool must be one of: ${[...PASS_TOOLS].join(', ')}`, '/tool');
    x.a.detail = { tool };
    const key = passKey();
    if (!key) throw notConfigured();
    return { body: { tool, ...issuePass(key.priv, tool, x.person, x.now) } };
  });

  route(app, 'GET', '/api/tool-pass/key', 'tool-pass.key', async () => {
    const key = passKey();
    if (!key) throw notConfigured();
    return { body: { alg: 'Ed25519', public_key: key.pub } };
  });
}
