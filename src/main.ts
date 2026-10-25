import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap/configure-app.js';
import { type Env, validateEnv } from './config/env.js';

// AppModule's ConfigModule has loaded .env into process.env by now; the adapter is built before DI exists.
const { TRUST_PROXY } = validateEnv(process.env);
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({
    // Fastify accepts a hop count at runtime, but its types only allow the equivalent function.
    trustProxy:
      typeof TRUST_PROXY === 'number' ? (_address, hop) => hop < TRUST_PROXY : TRUST_PROXY,
  }),
  { bufferLogs: true },
);
await configureApp(app);

const config = app.get<ConfigService<Env, true>>(ConfigService);
await app.listen(config.get('PORT', { infer: true }), config.get('HOST', { infer: true }));
