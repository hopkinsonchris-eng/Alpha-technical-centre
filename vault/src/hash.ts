/**
 * Canonical hashing, byte-for-byte the same as js/vault-client.js so that a
 * server-side re-run and a browser save of the same inputs collapse to one run.
 * Rules: sorted keys, numbers as JSON with -0 → 0 (so 1.0 === 1), undefined
 * and functions dropped as JSON.stringify does, NaN/Infinity refuse.
 */
import { createHash } from 'node:crypto';

export function canonicalise(value: unknown, path = '$'): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`canonicalHash: ${String(value)} at ${path} cannot be hashed`);
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'object': {
      const v: any = value;
      if (typeof v.toJSON === 'function') return canonicalise(v.toJSON(), path);
      if (Array.isArray(v)) return '[' + v.map((x, i) => (x === undefined || typeof x === 'function' || typeof x === 'symbol') ? 'null' : canonicalise(x, `${path}[${i}]`)).join(',') + ']';
      const parts: string[] = [];
      for (const k of Object.keys(v).sort()) {
        const x = v[k];
        if (x === undefined || typeof x === 'function' || typeof x === 'symbol') continue;
        parts.push(JSON.stringify(k) + ':' + canonicalise(x, `${path}.${k}`));
      }
      return '{' + parts.join(',') + '}';
    }
    default: throw new Error(`canonicalHash: unsupported ${typeof value} at ${path}`);
  }
}

export function canonicalHash(obj: unknown): string {
  if (obj === undefined) throw new Error('canonicalHash: undefined at $');
  return 'sha256:' + createHash('sha256').update(canonicalise(obj)).digest('hex');
}

/** The run's input hash as the client computes it. */
export function runInputHash(rec: { inputs: unknown; params: unknown; assumptions?: unknown }): string {
  return canonicalHash({ inputs: rec.inputs, params: rec.params, assumptions: rec.assumptions ?? {} });
}
