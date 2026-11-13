-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('NONE', 'REVIEW', 'PUBLISHED', 'REJECTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('VISIBLE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ReportTarget" AS ENUM ('MODEL', 'COMMENT', 'CREATOR');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "FileRole" ADD VALUE 'PHOTO';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "category" TEXT,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "download_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "like_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "needs_repair" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "print_notes" JSONB,
ADD COLUMN     "publish_status" "PublishStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "save_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "handle" CITEXT;

-- CreateTable
CREATE TABLE "asset_likes" (
    "user_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_likes_pkey" PRIMARY KEY ("user_id","asset_id")
);

-- CreateTable
CREATE TABLE "asset_saves" (
    "user_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_saves_pkey" PRIMARY KEY ("user_id","asset_id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_items" (
    "collection_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_items_pkey" PRIMARY KEY ("collection_id","asset_id")
);

-- CreateTable
CREATE TABLE "asset_comments" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'VISIBLE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_downloads" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "license_code" TEXT NOT NULL,
    "license_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_downloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follows" (
    "follower_id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("follower_id","creator_id")
);

-- CreateTable
CREATE TABLE "content_reports" (
    "id" UUID NOT NULL,
    "target_type" "ReportTarget" NOT NULL,
    "target_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "handled_by" UUID,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_likes_asset_id_idx" ON "asset_likes"("asset_id");

-- CreateIndex
CREATE INDEX "asset_saves_asset_id_idx" ON "asset_saves"("asset_id");

-- CreateIndex
CREATE INDEX "collections_owner_id_idx" ON "collections"("owner_id");

-- CreateIndex
CREATE INDEX "collection_items_collection_id_position_idx" ON "collection_items"("collection_id", "position");

-- CreateIndex
CREATE INDEX "asset_comments_asset_id_created_at_idx" ON "asset_comments"("asset_id", "created_at");

-- CreateIndex
CREATE INDEX "asset_downloads_asset_id_created_at_idx" ON "asset_downloads"("asset_id", "created_at");

-- CreateIndex
CREATE INDEX "asset_downloads_user_id_created_at_idx" ON "asset_downloads"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "follows_creator_id_idx" ON "follows"("creator_id");

-- CreateIndex
CREATE INDEX "content_reports_status_created_at_idx" ON "content_reports"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_reports_target_type_target_id_reporter_id_key" ON "content_reports"("target_type", "target_id", "reporter_id");

-- CreateIndex
CREATE INDEX "assets_description_trgm_idx" ON "assets" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "assets_tags_idx" ON "assets" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "assets_publish_status_visibility_published_at_idx" ON "assets"("publish_status", "visibility", "published_at");

-- CreateIndex
CREATE INDEX "assets_forked_from_id_idx" ON "assets"("forked_from_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_handle_key" ON "users"("handle");

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Counters never go negative.
ALTER TABLE "assets" ADD CONSTRAINT "assets_community_counts_nonneg" CHECK ("download_count" >= 0 AND "like_count" >= 0 AND "save_count" >= 0);
-- Collection positions are non-negative.
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_pos" CHECK ("position" >= 0);
