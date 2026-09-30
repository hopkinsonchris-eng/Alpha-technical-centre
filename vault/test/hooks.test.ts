import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const settings = JSON.parse(readFileSync(path.join(REPO, '.claude/settings.json'), 'utf8'));

function hookCommand(event: string, matcher?: string): string {
  const entry = (settings.hooks[event] as any[]).find(e => matcher === undefined || e.matcher === matcher);
  assert.ok(entry, `${event} hook configured`);
  const h = entry.hooks[0];
  assert.equal(h.type, 'command');
  return h.command;
}
function run(command: string, stdin: string, env: Record<string, string | undefined>) {
  const e: Record<string, string | undefined> = { ...process.env, ...env };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return spawnSync('sh', ['-c', command], { input: stdin, env: e as NodeJS.ProcessEnv, encoding: 'utf8' });
}
const payload = (file: string, tool = 'Write') => JSON.stringify({ tool_name: tool, tool_input: { file_path: file, content: 'x' } });
const SCHEMA_FILE = path.join(REPO, 'docs/vault-hub/schemas/lesson.schema.json');
const pre = () => hookCommand('PreToolUse', 'Write|Edit');

test('settings.json wires a SessionStart hook and a PreToolUse hook for Write|Edit', () => {
  assert.equal(settings.hooks.PreToolUse[0].matcher, 'Write|Edit');
  assert.ok(hookCommand('SessionStart').includes('LESSONS.md'));
});

test('PreToolUse: an edit under docs/vault-hub/schemas/ on a non-schema branch exits 2 with a message', () => {
  for (const branch of ['main', 'claude/busy-carson-y75611', 'feature/schema', 'schemas/x', '']) {
    for (const tool of ['Write', 'Edit']) {
      const r = run(pre(), payload(SCHEMA_FILE, tool), { CLAUDE_PROJECT_DIR: REPO, HOOK_BRANCH: branch });
      assert.equal(r.status, 2, `branch "${branch}" ${tool}: ${r.stderr}`);
      assert.match(r.stderr, /schema\//); assert.match(r.stderr, /Tier A/);
    }
  }
  // Relative paths and traversal are resolved before the check.
  for (const f of ['docs/vault-hub/schemas/lesson.schema.json', './docs/vault-hub/schemas/new.json', 'docs/vault-hub/modules/../schemas/run-record.schema.json']) {
    assert.equal(run(pre(), payload(f), { CLAUDE_PROJECT_DIR: REPO, HOOK_BRANCH: 'main' }).status, 2, f);
  }
});

test('PreToolUse: on a schema/ branch the same edit is allowed (exit 0)', () => {
  for (const branch of ['schema/x', 'schema/lesson-recurrence']) {
    const r = run(pre(), payload(SCHEMA_FILE), { CLAUDE_PROJECT_DIR: REPO, HOOK_BRANCH: branch });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, '');
  }
});

test('PreToolUse: edits elsewhere, malformed payloads and payloads without a path are never blocked', () => {
  const env = { CLAUDE_PROJECT_DIR: REPO, HOOK_BRANCH: 'main' };
  for (const f of [path.join(REPO, 'vault/src/api/lessons.routes.ts'), path.join(REPO, 'docs/vault-hub/modules/M15-lessons-weekly-dream.md'), path.join(REPO, 'docs/vault-hub/schemas-notes.md'), '/tmp/elsewhere.json']) {
    assert.equal(run(pre(), payload(f), env).status, 0, f);
  }
  assert.equal(run(pre(), 'not json', env).status, 0);
  assert.equal(run(pre(), JSON.stringify({ tool_name: 'Write', tool_input: {} }), env).status, 0);
});

test('PreToolUse: without HOOK_BRANCH the branch comes from git rev-parse --abbrev-ref HEAD', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'hook-git-'));
  const git = (...a: string[]) => { const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: repo, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  git('init', '-q'); git('checkout', '-q', '-b', 'main'); git('commit', '-q', '--allow-empty', '-m', 'init');
  mkdirSync(path.join(repo, 'docs/vault-hub/schemas'), { recursive: true });
  const file = path.join(repo, 'docs/vault-hub/schemas/x.schema.json');
  const env = { CLAUDE_PROJECT_DIR: repo, HOOK_BRANCH: undefined };
  assert.equal(run(pre(), payload(file), env).status, 2, 'on main');
  git('checkout', '-q', '-b', 'schema/x');
  assert.equal(run(pre(), payload(file), env).status, 0, 'on schema/x');
});

test('SessionStart: prints LESSONS.md as additionalContext when present, nothing when absent', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hook-session-'));
  const cmd = hookCommand('SessionStart');
  const absent = run(cmd, '{}', { CLAUDE_PROJECT_DIR: root });
  assert.equal(absent.status, 0); assert.equal(absent.stdout, '');
  mkdirSync(path.join(root, 'vault/firm'), { recursive: true });
  const body = '# Firm lessons\n\n## reservoir\n- Use "measured" viscosity (lesson:00000000-0000-4000-8000-000000000001, firm)\n';
  writeFileSync(path.join(root, 'vault/firm/LESSONS.md'), body);
  const r = run(cmd, '{}', { CLAUDE_PROJECT_DIR: root });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(out.hookSpecificOutput.additionalContext, body);
  // The committed file is what a real session gets.
  const real = JSON.parse(run(cmd, '{}', { CLAUDE_PROJECT_DIR: REPO }).stdout);
  assert.equal(real.hookSpecificOutput.additionalContext, readFileSync(path.join(REPO, 'vault/firm/LESSONS.md'), 'utf8'));
});
