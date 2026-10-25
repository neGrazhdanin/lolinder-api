import { setTimeout as sleep } from 'node:timers/promises';
import type { INestApplicationContext } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { createFastifyAdapter } from '../src/bootstrap/fastify-adapter.js';
import { CoreModule } from '../src/core/core.module.js';
import { InfraModule } from '../src/infra/infra.module.js';
import { RealtimeEmitter } from '../src/realtime/realtime.emitter.js';
import { RealtimeEvent } from '../src/realtime/realtime.events.js';
import { RealtimeEmitterModule } from '../src/realtime/realtime-emitter.module.js';

const puuid = (seed: string) => seed.padEnd(78, 'x');

describe('realtime (e2e)', () => {
  let app: NestFastifyApplication;
  let worker: INestApplicationContext;
  let url: string;
  const sockets: Socket[] = [];

  async function connect(): Promise<Socket> {
    const socket = io(url, { transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }

  function nextEvent<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve) => socket.once(event, resolve));
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await configureApp(app);
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();

    const workerRef = await Test.createTestingModule({
      imports: [CoreModule, InfraModule, RealtimeEmitterModule],
    }).compile();
    worker = await workerRef.init();
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  it('delivers player:updated from the worker to subscribers of that player only', async () => {
    const subscriber = await connect();
    const bystander = await connect();
    expect(
      await subscriber.emitWithAck(RealtimeEvent.SUBSCRIBE_PLAYER, { puuid: puuid('faker') }),
    ).toBe(true);
    await bystander.emitWithAck(RealtimeEvent.SUBSCRIBE_PLAYER, { puuid: puuid('chovy') });
    let bystanderGotEvent = false;
    bystander.on(RealtimeEvent.PLAYER_UPDATED, () => {
      bystanderGotEvent = true;
    });

    const received = nextEvent(subscriber, RealtimeEvent.PLAYER_UPDATED);
    worker.get(RealtimeEmitter).playerUpdated({ puuid: puuid('faker') });

    expect(await received).toEqual({ puuid: puuid('faker') });
    await sleep(100);
    expect(bystanderGotEvent).toBe(false);
  });

  it('stops delivering after unsubscribe', async () => {
    const socket = await connect();
    await socket.emitWithAck(RealtimeEvent.SUBSCRIBE_PLAYER, { puuid: puuid('faker') });
    await socket.emitWithAck(RealtimeEvent.UNSUBSCRIBE_PLAYER, { puuid: puuid('faker') });
    let gotEvent = false;
    socket.on(RealtimeEvent.PLAYER_UPDATED, () => {
      gotEvent = true;
    });

    worker.get(RealtimeEmitter).playerUpdated({ puuid: puuid('faker') });
    await sleep(100);
    expect(gotEvent).toBe(false);
  });

  it('answers an invalid subscription with the HTTP error contract', async () => {
    const socket = await connect();
    const exception = nextEvent(socket, 'exception');

    socket.emit(RealtimeEvent.SUBSCRIBE_PLAYER, { puuid: 'not-a-puuid' });

    expect(await exception).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'puuid' }],
    });
    expect(socket.connected).toBe(true);
  });

  it('caps how many players one socket follows', async () => {
    const socket = await connect();
    for (let i = 0; i < 20; i++) {
      await socket.emitWithAck(RealtimeEvent.SUBSCRIBE_PLAYER, { puuid: puuid(`p${i}`) });
    }
    const exception = nextEvent(socket, 'exception');

    socket.emit(RealtimeEvent.SUBSCRIBE_PLAYER, { puuid: puuid('one-too-many') });

    expect(await exception).toEqual({ code: 'BAD_REQUEST', details: { maxPlayerRooms: 20 } });
    expect(await socket.emitWithAck(RealtimeEvent.SUBSCRIBE_PLAYER, { puuid: puuid('p0') })).toBe(
      true,
    );
  });

  it('does not put socket messages through the shared HTTP throttler', async () => {
    const socket = await connect();
    const acks = await Promise.all(
      Array.from({ length: 105 }, () =>
        socket.emitWithAck(RealtimeEvent.UNSUBSCRIBE_PLAYER, { puuid: puuid('faker') }),
      ),
    );
    expect(acks.every((ack) => ack === true)).toBe(true);
  });
});
