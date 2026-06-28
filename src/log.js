// Tiny leveled logger. One responsibility: decide whether a message at a given
// level should be emitted (per LOG_LEVEL), and write it with a timestamp + level
// tag to the right stream. error/warn go to stderr; info/debug to stdout — so a
// host that separates the two (launchd's server.err.log, Render's log stream)
// keeps failures distinct from chatter.
//
// No dependency on a logging library: the app runs on raw node:http and the
// surface is small. Swap the `write` seam if a structured backend is ever needed.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

// LOG_LEVEL names the most verbose level to emit (default 'info'): 'warn' shows
// errors + warnings only; 'debug' shows everything. An unknown value falls back
// to 'info' rather than silencing the app.
function thresholdFromEnv() {
  const name = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return name in LEVELS ? LEVELS[name] : LEVELS.info;
}

// Read once at module load; the env is fixed for a process lifetime. Tests that
// need a different threshold construct their own logger via makeLogger().
let threshold = thresholdFromEnv();

function format(level, args) {
  const ts = new Date().toISOString();
  const parts = args.map((a) =>
    a instanceof Error ? (a.stack || a.message)
      : typeof a === 'string' ? a
      : (() => { try { return JSON.stringify(a); } catch { return String(a); } })(),
  );
  return `${ts} ${level.toUpperCase().padEnd(5)} ${parts.join(' ')}`;
}

// `streams` is the only infrastructure seam — production passes process.stdout/
// stderr; a test passes fakes to assert what was written without touching the
// console. `getThreshold` lets a test drive level filtering deterministically.
export function makeLogger({ streams = process, getThreshold = () => threshold } = {}) {
  const at = (level, stream) => (...args) => {
    if (LEVELS[level] > getThreshold()) return;
    stream.write(format(level, args) + '\n');
  };
  return {
    error: at('error', streams.stderr),
    warn: at('warn', streams.stderr),
    info: at('info', streams.stdout),
    debug: at('debug', streams.stdout),
  };
}

export const log = makeLogger();
