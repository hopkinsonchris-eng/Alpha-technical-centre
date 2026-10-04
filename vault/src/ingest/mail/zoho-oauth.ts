/**
 * Zoho Mail OAuth client (wave 6, D60, P50): the Vault asks each person, once, for consent to read and send
 * from their own Zoho mailbox. One server-based Zoho client ("ATC Vault"); the authorize URL carries a signed
 * state naming the person; the callback exchanges the code at the data centre's accounts server, reads the
 * account and stores one refresh token per person (sealed, see secrets.ts). Zoho refresh tokens never expire
 * unless revoked and a client may hold twenty per user, so a token is reused for ever and a reconnect replaces it.
 * All HTTP goes through the injected fetch; tests replay recorded responses.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ZOHO_MAIL_SCOPES = ['ZohoMail.accounts.READ', 'ZohoMail.folders.READ', 'ZohoMail.messages.READ', 'ZohoMail.messages.CREATE'] as const;
export const SEND_SCOPE = 'ZohoMail.messages.CREATE';

/** The mail API host of each Zoho data centre, keyed by the `location` the authorize redirect carries. */
export const MAIL_HOSTS: Record<string, string> = {
  us: 'https://mail.zoho.com', eu: 'https://mail.zoho.eu', in: 'https://mail.zoho.in', au: 'https://mail.zoho.com.au', jp: 'https://mail.zoho.jp',
  ca: 'https://mail.zohocloud.ca', cn: 'https://mail.zoho.com.cn', sa: 'https://mail.zoho.sa', uk: 'https://mail.zoho.uk',
};

export interface ZohoMailClient { clientId: string; clientSecret: string; redirectUri: string; accountsUrl: string; apiUrl?: string }

export function zohoMailClientFromEnv(env: NodeJS.ProcessEnv = process.env): ZohoMailClient | null {
  const clientId = env.ZOHO_MAIL_CLIENT_ID, clientSecret = env.ZOHO_MAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const base = (env.VAULT_PUBLIC_URL ?? 'http://localhost:8791').replace(/\/+$/, '');
  return { clientId, clientSecret, redirectUri: env.ZOHO_MAIL_REDIRECT_URI ?? `${base}/oauth/zoho/callback`, accountsUrl: (env.ZOHO_MAIL_ACCOUNTS_URL ?? 'https://accounts.zoho.com').replace(/\/+$/, ''), apiUrl: env.ZOHO_MAIL_API_URL?.replace(/\/+$/, '') };
}

/* ── state: who started this, signed so the callback trusts only what this server issued ── */
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function signState(secret: string, personId: string, now = Date.now(), ttlMs = 10 * 60_000): string {
  const payload = b64(JSON.stringify({ p: personId, n: randomBytes(9).toString('base64url'), e: now + ttlMs }));
  return `${payload}.${sign(payload, secret)}`;
}
export function verifyState(state: string | undefined, secret: string, now = Date.now()): { personId: string } | null {
  if (!state) return null;
  const [payload, sig] = state.split('.');
  if (!payload || !sig) return null;
  const want = sign(payload, secret);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof j.p !== 'string' || typeof j.e !== 'number' || j.e < now) return null;
    return { personId: j.p };
  } catch { return null; }
}

export function authorizeUrl(c: ZohoMailClient, state: string): string {
  const u = new URL(`${c.accountsUrl}/oauth/v2/auth`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', c.clientId);
  u.searchParams.set('scope', ZOHO_MAIL_SCOPES.join(','));
  u.searchParams.set('redirect_uri', c.redirectUri);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  return u.toString();
}

export interface ZohoTokens { access_token: string; refresh_token: string; expires_in: number; scope: string[]; api_domain?: string }

/** The callback's `accounts-server` names the data centre that issued the code; the exchange must go there. */
export async function exchangeCode(c: ZohoMailClient, code: string, accountsServer: string | undefined, f: typeof fetch = fetch): Promise<ZohoTokens> {
  const accounts = (accountsServer && /^https:\/\/accounts\.zoho(cloud)?\.[a-z.]+$/i.test(accountsServer) ? accountsServer : c.accountsUrl).replace(/\/+$/, '');
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri });
  const res = await f(`${accounts}/oauth/v2/token`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`zoho code exchange failed (${res.status}): ${j.error ?? 'no access_token'}`);
  if (!j.refresh_token) throw new Error('zoho returned no refresh token: the consent must be offline access');
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_in: Number(j.expires_in) || 3600, scope: String(j.scope ?? '').split(/[,\s]+/).filter(Boolean), api_domain: j.api_domain };
}

export interface ZohoAccount { accountId: string; address: string; displayName: string | null }

/** The mailbox behind the token: GET /api/accounts, the primary address of the first account. */
export async function fetchAccount(apiUrl: string, accessToken: string, f: typeof fetch = fetch): Promise<ZohoAccount> {
  const res = await f(`${apiUrl}/api/accounts`, { headers: { authorization: `Zoho-oauthtoken ${accessToken}`, accept: 'application/json' } });
  const j: any = await res.json().catch(() => ({}));
  const a = Array.isArray(j.data) ? j.data[0] : null;
  if (!res.ok || !a) throw new Error(`zoho accounts lookup failed (${res.status})`);
  const primary = a.primaryEmailAddress ?? (Array.isArray(a.emailAddress) ? (a.emailAddress.find((e: any) => e.isPrimary) ?? a.emailAddress[0])?.mailId : null);
  if (!primary) throw new Error('zoho account carries no address');
  return { accountId: String(a.accountId), address: String(primary).toLowerCase(), displayName: a.accountDisplayName ?? a.displayName ?? null };
}

/** The mail API host for the data centre named by the redirect (`location`), or the configured one. */
export function mailApiUrl(c: ZohoMailClient, location: string | undefined): string {
  return c.apiUrl ?? MAIL_HOSTS[(location ?? 'us').toLowerCase()] ?? MAIL_HOSTS.us;
}

export async function revokeRefreshToken(accountsUrl: string, refreshToken: string, f: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await f(`${accountsUrl.replace(/\/+$/, '')}/oauth/v2/token/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' });
    return res.ok;
  } catch { return false; }
}
