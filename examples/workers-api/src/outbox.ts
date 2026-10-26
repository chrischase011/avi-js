// A tiny file-based outbox shared by the API workers and the background worker. Each process has
// its own memory, so shared work has to live outside it: here a folder, in a real app a database
// table or a queue such as Redis or RabbitMQ.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createToken, defineModule } from '@avijs/core';

export interface Email {
  readonly to: string;
  readonly subject: string;
}

export class Outbox {
  constructor(private readonly dir: string) {}

  async add(email: Email): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const id = randomUUID();
    // Write then rename, so the worker never reads a half-written file.
    await writeFile(path.join(this.dir, `${id}.tmp`), JSON.stringify(email));
    await rename(path.join(this.dir, `${id}.tmp`), path.join(this.dir, `${id}.json`));
    return id;
  }

  async pending(): Promise<string[]> {
    const files = await readdir(this.dir).catch(() => []);
    return files.filter((file) => file.endsWith('.json')).sort();
  }

  async read(file: string): Promise<Email> {
    return JSON.parse(await readFile(path.join(this.dir, file), 'utf8')) as Email;
  }

  async remove(file: string): Promise<void> {
    await rm(path.join(this.dir, file), { force: true });
  }
}

export const OUTBOX = createToken<Outbox>('Outbox');

export const OutboxModule = defineModule({
  name: 'OutboxModule',
  providers: [
    {
      provide: OUTBOX,
      useFactory: () => new Outbox(process.env['OUTBOX_DIR'] ?? path.resolve('data/outbox')),
    },
  ],
  exports: [OUTBOX],
});
