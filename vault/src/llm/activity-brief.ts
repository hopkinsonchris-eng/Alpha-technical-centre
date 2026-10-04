/**
 * What came in (wave 6, Option A): one sentence per opportunity about what arrived since the person last looked,
 * written by the provider from the new records only, under the drafter's rule: a sentence stands only when it cites
 * a record among them; everything else is dropped. Without a provider the card shows the counts alone.
 */
import type { LlmProvider } from './provider.ts';

export interface ActivityRecord { ref: string; type: string; title: string; date: string | null; direction?: string | null; from?: string | null; snippet?: string | null }
export interface ActivityProject { id: string; name: string; records: ActivityRecord[] }
export interface ProjectBrief { project_id: string; sentence: string | null; citations: string[]; dropped: number }
export interface ActivityBrief { projects: ProjectBrief[]; model: string | null; usage: { input: number; cached: number; output: number } }

const CITE_RE = /\[((?:run|doc|lesson):[^\]\s]+)\]/g;

/** Keep only the sentences that cite one of the allowed records; strip citations the records do not include. */
export function keepCited(text: string, allowed: Set<string>): { sentence: string | null; citations: string[]; dropped: number } {
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?![^\[]*\])/).filter(Boolean);
  const kept: string[] = []; const cites = new Set<string>(); let dropped = 0;
  for (const s of sentences) {
    const found = [...s.matchAll(CITE_RE)].map(m => m[1]);
    const ok = found.filter(c => allowed.has(c));
    if (!ok.length) { dropped++; continue; }
    const cleaned = s.replace(CITE_RE, m => (allowed.has(m.slice(1, -1)) ? m : '')).replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
    kept.push(cleaned); ok.forEach(c => cites.add(c));
  }
  return { sentence: kept.length ? kept.join(' ') : null, citations: [...cites], dropped };
}

export function briefPrompt(projects: ActivityProject[], language: 'en' | 'es'): { system: string; user: string } {
  const lang = language === 'es' ? 'Spanish (Latin American)' : 'British English';
  const system = `You tell a partner of an oil and gas consultancy what arrived on each of their opportunities since they last looked. For each project write ONE or TWO plain sentences (at most 45 words in all), in ${lang}, saying what the new records are about and what, if anything, they ask for or decide. Rules checked mechanically: every sentence must end with one or more citations in square brackets taken ONLY from the records listed, in the form [doc:<id>]; a sentence without a citation is deleted; never invent an id; never add anything the records do not say. Answer as lines of the form "PROJECT <project id>: <sentences>", one per project, nothing else.`;
  const user = projects.map(p => `PROJECT ${p.id} (${p.name})\n` + p.records.map(r => `- [${r.ref}] ${r.type}${r.direction ? ` (${r.direction === 'out' ? 'sent' : 'received'})` : ''}${r.date ? ` ${r.date.slice(0, 10)}` : ''}${r.from ? ` from ${r.from}` : ''}: ${r.title}${r.snippet ? ` — ${r.snippet}` : ''}`).join('\n')).join('\n\n');
  return { system, user };
}

export async function briefActivity(provider: LlmProvider | null, projects: ActivityProject[], language: 'en' | 'es' = 'en'): Promise<ActivityBrief> {
  const empty: ActivityBrief = { projects: projects.map(p => ({ project_id: p.id, sentence: null, citations: [], dropped: 0 })), model: null, usage: { input: 0, cached: 0, output: 0 } };
  const withRecords = projects.filter(p => p.records.length);
  if (!provider || !withRecords.length) return empty;
  const { system, user } = briefPrompt(withRecords, language);
  const r = await provider.complete({ system, messages: [{ role: 'user', content: user }], maxTokens: 120 * withRecords.length + 100, temperature: 0 });
  const lines = new Map<string, string>();
  for (const line of r.text.split(/\n+/)) { const m = /^\s*PROJECT\s+([^\s:]+)\s*:\s*(.+)$/i.exec(line); if (m) lines.set(m[1], (lines.get(m[1]) ? lines.get(m[1]) + ' ' : '') + m[2].trim()); }
  const out: ProjectBrief[] = projects.map(p => {
    const text = lines.get(p.id);
    if (!text) return { project_id: p.id, sentence: null, citations: [], dropped: 0 };
    const k = keepCited(text, new Set(p.records.map(x => x.ref)));
    return { project_id: p.id, sentence: k.sentence, citations: k.citations, dropped: k.dropped };
  });
  return { projects: out, model: r.model ?? provider.model, usage: r.usage };
}
