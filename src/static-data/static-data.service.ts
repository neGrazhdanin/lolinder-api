import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { KIND_OF_SET } from './static-data.constants.js';
import {
  type StaticDataBundle,
  type StaticDataSets,
  type StaticLocale,
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
    const rows = await this.prisma.staticData.findMany({ where: { patch: version, locale } });
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

  async hasVersion(version: string): Promise<boolean> {
    return (await this.prisma.staticData.count({ where: { patch: version } })) > 0;
  }

  async saveVersion(version: string, setsByLocale: Record<StaticLocale, StaticDataSets>) {
    const rows = Object.entries(setsByLocale).flatMap(([locale, sets]) =>
      Object.entries(KIND_OF_SET).map(([set, kind]) => ({
        patch: version,
        locale,
        kind,
        data: sets[set as keyof StaticDataSets],
      })),
    );
    await this.prisma.$transaction([
      this.prisma.staticData.deleteMany({ where: { patch: version } }),
      this.prisma.staticData.createMany({ data: rows }),
    ]);
  }
}
