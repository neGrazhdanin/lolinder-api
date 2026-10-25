import { Controller, Get, Header, HttpStatus, Param } from '@nestjs/common';
import { ApiOkResponse, ApiParam } from '@nestjs/swagger';
import { z } from 'zod';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import {
  dataDragonVersionSchema,
  STATIC_LOCALES,
  type StaticDataBundle,
  type StaticDataVersion,
  staticDataBundleSchema,
  staticDataVersionSchema,
  staticLocaleSchema,
} from './static-data.schemas.js';
import { StaticDataService } from './static-data.service.js';

const bundleParamsSchema = z.object({
  version: dataDragonVersionSchema,
  locale: staticLocaleSchema,
});

@Controller('static-data')
export class StaticDataController {
  constructor(private readonly staticData: StaticDataService) {}

  @Get('latest')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOkResponse({ standardSchema: staticDataVersionSchema })
  async latest(): Promise<StaticDataVersion> {
    const version = await this.staticData.latestVersion();
    if (version === null) {
      // The worker imports the first patch shortly after its first start.
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { version };
  }

  @Get(':version/:locale')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @ApiParam({ name: 'version', example: '16.21.1' })
  @ApiParam({ name: 'locale', enum: STATIC_LOCALES })
  @ApiOkResponse({ standardSchema: staticDataBundleSchema })
  async bundle(
    @Param({ schema: bundleParamsSchema }) params: z.infer<typeof bundleParamsSchema>,
  ): Promise<StaticDataBundle> {
    const bundle = await this.staticData.bundle(params.version, params.locale);
    if (bundle === null) {
      throw new AppException(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return bundle;
  }
}
