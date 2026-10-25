import { z } from 'zod';

export const envSchema = z
  .object({
    // Safe defaults: a forgotten variable must not expose Swagger or the LAN interface.
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    HOST: z.string().default('localhost'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    SWAGGER_ENABLED: z.stringbool().optional(),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    // Optional here because only the worker talks to Riot; RiotClient fails fast without it.
    RIOT_API_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().startsWith('RGAPI-').optional(),
    ),
    // Hop count or comma-separated proxy IPs/CIDRs. `true` is not accepted: it trusts a spoofed X-Forwarded-For.
    TRUST_PROXY: z
      .string()
      .regex(/^(\d+|[\w.:/]+(,[\w.:/]+)*)$/)
      .refine((value) => value !== 'true')
      .optional()
      .transform((value) => {
        if (value === undefined) {
          return false;
        }
        return /^\d+$/.test(value) ? Number(value) : value.split(',');
      }),
  })
  .transform((env) => ({
    ...env,
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
  }));

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
