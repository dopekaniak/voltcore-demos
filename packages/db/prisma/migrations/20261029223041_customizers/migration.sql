-- CreateEnum
CREATE TYPE "CustomizerStatus" AS ENUM ('DRAFT', 'REVIEW', 'LIVE', 'REMOVED');

-- CreateTable
CREATE TABLE "customizers" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "author_id" UUID,
    "license_id" UUID,
    "template_key" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "input_rules" JSONB NOT NULL,
    "image_input" JSONB,
    "price_policy" JSONB NOT NULL,
    "print_defaults" JSONB NOT NULL,
    "status" "CustomizerStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customizers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customizer_exports" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "customizer_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "free" BOOLEAN NOT NULL,
    "plan_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customizer_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customizers_key_key" ON "customizers"("key");

-- CreateIndex
CREATE UNIQUE INDEX "customizer_exports_job_id_key" ON "customizer_exports"("job_id");

-- CreateIndex
CREATE INDEX "customizer_exports_user_id_created_at_idx" ON "customizer_exports"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "customizer_exports" ADD CONSTRAINT "customizer_exports_customizer_id_fkey" FOREIGN KEY ("customizer_id") REFERENCES "customizers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

