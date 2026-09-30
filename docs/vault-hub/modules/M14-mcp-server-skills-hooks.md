# M14 — Company MCP server, skills and hooks

**Wave 4 · Tier B · Depends on: M12, M13 · Size S**

## Purpose
The same scope-gated Vault serves Claude Code, claude.ai, Cursor and
scheduled agents; firm procedures are skills; guardrails are hooks.

## Read first
`../02-practice-scan.md` P12, MCP authorization spec (OAuth 2.1, RFC 9728 metadata, audience-bound tokens), Claude Code MCP and hooks docs, `.claude/skills/` (existing).

## Deliverables
- `vault/src/mcp/server.ts` on `/mcp` (streamable HTTP): tools `search_vault(q, scope)`, `get_run(id)`, `list_runs(project, job)`, `get_lessons(scope)`, `get_tool_current(id)`, `record_lesson(lesson)` (creates `proposed`), `draft(kind, project_id, brief)`; resources `vault://lessons/firm.md`, `vault://tools/<id>/CHANGELOG.md`, `vault://projects/<id>/summary.md` with `lastModified`.
- Auth: Cloudflare Access service tokens for CLI clients in wave 4; OAuth 2.1 with protected-resource metadata as a follow-on task noted in the spec, not built now.
- Every tool call passes through M12; no direct database access.
- `.claude/skills/draft-with-vault/SKILL.md`, `record-run/SKILL.md`, `project-closeout/SKILL.md` (the four-question after-action review plus the sanitised method note, writing Lessons and Items).
- `.claude/settings.json`: `SessionStart` hook that injects `vault/firm/LESSONS.md` and the current catalog summary; a `PreToolUse` hook that blocks writes to `docs/vault-hub/schemas/` unless the branch name starts with `schema/`.
- `.mcp.json` at repo root pointing at the server for anyone opening the repo in Claude Code.

## Acceptance criteria
1. From Claude Code with the server configured, `search_vault` in `project:A` scope returns only A-scope hits (reuses the M12 property fixture).
2. `record_lesson` creates a `proposed` lesson visible in the Hub queue.
3. A new session in the repo shows the injected lessons in context (AC10 part 2).
4. The `PreToolUse` hook blocks a schema edit on a non-`schema/` branch.
5. Resources report `lastModified` matching the underlying record.

## Smoke tests
`vault/test/mcp.test.mjs` with the MCP inspector client; hook tests via a scripted Claude Code session transcript.

## Out of scope
Building an identity provider; OAuth flows beyond service tokens.
