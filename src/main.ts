import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap/configure-app.js';
import { createFastifyAdapter } from './bootstrap/fastify-adapter.js';
import type { Env } from './config/env.js';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, createFastifyAdapter(), {
  bufferLogs: true,
});
await configureApp(app);

const config = app.get<ConfigService<Env, true>>(ConfigService);
await app.listen(config.get('PORT', { infer: true }), config.get('HOST', { infer: true }));
