/**
 * JSON Schema contracts (M00). The schemas live in docs/vault-hub/schemas so
 * that the design pack and the code cannot drift. Draft 2020-12 via Ajv.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import _Ajv2020 from 'ajv/dist/2020.js';
import _addFormats from 'ajv-formats';
import type { ValidateFunction, ErrorObject } from 'ajv';
// ESM/CJS interop: tsx and Node resolve the default export differently.
const Ajv2020: any = (_Ajv2020 as any).default ?? _Ajv2020;
const addFormats: any = (_addFormats as any).default ?? _addFormats;

export const SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/vault-hub/schemas');
export type SchemaName = 'legal-tag' | 'tool-manifest' | 'run-record' | 'vault-item' | 'lesson' | 'analogue-row' | 'dispatch';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const compiled = new Map<SchemaName, ValidateFunction>();
export function schemaNames(): SchemaName[] {
  return readdirSync(SCHEMA_DIR).filter(f => f.endsWith('.schema.json')).map(f => f.replace('.schema.json', '') as SchemaName).sort();
}
export function validator(name: SchemaName): ValidateFunction {
  let v = compiled.get(name);
  if (!v) {
    const schema = JSON.parse(readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), 'utf8'));
    v = ajv.compile(schema) as ValidateFunction;
    compiled.set(name, v);
  }
  return v;
}

export interface ValidationError { path: string; message: string }
export function validate(name: SchemaName, data: unknown): ValidationError[] {
  const v = validator(name);
  if (v(data)) return [];
  return (v.errors ?? []).map((e: ErrorObject) => ({ path: e.instancePath || '/', message: e.message ?? 'invalid' }));
}
export function assertValid(name: SchemaName, data: unknown): void {
  const errs = validate(name, data);
  if (errs.length) {
    const err = new Error(`${name}: ${errs.map(e => `${e.path} ${e.message}`).join('; ')}`);
    (err as any).status = 400; (err as any).errors = errs;
    throw err;
  }
}
