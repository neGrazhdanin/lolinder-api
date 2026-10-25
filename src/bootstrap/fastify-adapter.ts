import { FastifyAdapter } from '@nestjs/platform-fastify';
import { type Env, validateEnv } from '../config/env.js';

/** Fastify options are fixed at construction, before Nest DI and ConfigService exist. */
export function createFastifyAdapter(env: Env = validateEnv(process.env)): FastifyAdapter {
  return new FastifyAdapter({ trustProxy: env.TRUST_PROXY });
}
