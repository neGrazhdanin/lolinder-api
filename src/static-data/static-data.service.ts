import { Injectable } from '@nestjs/common';
import { StaticDataKind } from '../generated/prisma/enums.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { IMPORTED_KINDS, KIND_OF_SET } from './static-data.constants.js';
import {
  type StaticDataBundle,
  type StaticDataDescriptions,
  type StaticDataImport,
  type StaticLocale,
  staticDataDescriptionsSchema,
  staticDataSetsSchema,
} from './static-data.schemas.js';

@Injectable()
export class StaticDataService {
  constructor(private readonly prisma: PrismaService) {}

  /** Each version is imported in one transaction, so the newest row always belongs to a complete set. */
  async latestVersion(): Promise<string | null> {
    const newest = await this.prisma.staticData.findFirst({
      orderBy: { fetchedAt: 'desc' },
      select: { patch: true },
    });
    return newest?.patch ?? null;
  }

  async bundle(version: string, locale: StaticLocale): Promise<StaticDataBundle | null> {
    const rows = await this.prisma.staticData.findMany({
      where: { patch: version, locale, kind: { in: Object.values(KIND_OF_SET) } },
    });
    if (rows.length === 0) {
      return null;
    }
    const sets = Object.fromEntries(
      Object.entries(KIND_OF_SET).map(([set, kind]) => [
        set,
        rows.find((row) => row.kind === kind)?.data,
      ]),
    );
    return { version, locale, ...staticDataSetsSchema.parse(sets) };
  }

  async descriptions(
    version: string,
    locale: StaticLocale,
  ): Promise<StaticDataDescriptions | null> {
    const row = await this.prisma.staticData.findUnique({
      where: { patch_locale_kind: { patch: version, locale, kind: StaticDataKind.DESCRIPTIONS } },
    });
    return row ? staticDataDescriptionsSchema.parse(row.data) : null;
  }

  /** A patch imported before a kind existed counts as missing, so the next sync completes it. */
  async hasVersion(version: string): Promise<boolean> {
    const kinds = await this.prisma.staticData.groupBy({
      by: ['kind'],
      where: { patch: version },
    });
    return IMPORTED_KINDS.every((kind) => kinds.some((row) => row.kind === kind));
  }

  async saveVersion(version: string, importsByLocale: Record<StaticLocale, StaticDataImport>) {
    const rows = Object.entries(importsByLocale).flatMap(([locale, { sets, descriptions }]) => [
      ...Object.entries(KIND_OF_SET).map(([set, kind]) => ({
        patch: version,
        locale,
        kind,
        data: sets[set as keyof typeof sets],
      })),
      { patch: version, locale, kind: StaticDataKind.DESCRIPTIONS, data: descriptions },
    ]);
    await this.prisma.$transaction([
      this.prisma.staticData.deleteMany({ where: { patch: version } }),
      this.prisma.staticData.createMany({ data: rows }),
    ]);
  }
}
