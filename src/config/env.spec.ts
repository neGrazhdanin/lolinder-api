import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const RIOT_KEY = 'RGAPI-test'; // secrets-scan:allow

const required = {
  DATABASE_URL: 'postgresql://localhost:5432/lolinder',
  REDIS_URL: 'redis://localhost:6380',
};

describe('validateEnv', () => {
  it('applies safe defaults when only required variables are set', () => {
    expect(validateEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'production',
      HOST: 'localhost',
      PORT: 3000,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: ['http://localhost:5173'],
      SWAGGER_ENABLED: false,
      TRUST_PROXY: false,
    });
  });

  it('enables Swagger outside production by default', () => {
    expect(validateEnv({ ...required, NODE_ENV: 'development' }).SWAGGER_ENABLED).toBe(true);
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

  it('accepts only Riot-issued API keys', () => {
    expect(validateEnv({ ...required, RIOT_API_KEY: RIOT_KEY }).RIOT_API_KEY).toBe(RIOT_KEY);
    expect(() => validateEnv({ ...required, RIOT_API_KEY: 'test' })).toThrow(/RIOT_API_KEY/);
  });

  it('treats an empty RIOT_API_KEY as unset', () => {
    expect(validateEnv({ ...required, RIOT_API_KEY: '' }).RIOT_API_KEY).toBeUndefined();
  });

  it.each([
    ['1', 1],
    ['10.0.0.0/8', ['10.0.0.0/8']],
    ['127.0.0.1,10.0.0.0/8', ['127.0.0.1', '10.0.0.0/8']],
  ])('parses TRUST_PROXY=%s', (value, expected) => {
    expect(validateEnv({ ...required, TRUST_PROXY: value }).TRUST_PROXY).toEqual(expected);
  });

  it.each(['true', '10.0.0.1, 10.0.0.2'])('rejects TRUST_PROXY=%s', (value) => {
    expect(() => validateEnv({ ...required, TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
  });
});
