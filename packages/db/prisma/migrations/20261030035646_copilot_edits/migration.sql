-- CreateEnum
CREATE TYPE "CopilotEditStatus" AS ENUM ('PROPOSING', 'PROPOSED', 'ACCEPTED', 'REJECTED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "copilot_edits" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "asset_version_id" UUID NOT NULL,
    "user_message" TEXT NOT NULL,
    "target_feature_key" TEXT,
    "status" "CopilotEditStatus" NOT NULL DEFAULT 'PROPOSING',
    "proposed_code" TEXT,
    "proposed_params" JSONB,
    "proposed_schema" JSONB,
    "diff" JSONB,
    "preview" JSONB,
    "notes" TEXT[],
    "error" TEXT,
    "credits_reserved" INTEGER NOT NULL,
    "reservation_id" UUID,
    "job_id" UUID,
    "accept_job_id" UUID,
    "result_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "copilot_edits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "copilot_edits_reservation_id_key" ON "copilot_edits"("reservation_id");

-- CreateIndex
CREATE INDEX "copilot_edits_asset_version_id_created_at_idx" ON "copilot_edits"("asset_version_id", "created_at");

-- AddForeignKey
ALTER TABLE "copilot_edits" ADD CONSTRAINT "copilot_edits_asset_version_id_fkey" FOREIGN KEY ("asset_version_id") REFERENCES "asset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

