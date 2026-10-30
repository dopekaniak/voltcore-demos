-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "printer_bed_mm" JSONB,
ADD COLUMN     "printer_profile_id" UUID;

-- AlterTable
ALTER TABLE "forge_sources" ADD COLUMN     "dimensions" JSONB;

-- AlterTable
ALTER TABLE "uploads" ADD COLUMN     "image_height" INTEGER,
ADD COLUMN     "image_width" INTEGER;

-- CreateTable
CREATE TABLE "printer_profiles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bed_mm" JSONB NOT NULL,
    "nozzle_mm" DOUBLE PRECISION NOT NULL,
    "validated_materials" TEXT[],
    "overhang_default_deg" DOUBLE PRECISION NOT NULL,
    "wall_min_mm" DOUBLE PRECISION NOT NULL,
    "source_url" TEXT,
    "retrieved_on" DATE,
    "is_generic" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "printer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calibrations" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "photo_upload_id" UUID NOT NULL,
    "line_px" JSONB NOT NULL,
    "real_length_mm" DOUBLE PRECISION NOT NULL,
    "mm_per_px" DOUBLE PRECISION NOT NULL,
    "image_width" INTEGER NOT NULL,
    "image_height" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'USER_MEASURED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calibrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "printer_profiles_key_key" ON "printer_profiles"("key");

-- CreateIndex
CREATE INDEX "calibrations_owner_id_created_at_idx" ON "calibrations"("owner_id", "created_at");

