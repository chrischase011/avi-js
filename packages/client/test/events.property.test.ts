import fc from 'fast-check';
import { expect, it } from 'vitest';
import { createClient, type SseMessage } from '../src/index.js';

const runs = { numRuns: Number(process.env['FUZZ_RUNS'] ?? 300) };

// Text without line breaks, which the format cannot carry inside a field.
const text = fc.string({ unit: 'binary', maxLength: 12 }).map((s) => s.replace(/[\r\n\0]/g, ''));
const message = fc.record({
  event: fc.option(
    text.filter((s) => s !== '' && s.trim() === s),
    { nil: undefined },
  ),
  id: fc.option(text, { nil: undefined }),
  data: fc.array(text, { minLength: 1, maxLength: 3 }).map((lines) => lines.join('\n')),
});

/** Writes messages as sse() does, with a chosen line ending. */
function encode(messages: { event?: string; id?: string; data: string }[], eol: string): string {
  return messages
    .map((m) => {
      const lines = [
        ...(m.event === undefined ? [] : [`event: ${m.event}`]),
        ...(m.id === undefined ? [] : [`id: ${m.id}`]),
        ...m.data.split('\n').map((line) => `data: ${line}`),
      ];
      return `${lines.join(eol)}${eol}${eol}`;
    })
    .join('');
}

it('reads back what was sent, however the bytes are split', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(message, { maxLength: 5 }),
      fc.constantFrom('\n', '\r\n', '\r'),
      fc.array(fc.nat({ max: 40 }), { maxLength: 8 }),
      async (messages, eol, cuts) => {
        const bytes = new TextEncoder().encode(encode(messages, eol));
        // Split anywhere, even inside a multi-byte character.
        const points = [...new Set(cuts.map((c) => c % (bytes.length + 1)))].sort((a, b) => a - b);
        const chunks = [0, ...points, bytes.length]
          .slice(1)
          .map((end, i, all) => bytes.slice(i === 0 ? 0 : all[i - 1], end));
        const api = createClient<Record<string, never>>({
          baseUrl: 'http://test',
          fetch: () =>
            Promise.resolve(
              new Response(
                new ReadableStream({
                  start(controller) {
                    for (const chunk of chunks) controller.enqueue(chunk);
                    controller.close();
                  },
                }),
              ),
            ),
        });

        const received: SseMessage[] = [];
        const events = api.events as unknown as (path: string) => AsyncIterable<SseMessage>;
        for await (const m of events('/stream')) received.push(m);

        let lastId: string | undefined;
        const expected = messages.map((m) => {
          lastId = m.id ?? lastId;
          return {
            event: m.event ?? 'message',
            data: m.data,
            ...(lastId === undefined ? {} : { id: lastId }),
          };
        });
        expect(received).toEqual(expected);
      },
    ),
    runs,
  );
});
