/*
  Warnings:

  - Added the required column `champ_level` to the `match_participants` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "match_participants" ADD COLUMN     "champ_level" INTEGER NOT NULL,
ADD COLUMN     "game_name" TEXT,
ADD COLUMN     "placement" INTEGER,
ADD COLUMN     "subteam_id" INTEGER,
ADD COLUMN     "tag_line" TEXT;

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "remake" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "riot_accounts" ADD COLUMN     "match_history_complete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "match_history_from" TIMESTAMPTZ(3),
ADD COLUMN     "match_history_synced_at" TIMESTAMPTZ(3),
ADD COLUMN     "match_history_to" TIMESTAMPTZ(3);
