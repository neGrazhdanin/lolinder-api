-- CreateEnum
CREATE TYPE "ranked_queue" AS ENUM ('solo', 'flex');

-- CreateEnum
CREATE TYPE "tier" AS ENUM ('iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger');

-- CreateEnum
CREATE TYPE "division" AS ENUM ('I', 'II', 'III', 'IV');

-- CreateEnum
CREATE TYPE "static_data_kind" AS ENUM ('champions', 'items', 'runes', 'summoner_spells');

-- CreateTable
CREATE TABLE "riot_accounts" (
    "puuid" VARCHAR(78) NOT NULL,
    "game_name" TEXT NOT NULL,
    "tag_line" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "profile_icon_id" INTEGER,
    "summoner_level" INTEGER,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "riot_accounts_pkey" PRIMARY KEY ("puuid")
);

-- CreateTable
CREATE TABLE "rank_snapshots" (
    "id" SERIAL NOT NULL,
    "puuid" VARCHAR(78) NOT NULL,
    "queue" "ranked_queue" NOT NULL,
    "tier" "tier" NOT NULL,
    "division" "division" NOT NULL,
    "league_points" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "taken_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rank_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "match_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "queue_id" INTEGER NOT NULL,
    "game_version" TEXT NOT NULL,
    "patch" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_sec" INTEGER NOT NULL,
    "winner_team" INTEGER,
    "raw_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("match_id")
);

-- CreateTable
CREATE TABLE "match_participants" (
    "match_id" TEXT NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "puuid" VARCHAR(78) NOT NULL,
    "queue_id" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "team_id" INTEGER NOT NULL,
    "champion_id" INTEGER NOT NULL,
    "role" TEXT,
    "kills" INTEGER NOT NULL,
    "deaths" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "damage_to_champions" INTEGER NOT NULL,
    "gold_earned" INTEGER NOT NULL,
    "cs" INTEGER NOT NULL,
    "vision_score" INTEGER NOT NULL,
    "items" INTEGER[],
    "summoner_spells" INTEGER[],
    "runes" JSONB NOT NULL,
    "win" BOOLEAN NOT NULL,

    CONSTRAINT "match_participants_pkey" PRIMARY KEY ("match_id","participant_id")
);

-- CreateTable
CREATE TABLE "match_timelines" (
    "match_id" TEXT NOT NULL,
    "frames" JSONB NOT NULL,
    "events" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_timelines_pkey" PRIMARY KEY ("match_id")
);

-- CreateTable
CREATE TABLE "static_data" (
    "patch" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "kind" "static_data_kind" NOT NULL,
    "data" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "static_data_pkey" PRIMARY KEY ("patch","locale","kind")
);

-- CreateIndex
CREATE INDEX "riot_accounts_game_name_tag_line_idx" ON "riot_accounts"("game_name", "tag_line");

-- CreateIndex
CREATE INDEX "rank_snapshots_puuid_queue_taken_at_idx" ON "rank_snapshots"("puuid", "queue", "taken_at" DESC);

-- CreateIndex
CREATE INDEX "match_participants_puuid_started_at_idx" ON "match_participants"("puuid", "started_at" DESC);

-- CreateIndex
CREATE INDEX "match_participants_puuid_queue_id_started_at_idx" ON "match_participants"("puuid", "queue_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "rank_snapshots" ADD CONSTRAINT "rank_snapshots_puuid_fkey" FOREIGN KEY ("puuid") REFERENCES "riot_accounts"("puuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("match_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_timelines" ADD CONSTRAINT "match_timelines_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("match_id") ON DELETE CASCADE ON UPDATE CASCADE;
