-- CreateEnum
CREATE TYPE "SafetyClass" AS ENUM ('NONE', 'COSMETIC', 'ENCLOSURE', 'SAFETY_CRITICAL');

-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('DRAFT', 'REVIEW', 'LIVE', 'PAUSED', 'REMOVED', 'REJECTED');

-- DropIndex
DROP INDEX "assets_title_trgm_idx";

-- AlterTable
ALTER TABLE "print_parts" ADD COLUMN     "catalog_part_id" UUID,
ADD COLUMN     "fit_acknowledged_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "license_terms" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "attribution_template" TEXT NOT NULL,
    "allows_commercial" BOOLEAN NOT NULL,
    "allows_derivatives" BOOLEAN NOT NULL,
    "allows_print_order" BOOLEAN NOT NULL,
    "personal_print_only" BOOLEAN NOT NULL DEFAULT false,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "owner_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_licenses" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "license_id" UUID NOT NULL,
    "attribution_text" TEXT NOT NULL,
    "source_url" TEXT,
    "verified_by" UUID,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "asset_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "part_number_text" TEXT,
    "category" TEXT NOT NULL,
    "safety_class" "SafetyClass" NOT NULL DEFAULT 'NONE',
    "license_id" UUID,
    "status" "CatalogStatus" NOT NULL DEFAULT 'DRAFT',
    "print_order_allowed" BOOLEAN NOT NULL DEFAULT false,
    "allowed_materials" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "license_terms_code_key" ON "license_terms"("code");

-- CreateIndex
CREATE UNIQUE INDEX "model_licenses_asset_id_key" ON "model_licenses"("asset_id");

-- CreateIndex
CREATE INDEX "parts_status_category_idx" ON "parts"("status", "category");

-- AddForeignKey
ALTER TABLE "model_licenses" ADD CONSTRAINT "model_licenses_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "license_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

