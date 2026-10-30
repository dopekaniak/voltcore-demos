-- CreateTable
CREATE TABLE "forge_check_runs" (
    "id" UUID NOT NULL,
    "asset_version_id" UUID NOT NULL,
    "profile_key" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "checks" JSONB NOT NULL,
    "estimates" JSONB NOT NULL,
    "slice" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forge_check_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forge_check_runs_asset_version_id_profile_key_key" ON "forge_check_runs"("asset_version_id", "profile_key");

