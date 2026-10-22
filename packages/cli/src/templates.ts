export type TemplateName = 'modular' | 'minimal';

export interface TemplateOptions {
  name: string;
  template: TemplateName;
  /** Version range for the @avi packages. */
  aviVersion: string;
}

/** Every file of a new project, keyed by its path relative to the project folder. */
export function templateFiles(options: TemplateOptions): Record<string, string> {
  return {
    ...shared(options),
    ...(options.template === 'modular' ? modular() : minimal()),
  };
}

function shared({ name, template, aviVersion }: TemplateOptions): Record<string, string> {
  const pkg = {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'tsc',
      start: 'node dist/main.js',
      dev: 'avi dev',
      check: 'avi check',
      test: 'tsc && node --test "dist/**/*.test.js"',
    },
    dependencies: { '@avi/core': aviVersion },
    devDependencies: {
      '@avi/cli': aviVersion,
      '@avi/testing': aviVersion,
      '@types/node': '^22.0.0',
      typescript: '~6.0.3',
    },
    engines: { node: '>=22.12' },
  };
  const tsconfig = {
    compilerOptions: {
      target: 'ES2023',
      lib: ['ES2023', 'ESNext.Disposable'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      types: ['node'],
      strict: true,
      skipLibCheck: true,
      outDir: 'dist',
      rootDir: 'src',
      sourceMap: true,
    },
    include: ['src'],
  };
  return {
    'package.json': `${JSON.stringify(pkg, null, 2)}\n`,
    'tsconfig.json': `${JSON.stringify(tsconfig, null, 2)}\n`,
    '.gitignore': 'node_modules/\ndist/\n',
    'README.md': `# ${name}

An [Avi.js](https://github.com/chrischase011/avi-js) API (${template} template).

\`\`\`sh
npm install
npm run dev     # compile and restart on change
npm test        # compile and run the tests
npm start       # run the compiled app
\`\`\`

Then open http://localhost:3000/health and http://localhost:3000/users.
`,
  };
}

const MAIN_LISTEN = `const { port } = await app.listen(Number(process.env['PORT'] ?? 3000));
console.log(\`Listening on http://localhost:\${String(port)}\`);

const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
`;

function modular(): Record<string, string> {
  return {
    'src/main.ts': `import { AviFactory } from '@avi/core';
import { AppModule } from './app.module.js';

const app = await AviFactory.create(AppModule);
${MAIN_LISTEN}`,
    'src/app.module.ts': `import { Module } from '@avi/core';
import { HealthController } from './common/health.controller.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({ imports: [UsersModule], controllers: [HealthController] })
export class AppModule {}
`,
    'src/common/health.controller.ts': `import { Controller, Get } from '@avi/core';

@Controller()
export class HealthController {
  @Get('/health')
  check() {
    return 'ok';
  }
}
`,
    'src/modules/users/users.module.ts': `import { Module } from '@avi/core';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({ controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
`,
    'src/modules/users/users.service.ts': `import { Injectable } from '@avi/core';
import type { CreateUserDto } from './dto/create-user.dto.js';

export interface User {
  id: number;
  name: string;
}

@Injectable()
export class UsersService {
  readonly #users: User[] = [{ id: 1, name: 'Ada' }];

  findAll(): User[] {
    return this.#users;
  }

  findOne(id: number): User | undefined {
    return this.#users.find((user) => user.id === id);
  }

  create(dto: CreateUserDto): User {
    const user = { id: this.#users.length + 1, name: dto.name };
    this.#users.push(user);
    return user;
  }
}
`,
    'src/modules/users/users.controller.ts': `import { Controller, Get, HttpError, Post, reply, type Context } from '@avi/core';
import { parseCreateUser } from './dto/create-user.dto.js';
import { UsersService } from './users.service.js';

@Controller('/users')
export class UsersController {
  static inject = [UsersService] as const;

  constructor(private readonly users: UsersService) {}

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Get('/:id')
  findOne(ctx: Context) {
    const user = this.users.findOne(Number(ctx.params['id']));
    if (!user) throw new HttpError(404, 'User not found');
    return user;
  }

  @Post()
  async create(ctx: Context) {
    const dto = parseCreateUser(await ctx.json());
    if (!dto) throw new HttpError(400, 'Body must be an object with a name');
    return reply(this.users.create(dto), { status: 201 });
  }
}
`,
    'src/modules/users/dto/create-user.dto.ts': `export interface CreateUserDto {
  name: string;
}

// Swap this for a schema library (Zod, Valibot, ...) and route schemas when the API grows.
export function parseCreateUser(input: unknown): CreateUserDto | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const { name } = input as { name?: unknown };
  return typeof name === 'string' && name.trim() !== '' ? { name: name.trim() } : undefined;
}
`,
    'src/modules/users/users.test.ts': `import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createTestClient, type TestClient } from '@avi/testing';
import { AppModule } from '../../app.module.js';

let client: TestClient;
before(async () => {
  client = await createTestClient(AppModule);
});
after(() => client.close());

test('lists users', async () => {
  const res = await client.get('/users');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ id: 1, name: 'Ada' }]);
});

test('creates a user', async () => {
  const res = await client.post('/users', { name: 'Grace' });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: 2, name: 'Grace' });
});

test('rejects a user without a name', async () => {
  assert.equal((await client.post('/users', {})).status, 400);
});
`,
  };
}

