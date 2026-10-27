import { main } from '@avijs/cli';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

/** Asks a question and returns the answer, or `fallback` for an empty one. */
export type Ask = (question: string, fallback: string) => Promise<string>;

/**
 * `avi new` for `npm create avi`. Asks for the project name, template and validator when the name
 * is missing and `ask` is given; by default it asks only in an interactive terminal.
 */
export async function create(
  argv: readonly string[],
  ask: Ask | undefined = stdin.isTTY ? prompt : undefined,
): Promise<number> {
  const args = [...argv];
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: false,
    options: {
      template: { type: 'string' },
      validator: { type: 'string' },
      dir: { type: 'string' },
      'avi-version': { type: 'string' },
      from: { type: 'string' },
      help: { type: 'boolean' },
    },
  });

  if (positionals.length === 0 && ask && !values.help && !args.includes('-h')) {
    args.unshift(await ask('Project name', 'my-avi-app'));
    if (values.template === undefined) {
      args.push('--template', await ask('Template, modular or minimal', 'modular'));
    }
    if (values.validator === undefined) {
      args.push('--validator', await ask('Validation library, valibot, zod or none', 'valibot'));
    }
  }
  return main(['new', ...args]);
}

async function prompt(question: string, fallback: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`${question} (${fallback}): `);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}
