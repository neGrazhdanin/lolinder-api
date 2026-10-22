import { Body, Controller, Get, Injectable, Post } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { ErrorCode } from '../src/common/errors/error-code.js';

@Injectable()
class ProbeService {
  greet(name: string): string {
    return `hi ${name}`;
  }
}

const greetSchema = z.object({ name: z.string().min(2) });

// Constructor injection without @Inject() proves decorator metadata survives the Vitest transform.
@Controller('probe')
class ProbeController {
  constructor(private readonly probe: ProbeService) {}

  @Post()
  greet(@Body({ schema: greetSchema }) body: z.infer<typeof greetSchema>): { text: string } {
    return { text: this.probe.greet(body.name) };
  }

  @Get('boom')
  boom(): never {
    throw new Error('unexpected');
  }
}

describe('app (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
      providers: [ProbeService],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('sets security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('resolves injected providers and validates the body', async () => {
    const res = await app.inject({ method: 'POST', url: '/probe', payload: { name: 'Faker' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ text: 'hi Faker' });
  });

  it('returns VALIDATION_FAILED with issue paths', async () => {
    const res = await app.inject({ method: 'POST', url: '/probe', payload: { name: 'F' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'name' }],
    });
  });

  it('returns BAD_REQUEST for malformed JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: { 'content-type': 'application/json' },
      payload: '{"name":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'BAD_REQUEST' });
  });

  it('returns NOT_FOUND for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'NOT_FOUND' });
  });

  it('hides internal errors behind INTERNAL_ERROR', async () => {
    const res = await app.inject({ method: 'GET', url: '/probe/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'INTERNAL_ERROR' });
  });

  it('documents ErrorResponse with the ErrorCode enum on every operation', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs-json' });
    expect(res.statusCode).toBe(200);

    const doc = res.json();
    expect(doc.components.schemas.ErrorCode.enum).toEqual(Object.values(ErrorCode));
    expect(doc.components.schemas.ErrorResponse.properties.code).toEqual({
      $ref: '#/components/schemas/ErrorCode',
    });

    const errorRef = { $ref: '#/components/schemas/ErrorResponse' };
    const health = doc.paths['/health'].get.responses;
    expect(health['4XX'].content['application/json'].schema).toEqual(errorRef);
    expect(health['5XX'].content['application/json'].schema).toEqual(errorRef);
  });
});
