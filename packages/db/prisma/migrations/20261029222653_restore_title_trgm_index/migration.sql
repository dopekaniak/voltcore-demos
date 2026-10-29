-- CreateIndex
CREATE INDEX "assets_title_trgm_idx" ON "assets" USING GIN ("title" gin_trgm_ops);

