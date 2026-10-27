import type { LogFields, Logger, ResponseInfo } from './server.js';

type Level = 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { info: 0, warn: 1, error: 2 };

export interface JsonLoggerOptions {
  /** Lowest level written. Default: `info`. */
  level?: Level;
  /** Where each line goes. Default: standard output. */
  write?: (line: string) => void;
}

/** A logger that writes one JSON object per line, for log collectors. */
export function jsonLogger(options: JsonLoggerOptions = {}): Required<Logger> {
  const min = LEVELS[options.level ?? 'info'];
  const write =
    options.write ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });

  const log = (level: Level, message: string, fields?: LogFields, error?: unknown) => {
    if (LEVELS[level] < min) return;
    const entry = {
      ...fields,
      time: new Date().toISOString(),
      level,
      msg: message,
      ...(error === undefined ? {} : { error: serializeError(error) }),
    };
    write(stringify(entry, { time: entry.time, level, msg: message }));
  };

  return {
    error: (message, error, fields) => {
      log('error', message, fields, error);
    },
    warn: (message, fields) => {
      log('warn', message, fields);
    },
    info: (message, fields) => {
      log('info', message, fields);
    },
  };
}

export interface LogRequestsOptions {
  /** Return `true` to leave a request out, such as health checks. */
  skip?: (info: ResponseInfo) => boolean;
}

/**
 * An `onResponse` function that logs one line per request through `logger.info`, or
 * `logger.warn` for 5xx responses and aborted requests.
 */
export function logRequests(
  logger: Logger,
  options: LogRequestsOptions = {},
): (info: ResponseInfo) => void {
  return (info) => {
    if (options.skip?.(info)) return;
    const fields: LogFields = {
      requestId: info.id,
      method: info.method,
      path: info.path,
      route: info.route,
      status: info.status,
      duration: Math.round(info.duration * 100) / 100,
      aborted: info.aborted,
    };
    const message = `${info.method} ${info.path} ${String(info.status)}`;
    if (info.status >= 500 || info.aborted) logger.warn?.(message, fields);
    else logger.info?.(message, fields);
  };
}

function serializeError(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error)) return plain(error);
  const result: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  if (error.cause !== undefined && depth < 3) {
    result['cause'] = serializeError(error.cause, depth + 1);
  }
  return result;
}

// A thrown or cause object, such as validation issues, as JSON when it is small and serializable.
function plain(value: unknown): unknown {
  if (typeof value === 'object' && value !== null) {
    try {
      // JSON.stringify gives undefined for some values despite its type; length then throws.
      const json = JSON.stringify(value) as string | undefined;
      if (json !== undefined && json !== '{}' && json.length <= 10_000) {
        return JSON.parse(json) as unknown;
      }
    } catch {
      // Cycles and throwing getters fall back to text.
    }
  }
  return text(value);
}

// Anything can be thrown, including objects without a prototype, which String() cannot convert.
function text(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[unprintable value]';
  }
}

// Fields come from application code; a field that cannot be serialized must not lose the entry.
function stringify(entry: object, fallback: object): string {
  try {
    return JSON.stringify(entry);
  } catch {
    return JSON.stringify({ ...fallback, logError: 'Log fields could not be serialized' });
  }
}
