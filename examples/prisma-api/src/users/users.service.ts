import { HttpError, Injectable } from '@avijs/core';
import { PrismaClient } from '../generated/prisma/client.js';
import { httpError } from '../prisma.module.js';

@Injectable()
export class UsersService {
  static inject = [PrismaClient] as const;

  constructor(private readonly prisma: PrismaClient) {}

  list() {
    return this.prisma.user.findMany({ orderBy: { id: 'asc' } });
  }

  async get(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { posts: { orderBy: { createdAt: 'desc' } } },
    });
    if (!user) throw new HttpError(404, `User ${String(id)} not found`);
    return user;
  }

  async create(data: { email: string; name: string }) {
    try {
      return await this.prisma.user.create({ data });
    } catch (error) {
      throw httpError(error, 'User not found');
    }
  }
}
