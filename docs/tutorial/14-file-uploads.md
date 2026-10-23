# 14. File uploads

> **Status: Runnable.** Everything on this page works today.

`@avijs/multipart` reads `multipart/form-data` bodies: the format browsers use for forms with a
file input, and `fetch` with `FormData`.

```sh
npm install @avijs/multipart
```

## Small forms: readForm

`readForm()` reads the whole form into memory. It suits avatars, attachments and other small files:

```ts
import { readForm } from '@avijs/multipart';

route({
  method: 'POST',
  path: '/profile',
  handler: async (ctx) => {
    const { fields, files } = await readForm(ctx, { fileSize: 2_000_000, files: 1 });
    const avatar = files[0];
    if (!avatar) throw new HttpError(400, 'Attach an avatar');
    await profiles.update(String(fields['name']), avatar.buffer, avatar.mimeType);
    return reply(undefined, { status: 204 });
  },
});
```

`fields` holds the text fields; a name sent more than once holds all its values as an array. Each
file has its `name` (the form field), `filename`, `mimeType`, `size` and `buffer`. Everything read,
files and fields together, is capped by `maxTotalSize` (10 MiB by default).

## Large files: multipart

`multipart()` hands you each part as it arrives, so a file can go straight to disk or storage
without ever being held in memory:

```ts
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { multipart } from '@avijs/multipart';

route({
  method: 'POST',
  path: '/videos',
  handler: async (ctx) => {
    const saved: string[] = [];
    for await (const part of multipart(ctx, { fileSize: 500_000_000, files: 5 })) {
      if (part.kind === 'field') continue;
      const id = randomUUID();
      await pipeline(part.stream, createWriteStream(`/data/uploads/${id}`));
      saved.push(id);
    }
    return { saved };
  },
});
```

Read or pipe each file before moving to the next part. A file you skip is discarded, so skipping
is safe.

## Limits

Limits are on by default and checked while the body arrives. When one is exceeded, reading stops
at once and the client gets `413` with a message naming the limit. The connection is then closed
rather than reading the rest, so a client still sending a large file may see the connection end
instead of the `413`.

| Limit       | Default | Meaning                      |
| ----------- | ------- | ---------------------------- |
| `fileSize`  | 10 MiB  | Largest single file          |
| `files`     | 10      | Most files                   |
| `fields`    | 100     | Most text fields             |
| `fieldSize` | 100 KiB | Largest text field           |
| `parts`     | 1000    | Most parts, files and fields |

Other content types get `415`, and malformed bodies `400`. If the client disconnects mid-upload,
`multipart()` stops with an error and any file stream you are reading fails, so partial files can
be cleaned up in a `catch`. These limits are separate from the app's `bodyLimit`, which applies to
`ctx.json()` and `ctx.text()`.

## Treat file details as untrusted

- **File names come from the client.** Directories are removed (`../../etc/passwd` arrives as
  `passwd`), but never use the name as a path: store files under a name you generate, as above,
  and keep the original only for display.
- **`mimeType` is what the client claims.** Check the file's content if the type matters, for
  example for images you will serve back.
- A field named `__proto__` or `constructor` is just a field; `readForm` cannot be used to change
  objects' prototypes.

## Next

[Chapter 15: Typed client](15-typed-client.md).