function minimal(): Record<string, string> {
  return {
    'src/main.ts': `import { createApp } from './app.js';

const app = createApp();
${MAIN_LISTEN}`,
    'src/app.ts': `import { createAvi } from '@avi/core';
import { healthRoutes } from './routes/health.js';
import { usersRoutes } from './routes/users.js';
import { UsersService } from './services/users.js';

export function createApp() {
  return createAvi().register({
    providers: [UsersService],
    controllers: [healthRoutes, usersRoutes],
  });
}
`,
    'src/routes/health.ts': `import { defineController, route } from '@avi/core';

export const healthRoutes = defineController({
  routes: [route({ method: 'GET', path: '/health', handler: () => 'ok' })],
});
`,
    'src/routes/users.ts': `import { HttpError, defineController, reply, route } from '@avi/core';
import { UsersService } from '../services/users.js';

export const usersRoutes = defineController({
  prefix: '/users',
  inject: [UsersService],
  routes: (users) => [
    route({ method: 'GET', path: '/', handler: () => users.findAll() }),
    route({
      method: 'GET',
      path: '/:id',
      handler: (ctx) => {
        const user = users.findOne(Number(ctx.params.id));
        if (!user) throw new HttpError(404, 'User not found');
        return user;
      },
    }),
    route({
      method: 'POST',
      path: '/',
      handler: async (ctx) => {
        const { name } = (await ctx.json()) as { name?: unknown };
        if (typeof name !== 'string' || name.trim() === '') {
          throw new HttpError(400, 'Body must be an object with a name');
        }
        return reply(users.create(name.trim()), { status: 201 });
      },
    }),
  ],
});
`,
    'src/services/users.ts': `export interface User {
  id: number;
  name: string;
}

export class UsersService {
  readonly #users: User[] = [{ id: 1, name: 'Ada' }];

  findAll(): User[] {
    return this.#users;
  }

  findOne(id: number): User | undefined {
    return this.#users.find((user) => user.id === id);
  }

  create(name: string): User {
    const user = { id: this.#users.length + 1, name };
    this.#users.push(user);
    return user;
  }
}
`,
    'src/app.test.ts': `import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createTestClient, type TestClient } from '@avi/testing';
import { createApp } from './app.js';

let client: TestClient;
before(async () => {
  client = await createTestClient(createApp());
});
after(() => client.close());

test('lists users', async () => {
  const res = await client.get('/users');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ id: 1, name: 'Ada' }]);
});

test('creates a user', async () => {
  const res = await client.post('/users', { name: 'Grace' });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: 2, name: 'Grace' });
});

test('answers 404 for an unknown user', async () => {
  assert.equal((await client.get('/users/99')).status, 404);
});
`,
  };
}
