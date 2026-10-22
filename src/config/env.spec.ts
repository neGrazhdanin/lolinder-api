import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const required = {
  DATABASE_URL: 'postgresql://localhost:5432/lolinder',
  REDIS_URL: 'redis://localhost:6380',
};

describe('validateEnv', () => {
  it('applies defaults when only required variables are set', () => {
    expect(validateEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: ['http://localhost:5173'],
      SWAGGER_ENABLED: true,
    });
  });

  it('splits CORS_ORIGINS and disables Swagger in production by default', () => {
    const env = validateEnv({
      ...required,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://lolinder.gg, https://www.lolinder.gg',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://lolinder.gg', 'https://www.lolinder.gg']);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('lets SWAGGER_ENABLED override the production default', () => {
    const env = validateEnv({ ...required, NODE_ENV: 'production', SWAGGER_ENABLED: 'true' });
    expect(env.SWAGGER_ENABLED).toBe(true);
  });

  it('rejects an invalid PORT', () => {
    expect(() => validateEnv({ ...required, PORT: 'abc' })).toThrow(/PORT/);
  });

  it.each(['DATABASE_URL', 'REDIS_URL'])('requires %s', (name) => {
    const { [name as keyof typeof required]: _, ...rest } = required;
    expect(() => validateEnv(rest)).toThrow(new RegExp(name));
  });

  it('rejects connection URLs with the wrong protocol', () => {
    expect(() => validateEnv({ ...required, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => validateEnv({ ...required, REDIS_URL: 'http://localhost:6380' })).toThrow(
      /REDIS_URL/,
    );
  });
});
