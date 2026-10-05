/**
 * Embeddings (M09). `Embedder.embed(texts) → number[][]`, 1024 dimensions (chunks.embedding is vector(1024)).
 *  - VoyageEmbedder: Voyage AI over fetch (VOYAGE_API_KEY, model voyage-3.5 unless VOYAGE_MODEL says otherwise).
 *  - FakeEmbedder: deterministic hashing embedder for tests and keyless dev (word and bigram features, L2-normalised),
 *    so texts sharing words are closer than unrelated ones.
 * openEmbedder(): Voyage when a key is set, Fake otherwise, and a refusal in production without a key.
 */
import { createHash } from 'node:crypto';

export const EMBED_DIMS = 1024;
export type InputType = 'document' | 'query';

export interface Embedder {
  readonly name: string;
  readonly dims: number;
  /** Cosine distance beyond which a neighbour is not a match for this embedder (the search's vector ceiling). */
  readonly maxDistance: number;
  embed(texts: string[], inputType?: InputType): Promise<number[][]>;
}

export class VoyageEmbedder implements Embedder {
  readonly name = 'voyage';
  readonly dims = EMBED_DIMS;
  /** Unrelated text sits around 0.7 and above with the Voyage models, a paraphrase well under 0.5. */
  readonly maxDistance = 0.6;
  constructor(
    private readonly apiKey: string,
    public readonly model = process.env.VOYAGE_MODEL || 'voyage-3.5',
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly batchSize = 64,
  ) {}

  async embed(texts: string[], inputType: InputType = 'document'): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) out.push(...await this.batch(texts.slice(i, i + this.batchSize), inputType));
    return out;
  }

  private async batch(input: string[], inputType: InputType): Promise<number[][]> {
    let lastErr = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await this.fetchImpl('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ input, model: this.model, input_type: inputType, output_dimension: this.dims, truncation: true }),
      });
      if (res.ok) {
        const j: any = await res.json();
        const data = [...(j.data ?? [])].sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding as number[]);
        if (data.length !== input.length || data.some(v => v.length !== this.dims)) throw new Error(`voyage returned ${data.length} vectors of ${data[0]?.length} dims, expected ${input.length} of ${this.dims}`);
        return data;
      }
      lastErr = `voyage ${res.status}: ${(await res.text()).slice(0, 200)}`;
      if (res.status !== 429 && res.status < 500) break;
      await new Promise(r => setTimeout(r, 250 * 2 ** attempt));
    }
    throw new Error(lastErr);
  }
}

export class FakeEmbedder implements Embedder {
  readonly name = 'fake';
  readonly dims = EMBED_DIMS;
  /** Hashed bag of words: no shared word puts a query at distance 1.0, any shared word well under 0.9. */
  readonly maxDistance = 0.9;
  async embed(texts: string[]): Promise<number[][]> { return texts.map(t => this.one(t)); }

  private one(text: string): number[] {
    const v = new Array<number>(this.dims).fill(0);
    const words = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) ?? [];
    const bump = (feature: string, w: number) => {
      const h = createHash('sha1').update(feature).digest();
      v[h.readUInt16BE(0) % this.dims] += (h[2] & 1 ? 1 : -1) * w;
    };
    words.forEach((w, i) => { bump(w, 1); if (i) bump(`${words[i - 1]} ${w}`, 0.5); });
    if (!words.length) bump('', 1);
    const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0)) || 1;
    return v.map(x => Math.round((x / norm) * 1e6) / 1e6);
  }
}

export function openEmbedder(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): Embedder {
  if (env.VOYAGE_API_KEY) return new VoyageEmbedder(env.VOYAGE_API_KEY, env.VOYAGE_MODEL || 'voyage-3.5', fetchImpl);
  if (env.NODE_ENV === 'production') throw new Error('VOYAGE_API_KEY is required in production: refusing to index with fake embeddings');
  return new FakeEmbedder();
}

/** pgvector text literal for a vector column. */
export const vectorLiteral = (v: number[]) => `[${v.join(',')}]`;
