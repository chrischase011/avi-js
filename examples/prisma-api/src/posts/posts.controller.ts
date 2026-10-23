import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  reply,
  type RouteContext,
  type RouteSchema,
} from '@avijs/core';
import * as v from 'valibot';
import { Id } from '../schemas.js';
import { PostsService } from './posts.service.js';

const CreatePost = v.object({
  authorId: v.pipe(v.number(), v.integer()),
  title: v.pipe(v.string(), v.trim(), v.minLength(1, 'title is required')),
  content: v.optional(v.string()),
});

const ListPosts = v.object({
  published: v.optional(
    v.pipe(
      v.picklist(['true', 'false']),
      v.transform((s) => s === 'true'),
    ),
  ),
});

const list = { query: ListPosts } satisfies RouteSchema;
const create = { body: CreatePost } satisfies RouteSchema;
const byId = { params: Id } satisfies RouteSchema;

@Controller('/posts')
export class PostsController {
  static inject = [PostsService] as const;

  constructor(private readonly posts: PostsService) {}

  @Get('/', { schema: list })
  list(ctx: RouteContext<typeof list>) {
    return this.posts.list(ctx.input.query.published);
  }

  @Post('/', { schema: create })
  async create(ctx: RouteContext<typeof create>) {
    return reply(await this.posts.create(ctx.input.body), { status: 201 });
  }

  @Patch('/:id/publish', { schema: byId })
  publish(ctx: RouteContext<typeof byId>) {
    return this.posts.publish(ctx.input.params.id);
  }

  @Delete('/:id', { schema: byId })
  remove(ctx: RouteContext<typeof byId>) {
    return this.posts.remove(ctx.input.params.id);
  }
}
