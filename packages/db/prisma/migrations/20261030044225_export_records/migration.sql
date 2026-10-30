-- CreateTable
CREATE TABLE "export_records" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "asset_version_id" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "plan_code_at_export" TEXT NOT NULL,
    "license_snapshot" JSONB NOT NULL,
    "is_test_section" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'server',
    "job_id" UUID,
    "file_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "export_records_job_id_key" ON "export_records"("job_id");

-- CreateIndex
CREATE INDEX "export_records_asset_version_id_created_at_idx" ON "export_records"("asset_version_id", "created_at");

-- CreateIndex
CREATE INDEX "export_records_owner_id_created_at_idx" ON "export_records"("owner_id", "created_at");

