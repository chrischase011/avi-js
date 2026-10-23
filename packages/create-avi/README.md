# create-avi

Creates an [Avi.js](https://github.com/chrischase011/avi-js) project.

```sh
npm create avi@latest my-app
npm create avi@latest my-app -- --template minimal
```

Without a name, it asks for the name, the template and the validation library (Valibot, Zod or
none). It runs `avi new` from [`@avijs/cli`](https://www.npmjs.com/package/@avijs/cli), so the
options are the same: `--template modular|minimal`, `--validator valibot|zod|none` and `--dir`.

Then:

```sh
cd my-app
npm install
npm run dev
```

See the [tutorial](https://github.com/chrischase011/avi-js/blob/main/docs/tutorial/README.md) to
get started. Requires Node.js 22.12 or newer. MIT licensed.
