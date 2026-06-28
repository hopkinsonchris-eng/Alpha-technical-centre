// ===========================================================================
// apex-sim · core/logging
// ---------------------------------------------------------------------------
// Leveled logger with a stable, greppable format. Used by every module so run logs are uniform and machine-parseable.
// ===========================================================================

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
let current = LEVELS.info;

export function setLevel(name) { current = LEVELS[name] ?? current; }

function emit(level, tag, msg, extra) {
  if (LEVELS[level] > current) return;
  const line = `[${level.toUpperCase()}] ${tag}: ${msg}`;
  (level === 'error' ? console.error : console.log)(line, extra ?? '');
}

export const log = {
  error: (tag, m, e) => emit('error', tag, m, e),
  warn:  (tag, m, e) => emit('warn', tag, m, e),
  info:  (tag, m, e) => emit('info', tag, m, e),
  debug: (tag, m, e) => emit('debug', tag, m, e),
};
