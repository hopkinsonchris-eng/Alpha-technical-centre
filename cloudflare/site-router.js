// Cloudflare Worker: splits www.alpha-technical-centre.com by path.
//
//   Render (the origin behind this zone, as today): the Hub, the Vault API and MCP endpoint, the browser tools
//   and their folders, the insights articles, and every file with an extension (style.css, main.js, robots.txt…).
//   Vibe (env.VIBE_ORIGIN, e.g. https://alpha-glass-digital.vibepreview.app): the home page, the new site's
//   clean addresses (/about, /tools, /plan-your-job…) and its build files under /assets/.
//   The old brochure pages (about.html…) redirect to their new addresses.
//
// Route: www.alpha-technical-centre.com/*  (the narrower /api/* and /mcp* routes of api-proxy.js keep winning).
// Cloudflare Access still runs first on /hub, /api and /mcp. Nothing from the visitor's session (cookies, the
// Access token) is ever sent to the Vibe site.

/** Old brochure page → its address on the new site. */
export const REDIRECTS = {
  '/index.html': '/',
  '/about.html': '/about',
  '/contact.html': '/contact',
  '/case-studies.html': '/case-studies',
  '/tools.html': '/tools',
  '/technical-due-diligence.html': '/technical-due-diligence',
  '/oil-gas-modelling.html': '/oil-gas-modelling',
};

/** Folders of the current site that stay on Render whatever is in them (note /tools/ is the APEX folder; /tools is the new page). */
const RENDER_FOLDERS = ['/ela-studio/', '/situation-room/', '/tools/', '/js/', '/insights-data/', '/brand-presentation/'];

/** Where one path goes: { to: 'render' } | { to: 'vibe' } | { to: 'redirect', location }. */
export function route(pathname) {
  if (REDIRECTS[pathname]) return { to: 'redirect', location: REDIRECTS[pathname] };
  if (pathname.startsWith('/assets/')) return { to: 'vibe' };
  // /hub, /api and /mcp match with or without what follows (/mcp also covers /mcp-sse style paths, as api-proxy.js does).
  if (pathname === '/hub' || pathname.startsWith('/hub/') || pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/mcp')) return { to: 'render' };
  if (RENDER_FOLDERS.some(f => pathname.startsWith(f))) return { to: 'render' };
  // A file with an extension is one of Render's (pages end .html, the rest are css, js, images, pdf, txt, xml).
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (/\.[a-z0-9]+$/i.test(last)) return { to: 'render' };
  return { to: 'vibe' };
}

/** Request headers that must never leave for a third-party site. */
const PRIVATE = ['cookie', 'authorization', 'cf-access-jwt-assertion', 'cf-access-client-id', 'cf-access-client-secret'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const r = route(url.pathname);
    if (r.to === 'redirect') return Response.redirect(new URL(r.location + url.search, url.origin).toString(), 301);
    if (r.to === 'render') return fetch(request);

    const origin = new URL(env.VIBE_ORIGIN);
    const headers = new Headers(request.headers);
    for (const h of PRIVATE) headers.delete(h);
    headers.delete('host');
    const res = await fetch(new URL(url.pathname + url.search, origin), {
      method: request.method, headers, redirect: 'manual',
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    });
    const out = new Response(res.body, res);
    out.headers.delete('set-cookie'); // set for vibepreview.app; meaningless (and refused) on our domain
    const loc = out.headers.get('location');
    if (loc) {
      const to = new URL(loc, origin);
      if (to.host === origin.host) out.headers.set('location', new URL(to.pathname + to.search + to.hash, url.origin).toString());
    }
    return out;
  },
};
