/**
 * Headless re-run (M08). Opens the tool page in Chromium, hands it the pinned
 * params through window.ATC_TOOL and reads back outputs, inputs and
 * assumptions. Only browser-tools are supported here; external apps need
 * their own /rerun adapter (M05, D6).
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface HeadlessResult { outputs: Record<string, unknown>; inputs: unknown[]; assumptions: Record<string, unknown>; params: unknown; tool_id: string }

export function findChromium(env = process.env): string | null {
  if (env.RERUN_CHROMIUM && existsSync(env.RERUN_CHROMIUM)) return env.RERUN_CHROMIUM;
  const pw = env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (existsSync(path.join(pw, 'chromium'))) return path.join(pw, 'chromium');
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter(d => d.startsWith('chromium-')).sort().reverse()) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = path.join(cache, d, sub); if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

export async function headlessRun(opts: { entryUrl: string; params: unknown; timeoutMs?: number; executablePath?: string | null }): Promise<HeadlessResult> {
  const executablePath = opts.executablePath ?? findChromium();
  if (!executablePath) throw Object.assign(new Error('re-run runner unavailable: no Chromium found (set RERUN_CHROMIUM)'), { status: 503, code: 'runner_unavailable' });
  const { chromium } = await import('playwright-core');
  const origin = new URL(opts.entryUrl).origin;
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    // The legacy client-side staff gate (admin.html) hides tool pages until this
    // flag is set; the runner is already behind Cloudflare Access, so pass it.
    await page.addInitScript(() => { try { sessionStorage.setItem('atc_auth', '1'); } catch { /* ignore */ } });
    // Only the site itself may be fetched; fonts, CDNs and analytics are cut.
    await page.route('**/*', r => (r.request().url().startsWith(origin) ? r.continue() : r.abort()));
    await page.goto(opts.entryUrl, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 30_000 });
    await page.waitForFunction(() => !!(window as any).ATC_TOOL && typeof (window as any).ATC_TOOL.run === 'function', null, { timeout: opts.timeoutMs ?? 30_000 });
    // Browser-side code is passed as source text: tsx/esbuild would otherwise
    // inject its __name helper into the serialised function and break it.
    await page.evaluate('window.__atcParams = ' + JSON.stringify(opts.params ?? null));
    const script = `(async () => {
      const params = window.__atcParams;
      const t = window.ATC_TOOL;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      if (typeof t.ready === 'function') await t.ready();
      if (typeof t.setParams === 'function') {
        let lastErr = null;
        for (let i = 0; i < 40; i++) {
          try { await t.setParams(params); lastErr = null; break; }
          catch (e) { lastErr = e; if (!/not (yet )?loaded|not ready/i.test(String(e))) throw e; await sleep(250); }
        }
        if (lastErr) throw lastErr;
      }
      const p = typeof t.getParams === 'function' ? t.getParams() : params;
      const outputs = await t.run(p);
      return { outputs, inputs: typeof t.getInputs === 'function' ? t.getInputs() : [], assumptions: typeof t.getAssumptions === 'function' ? t.getAssumptions() : {}, params: p, tool_id: t.id };
    })()`;
    const result = await page.evaluate(script);
    return result as HeadlessResult;
  } finally { await browser.close(); }
}
