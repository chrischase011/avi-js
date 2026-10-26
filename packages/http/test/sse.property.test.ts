import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sse, type Context, type ServerSentEvent } from '../src/index.js';

const runs = { numRuns: Number(process.env['FUZZ_RUNS'] ?? 300) };

/** The stream sse() sends for `events`, as text. */
async function stream(events: readonly (ServerSentEvent | string)[]): Promise<string> {
  const ctx = { signal: new AbortController().signal } as Context;
  const reply = sse(
    ctx,
    function* () {
      yield* events;
    },
    { heartbeat: false },
  );
  return new Response(reply.body).text();
}

interface Parsed {
  event?: string;
  id?: string;
  retry?: number;
  data: string;
}

/** A browser's EventSource parser, from the HTML spec's "interpret an event stream". */
function parse(text: string): Parsed[] {
  const events: Parsed[] = [];
  let current: { event?: string; id?: string; retry?: number; data?: string[] } = {};
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line === '') {
      if (current.data) {
        events.push({
          ...(current.event === undefined ? {} : { event: current.event }),
          ...(current.id === undefined ? {} : { id: current.id }),
          ...(current.retry === undefined ? {} : { retry: current.retry }),
          data: current.data.join('\n'),
        });
      }
      current = {};
      continue;
    }
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') (current.data ??= []).push(value);
    else if (field === 'event') current.event = value;
    else if (field === 'id' && !value.includes('\0')) current.id = value;
    else if (field === 'retry' && /^\d+$/.test(value)) current.retry = Number(value);
  }
  return events;
}

const text = fc.string({ unit: 'binary', maxLength: 40 });
const event = fc.record(
  {
    event: text,
    id: text,
    retry: fc.integer({ min: 0, max: 1_000_000 }),
    data: text,
  },
  { requiredKeys: ['data'] },
);

describe('sse output (property)', () => {
  it('a client reads back exactly the events sent, or sse refuses them', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(event, { minLength: 1, maxLength: 5 }), async (events) => {
        const unsafe = (v: string | undefined) => v !== undefined && /[\r\n\0]/.test(v);
        let output: string;
        try {
          output = await stream(events);
        } catch (error) {
          // Only a line break or NUL in a name or id may be refused.
          expect(events.some((e) => unsafe(e.event) || unsafe(e.id))).toBe(true);
          expect(error).toBeInstanceOf(TypeError);
          return;
        }
        // Data line breaks are normalized to \n; nothing else may change or appear.
        const expected = events.map((e) => ({
          ...(e.event === undefined ? {} : { event: e.event }),
          ...(e.id === undefined ? {} : { id: e.id }),
          ...(e.retry === undefined ? {} : { retry: e.retry }),
          data: e.data.replace(/\r\n|\r/g, '\n'),
        }));
        expect(parse(output)).toEqual(expected);
      }),
      runs,
    );
  });
});
