/** Zoho OAuth refresh-token flow, shared by WorkDrive and Books. All HTTP goes through the injected fetch. */
export interface ZohoOAuth { clientId: string; clientSecret: string; refreshToken: string; accountsUrl: string }

/** What Zoho's one-word answers mean in practice (7 Oct 2026: the first live run said only "invalid_code"). */
function hint(error: unknown, accountsUrl: string): string {
  switch (String(error ?? '')) {
    case 'invalid_code': return ` (the refresh token is not valid at ${accountsUrl}: an EU token needs ACCOUNTS_URL https://accounts.zoho.eu, and the value must be the refresh_token, not the access_token)`;
    case 'invalid_client': return ' (the client id or secret is wrong, or the client was made on the other data centre\'s console)';
    case 'invalid_client_secret': return ' (the client secret is wrong; it may have been regenerated in the API console)';
    default: return '';
  }
}

export class ZohoAuth {
  private token: string | null = null;
  private expiresAt = 0;
  constructor(private readonly cfg: ZohoOAuth, private readonly fetchImpl: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  async accessToken(): Promise<string> {
    if (this.token && this.now() < this.expiresAt - 60_000) return this.token;
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.cfg.refreshToken, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret });
    const res = await this.fetchImpl(`${this.cfg.accountsUrl.replace(/\/$/, '')}/oauth/v2/token`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`zoho token refresh failed (${res.status}): ${j.error ?? 'no access_token'}${hint(j.error, this.cfg.accountsUrl)}`);
    this.token = j.access_token as string;
    this.expiresAt = this.now() + (Number(j.expires_in) || 3600) * 1000;
    return this.token;
  }

  async headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return { authorization: `Zoho-oauthtoken ${await this.accessToken()}`, ...extra };
  }
}

export function oauthFromEnv(prefix: 'ZOHO_WORKDRIVE' | 'ZOHO_BOOKS', env: NodeJS.ProcessEnv = process.env): ZohoOAuth | null {
  const clientId = env[`${prefix}_CLIENT_ID`], clientSecret = env[`${prefix}_CLIENT_SECRET`], refreshToken = env[`${prefix}_REFRESH_TOKEN`];
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken, accountsUrl: env[`${prefix}_ACCOUNTS_URL`] ?? 'https://accounts.zoho.com' };
}
