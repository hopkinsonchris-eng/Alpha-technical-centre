// Cloudflare Worker: routes www.alpha-technical-centre.com/api/* and /mcp* to the
// vault-api service on Render. Cloudflare Access runs before this Worker; the
// Access JWT header is forwarded so the API can verify it independently.
// Bind VAULT_API_ORIGIN (e.g. https://atc-vault-api.onrender.com) as a plain-text variable.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, env.VAULT_API_ORIGIN);
    const headers = new Headers(request.headers);
    headers.set('X-Forwarded-Host', url.host);
    const init = { method: request.method, headers, body: request.body, redirect: 'manual' };
    return fetch(target, init);
  },
};
