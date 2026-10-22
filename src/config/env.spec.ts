import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('applies defaults to an empty environment', () => {
    expect(validateEnv({})).toEqual({
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
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://lolinder.gg, https://www.lolinder.gg',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://lolinder.gg', 'https://www.lolinder.gg']);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('lets SWAGGER_ENABLED override the production default', () => {
    expect(validateEnv({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(
      true,
    );
  });

  it('rejects an invalid PORT', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });
});
