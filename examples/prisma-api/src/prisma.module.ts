import { HttpError, Module, defineFactory } from '@avijs/core';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { Config } from './config.js';
import { Prisma, PrismaClient } from './generated/prisma/client.js';

/** One PrismaClient for the whole app: connected before the server starts, closed on shutdown. */
@Module({
  imports: [Config.module],
  providers: [
    defineFactory({
      provide: PrismaClient,
      inject: [Config],
      useFactory: async (config) => {
        const prisma = new PrismaClient({
          adapter: new PrismaLibSql({ url: config.DATABASE_URL }),
        });
        await prisma.$connect();
        return prisma;
      },
      dispose: (prisma) => prisma.$disconnect(),
    }),
  ],
  exports: [PrismaClient],
})
export class PrismaModule {}

/** Turns the Prisma errors a client can cause into HTTP errors. Anything else stays a 500. */
export function httpError(error: unknown, notFound: string): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;
  switch (error.code) {
    case 'P2025': // record to update or delete does not exist
    case 'P2003': // foreign key points nowhere
      return new HttpError(404, notFound, { cause: error });
    case 'P2002': // unique constraint
      return new HttpError(409, 'Already exists', { cause: error });
    default:
      return error;
  }
}
