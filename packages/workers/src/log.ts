/** Where workers report. `console` fits, and so does an Avi.js `Logger`. */
export interface WorkerLogger {
  error(message: string, error?: unknown): void;
  warn?(message: string): void;
  info?(message: string, fields?: Record<string, unknown>): void;
}

/** An error's message and its causes, one per line. */
export function errorText(error: unknown, depth = 0): string {
  if (!(error instanceof Error)) return String(error);
  if (error.cause === undefined || depth === 4) return error.message;
  return `${error.message}\n  ${errorText(error.cause, depth + 1)}`;
}
