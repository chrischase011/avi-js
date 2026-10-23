# @avijs/multipart

Streaming file uploads (`multipart/form-data`) for Avi.js, with limits on by default.

```sh
npm install @avijs/multipart
```

```ts
import { multipart, readForm } from '@avijs/multipart';

// Stream each file where it belongs; nothing is buffered.
for await (const part of multipart(ctx, { fileSize: 5_000_000 })) {
  if (part.kind === 'file') await pipeline(part.stream, createWriteStream(tmpPath()));
}

// Or read a small form into memory.
const { fields, files } = await readForm(ctx);
```

Part of [Avi.js](https://github.com/chrischase011/avi-js). See the
[file uploads chapter](https://chrischase011.github.io/avi-js/tutorial/14-file-uploads) of the
tutorial. Requires Node.js 22.12 or newer. MIT licensed.
