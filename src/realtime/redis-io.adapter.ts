import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/** Fans socket.io broadcasts out through Redis, so every API instance and the worker's emitter reach every client. */
export class RedisIoAdapter extends IoAdapter {
  private readonly pubClient: Redis;
  private readonly subClient: Redis;

  constructor(
    app: INestApplicationContext,
    redisUrl: string,
    private readonly corsOrigins: string[],
  ) {
    super(app);
    // Subscriber connections cannot run other commands, so the shared client is not reused here.
    this.pubClient = new Redis(redisUrl);
    this.subClient = this.pubClient.duplicate();
    for (const client of [this.pubClient, this.subClient]) {
      client.on('error', (error: NodeJS.ErrnoException) =>
        this.logger.warn(`Redis connection error: ${error.code ?? error.message}`),
      );
    }
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    // socket.io types every ServerOptions field as required, though it fills in defaults.
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigins, credentials: true },
    } as ServerOptions);
    server.adapter(createAdapter(this.pubClient, this.subClient));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all([this.pubClient.quit(), this.subClient.quit()]);
  }
}
