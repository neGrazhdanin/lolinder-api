import { describe, expect, it } from 'vitest';
import { validateEnv } from '../config/env.js';
import { createFastifyAdapter } from './fastify-adapter.js';

const required = {
  DATABASE_URL: 'postgresql://localhost:5432/lolinder',
  REDIS_URL: 'redis://localhost:6380',
};

async function clientIp(trustProxy?: string): Promise<string> {
  const fastify = createFastifyAdapter(
    validateEnv({ ...required, TRUST_PROXY: trustProxy }),
  ).getInstance();
  fastify.get('/ip', async (request) => ({ ip: request.ip }));
  const res = await fastify.inject({
    method: 'GET',
    url: '/ip',
    headers: { 'x-forwarded-for': '203.0.113.7' },
  });
  await fastify.close();
  return res.json().ip;
}

describe('createFastifyAdapter', () => {
  it('ignores X-Forwarded-For without TRUST_PROXY', async () => {
    expect(await clientIp()).toBe('127.0.0.1');
  });

  it('takes the client IP from X-Forwarded-For sent by a trusted proxy', async () => {
    expect(await clientIp('127.0.0.1')).toBe('203.0.113.7');
  });

  it('ignores X-Forwarded-For from a proxy outside TRUST_PROXY', async () => {
    expect(await clientIp('10.0.0.0/8')).toBe('127.0.0.1');
  });
});
