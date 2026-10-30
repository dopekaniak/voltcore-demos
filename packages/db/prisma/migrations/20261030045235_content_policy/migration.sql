-- CreateEnum
CREATE TYPE "ModerationCaseStatus" AS ENUM ('OPEN', 'UPHELD', 'RELEASED');

-- AlterEnum
ALTER TYPE "UploadStatus" ADD VALUE 'FLAGGED';

-- CreateTable
CREATE TABLE "content_refusals" (
    "id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "user_hash" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_refusals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_cases" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "owner_id" UUID,
    "reason" TEXT NOT NULL,
    "details" JSONB,
    "status" "ModerationCaseStatus" NOT NULL DEFAULT 'OPEN',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_refusals_created_at_idx" ON "content_refusals"("created_at");

-- CreateIndex
CREATE INDEX "moderation_cases_status_created_at_idx" ON "moderation_cases"("status", "created_at");

