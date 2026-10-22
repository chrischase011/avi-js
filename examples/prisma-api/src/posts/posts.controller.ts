import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  reply,
  type Context,
  type InputOf,
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

@Controller('/posts')
export class PostsController {
  static inject = [PostsService] as const;

  constructor(private readonly posts: PostsService) {}

  @Get('/', { schema: { query: ListPosts } })
  list(ctx: Context<InputOf<{ query: typeof ListPosts }>>) {
    return this.posts.list(ctx.input.query.published);
  }

  @Post('/', { schema: { body: CreatePost } })
  async create(ctx: Context<InputOf<{ body: typeof CreatePost }>>) {
    return reply(await this.posts.create(ctx.input.body), { status: 201 });
  }

  @Patch('/:id/publish', { schema: { params: Id } })
  publish(ctx: Context<InputOf<{ params: typeof Id }>>) {
    return this.posts.publish(ctx.input.params.id);
  }

  @Delete('/:id', { schema: { params: Id } })
  remove(ctx: Context<InputOf<{ params: typeof Id }>>) {
    return this.posts.remove(ctx.input.params.id);
  }
}
