-- DropIndex
DROP INDEX "match_participants_puuid_queue_id_started_at_idx";

-- DropIndex
DROP INDEX "match_participants_puuid_started_at_idx";

-- DropIndex
DROP INDEX "riot_accounts_game_name_tag_line_idx";

-- AlterTable: backfill before NOT NULL so the migration also applies to a non-empty table
ALTER TABLE "riot_accounts" ADD COLUMN "riot_id_key" TEXT;
UPDATE "riot_accounts" SET "riot_id_key" = lower("game_name" || '#' || "tag_line");
ALTER TABLE "riot_accounts" ALTER COLUMN "riot_id_key" SET NOT NULL;

-- CreateIndex
CREATE INDEX "match_participants_puuid_started_at_match_id_idx" ON "match_participants"("puuid", "started_at" DESC, "match_id" DESC);

-- CreateIndex
CREATE INDEX "match_participants_puuid_queue_id_started_at_match_id_idx" ON "match_participants"("puuid", "queue_id", "started_at" DESC, "match_id" DESC);

-- CreateIndex
CREATE INDEX "riot_accounts_riot_id_key_idx" ON "riot_accounts"("riot_id_key");

-- Write-once, read-often payloads: lz4 decompresses several times faster than the default pglz.
-- Prisma does not model column compression, so it lives only in this migration.
ALTER TABLE "matches" ALTER COLUMN "raw_json" SET COMPRESSION lz4;
ALTER TABLE "match_timelines" ALTER COLUMN "frames" SET COMPRESSION lz4;
ALTER TABLE "match_timelines" ALTER COLUMN "events" SET COMPRESSION lz4;
