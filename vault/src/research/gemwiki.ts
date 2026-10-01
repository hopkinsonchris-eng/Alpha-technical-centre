/**
 * Global Energy Monitor wiki pages as a research source (wave 4, W4-D1 revised; 05-markup.md §1.4.8).
 * Every field imported from the Global Oil and Gas Extraction Tracker carries its wiki page URL. The page
 * repeats the tracker's facts (already on the field's dossier) and, more usefully, cites its sources: the
 * ministry report, the USGS plate, the law-firm note. Each page becomes one note and each reference it cites
 * becomes a finding with its URL. No model is involved; the licence is CC BY 4.0 and the attribution travels.
 */
import type { Finding } from './findings.ts';

export interface GemWikiReference { url: string; title: string | null }
export interface GemWikiPage { url: string; title: string; lead: string; text: string; references: GemWikiReference[] }
export type GemWikiResult = { ok: true; page: GemWikiPage } | { ok: false; reason: string };

export const GEM_ATTRIBUTION = 'Global Energy Monitor, Global Oil and Gas Extraction Tracker (CC BY 4.0)';
const OWN_HOST = /(^|\.)(gem\.wiki|globalenergymonitor\.org)$/i;

const decode = (s: string) => s
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const strip = (html: string) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\[\s*\d+(\.\d+)*\s*\]/g, '').replace(/\s+/g, ' ').trim();

/** Reads the article body, the lead sentence, a flattened text and the external references. */
export function parseGemWiki(html: string, url: string): GemWikiPage {
  const bodyAttr = html.indexOf('id="mw-content-text"');
  const bodyStart = bodyAttr >= 0 ? html.indexOf('>', bodyAttr) + 1 : 0;
  let body = html.slice(bodyStart);
  const catlinks = body.indexOf('id="catlinks"');
  if (catlinks >= 0) body = body.slice(0, catlinks);
  body = body.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  const titleM = /<h1[^>]*id="firstHeading"[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ?? /<title>([^<]*)<\/title>/i.exec(html);
  const title = titleM ? strip(titleM[1]).replace(/\s*-\s*Global Energy Monitor\s*$/i, '') : url;
  // The lead: the first paragraph that is a sentence about the unit, not the tracker banner.
  let lead = '';
  for (const m of body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = strip(m[1]);
    if (t.length > 20 && /\.\s*$/.test(t) && !/^This article is part of/i.test(t) && !/^Report an error/i.test(t)) { lead = t; break; }
  }
  // References: external links in the References list (or anywhere after that heading), never the wiki's own pages.
  const refs: GemWikiReference[] = [];
  const seen = new Set<string>();
  const refStart = body.search(/<ol[^>]*class="[^"]*references[^"]*"/i);
  const refHtml = refStart >= 0 ? body.slice(refStart) : (() => { const h = body.search(/<h2[^>]*>[\s\S]*?References[\s\S]*?<\/h2>/i); return h >= 0 ? body.slice(h) : ''; })();
  for (const li of refHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const item = li[1];
    const a = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(item);
    if (!a) continue;
    const href = decode(a[1]);
    let host = ''; try { host = new URL(href).hostname; } catch { continue; }
    if (OWN_HOST.test(host) || seen.has(href)) continue;
    seen.add(href);
    // A title only when the citation has one: a bare URL, "(PDF)", "Archived from the original" and the
    // template noise are not titles. Without one the finding is named after the host.
    const clean = (x: string) => strip(x).replace(/\{\{cite web\}\}.*$/i, '').replace(/\.?\s*Archived from the original.*$/i, '').replace(/\s*\(PDF\)\s*/gi, ' ').replace(/https?:\/\/\S+/g, '').replace(/\s+([.,;:])/g, '$1').replace(/^[\s.,;:–—-]+|[\s.,;:–—-]+$/g, '').trim();
    const cite = /<cite[^>]*>([\s\S]*?)<\/cite>/i.exec(item);
    const t = clean(cite ? cite[1] : '') || clean(a[2]);
    refs.push({ url: href, title: t.length > 8 ? t : null });
  }
  // The flattened article text, references excluded, for the note's excerpt.
  const textEnd = refStart >= 0 ? refStart : body.length;
  let text = strip(body.slice(0, textEnd).replace(/<(h[1-6])[^>]*>/gi, ' | ').replace(/<\/(p|li|tr|h[1-6])>/gi, ' ')).replace(/(\s*\|\s*)+/g, ' | ').replace(/^\|\s*/, '');
  const at = lead ? text.indexOf(lead) : -1;
  if (at > 0) text = text.slice(at);                                      // the tracker banner and category links go
  text = text.replace(/\s*\|\s*(Articles and Resources|Additional Data)[\s\S]*$/i, '').slice(0, 2000);
  return { url, title, lead, text, references: refs };
}

export async function fetchGemWiki(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<GemWikiResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { headers: { accept: 'text/html', 'user-agent': 'alpha-technical-centre-vault/1.0 (research; +https://alpha-technical-centre.com)' }, signal: ctrl.signal });
    if (!r.ok) return { ok: false, reason: `gem.wiki answered HTTP ${r.status}` };
    const html = await r.text();
    const page = parseGemWiki(html, url);
    if (!page.lead && !page.references.length) return { ok: false, reason: 'gem.wiki page has no article text' };
    return { ok: true, page };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    return { ok: false, reason: /abort/i.test(msg) ? 'gem.wiki timed out' : `gem.wiki unreachable: ${msg}` };
  } finally { clearTimeout(timer); }
}

/** One note for the page and one finding per reference it cites, all under the field. */
export function gemWikiFindings(field: { id: string; name: string }, page: GemWikiPage): Finding[] {
  const out: Finding[] = [];
  const text = [page.lead, page.text].filter(Boolean).join(' ');
  out.push({ source: 'gem-wiki', external_id: page.url, url: page.url, title: `Global Energy Monitor: ${field.name}`, text, published_at: null, authors: ['Global Energy Monitor'], query: field.name, asset_ids: [field.id],
    facts: { attribution: GEM_ATTRIBUTION, page_title: page.title, references: page.references } });
  for (const r of page.references) {
    let host = ''; try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch { host = ''; }
    const title = r.title ?? `Source cited by Global Energy Monitor for ${field.name}${host ? ' (' + host + ')' : ''}`;
    out.push({ source: 'gem-wiki-ref', external_id: r.url, url: r.url, title, text: `${title}. Cited by Global Energy Monitor as a source for ${field.name}.`, published_at: null, authors: [], query: field.name, asset_ids: [field.id],
      facts: { attribution: GEM_ATTRIBUTION, cited_on: page.url } });
  }
  return out;
}
