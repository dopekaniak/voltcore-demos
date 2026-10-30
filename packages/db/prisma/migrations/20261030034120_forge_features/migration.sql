-- CreateTable
CREATE TABLE "forge_features" (
    "id" UUID NOT NULL,
    "asset_version_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "part" TEXT,
    "code_range" JSONB NOT NULL,
    "bbox_mm" JSONB,
    "params" TEXT[],
    "derived" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forge_features_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forge_features_asset_version_id_feature_key_key" ON "forge_features"("asset_version_id", "feature_key");

-- AddForeignKey
ALTER TABLE "forge_features" ADD CONSTRAINT "forge_features_asset_version_id_fkey" FOREIGN KEY ("asset_version_id") REFERENCES "asset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

