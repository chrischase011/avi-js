import { Injectable } from '@avijs/core';
import { PrismaClient } from '../generated/prisma/client.js';
import { httpError } from '../prisma.module.js';

export interface NewPost {
  authorId: number;
  title: string;
  content?: string | undefined;
}

@Injectable()
export class PostsService {
  static inject = [PrismaClient] as const;

  constructor(private readonly prisma: PrismaClient) {}

  list(published?: boolean) {
    return this.prisma.post.findMany({
      where: published === undefined ? {} : { published },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create({ authorId, title, content }: NewPost) {
    try {
      return await this.prisma.post.create({ data: { authorId, title, content: content ?? null } });
    } catch (error) {
      throw httpError(error, `User ${String(authorId)} not found`);
    }
  }

  async publish(id: number) {
    try {
      return await this.prisma.post.update({ where: { id }, data: { published: true } });
    } catch (error) {
      throw httpError(error, `Post ${String(id)} not found`);
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.post.delete({ where: { id } });
    } catch (error) {
      throw httpError(error, `Post ${String(id)} not found`);
    }
  }
}
