import { z } from 'zod';

// `KEY=` in .env yields an empty string; treat it like a missing variable.
const optional = <S extends z.ZodType>(schema: S) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

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
    RIOT_API_KEY: optional(z.string().startsWith('RGAPI-')),
    // Comma-separated proxy IPs/CIDRs (or proxy-addr names like `loopback`). `true` and hop counts
    // are not accepted: both let a client that reaches the app directly spoof X-Forwarded-For.
    // The output stays an array or undefined: ConfigModule writes primitives back into process.env
    // as strings, and main.ts parses process.env again.
    TRUST_PROXY: optional(
      z
        .string()
        .regex(/^[\w.:/]+(,[\w.:/]+)*$/)
        .refine((value) => !['true', 'false'].includes(value) && !/^\d+$/.test(value))
        .transform((value) => value.split(',')),
    ),
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
