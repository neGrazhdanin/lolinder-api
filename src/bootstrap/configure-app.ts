import helmet from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { errorResponseSchema } from '../common/errors/error-code.js';
import type { Env } from '../config/env.js';

export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.register(helmet);
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const documentConfig = new DocumentBuilder()
      .setTitle('lolinder API')
      .setVersion('0.1.0')
      .addGlobalResponse(
        { status: '4XX', description: 'Client error', standardSchema: errorResponseSchema },
        { status: '5XX', description: 'Server error', standardSchema: errorResponseSchema },
      )
      .build();
    SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, documentConfig));
  }
}
