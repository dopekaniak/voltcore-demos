-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN', 'OPS');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "WebhookEndpointStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('GRANT', 'PURCHASE', 'RESERVE', 'COMMIT', 'RELEASE', 'EXPIRE', 'ADJUST', 'REFUND');

-- CreateEnum
CREATE TYPE "GrantSource" AS ENUM ('PLAN', 'PACK', 'ADMIN', 'SIGNUP');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('ORDER', 'CREDIT_PACK', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('GENERATED', 'FORGE', 'UPLOAD', 'PRINT_PART');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PRIVATE', 'UNLISTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "VersionStage" AS ENUM ('PREVIEW', 'REFINED', 'RETEXTURED', 'REMESHED', 'REPAIRED', 'FORGE', 'UPLOAD');

-- CreateEnum
CREATE TYPE "FileRole" AS ENUM ('SOURCE', 'PREVIEW_MESH', 'GLB', 'STL', 'THREEMF', 'STEP', 'OBJ', 'THUMBNAIL', 'TEXTURE', 'REPAIRED');

-- CreateEnum
CREATE TYPE "ForgeBuildState" AS ENUM ('DRAFT', 'AUTHORING', 'STATIC_CHECK', 'BUILDING', 'VERIFYING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('GENERATE', 'REFINE', 'RETEXTURE', 'REMESH', 'FORGE_BUILD', 'FORGE_EXPORT', 'MESH_ANALYZE', 'PRINT_QUOTE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'RETRYING', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "UploadPurpose" AS ENUM ('PRINT', 'IMAGE');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'UPLOADED', 'SCANNING', 'CLEAN', 'REJECTED');

-- CreateEnum
CREATE TYPE "PrintPartStatus" AS ENUM ('UPLOADED', 'SCANNING', 'ANALYZING', 'NEEDS_REPAIR', 'REPAIRING', 'READY', 'REJECTED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUPERSEDED', 'ORDERED');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('UPLOAD', 'LISTING');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'PAID', 'IN_PRODUCTION', 'ON_HOLD', 'SHIPPED', 'DELIVERED', 'EXPIRED', 'CANCELED', 'REFUNDING', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('QUEUED_FOR_PRINT', 'ROUTED', 'PRINTING', 'QC', 'PASSED', 'REWORK', 'ESCALATED', 'SHIPPED');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "PrinterStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'OFFLINE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "terms_version" TEXT,
    "terms_accepted_at" TIMESTAMP(3),
    "totp_secret_enc" TEXT,
    "totp_enabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "totp_verified_at" TIMESTAMP(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magic_links" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "anon_id" TEXT,
    "redirect_to" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "events" TEXT[],
    "status" "WebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "response_status" INTEGER,
    "next_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_wallets" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "reserved_delta" INTEGER NOT NULL DEFAULT 0,
    "balance_after" INTEGER NOT NULL,
    "reserved_after" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "reservation_id" UUID,
    "job_id" UUID,
    "grant_id" UUID,
    "reason" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_grants" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "source" "GrantSource" NOT NULL,
    "amount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3),
    "source_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "committed_amount" INTEGER,
    "status" "ReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "job_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_credits" INTEGER NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "api_rate_limit_per_min" INTEGER NOT NULL,
    "stripe_price_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "stripe_subscription_id" TEXT,
    "stripe_customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_packs" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "stripe_price_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "credit_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "refunded_minor" INTEGER NOT NULL DEFAULT 0,
    "stripe_session_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "stripe_invoice_id" TEXT,
    "order_id" UUID,
    "credit_pack_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "order_id" UUID,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "needs_second_approval" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" TEXT NOT NULL,
    "stripe_refund_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "license" TEXT NOT NULL DEFAULT 'ALL-RIGHTS-RESERVED',
    "current_version_id" UUID,
    "forked_from_id" UUID,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_versions" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "stage" "VersionStage" NOT NULL,
    "provider" TEXT,
    "model_code" TEXT,
    "parent_version_id" UUID,
    "job_id" UUID,
    "triangles" INTEGER,
    "bbox_mm" JSONB,
    "is_watertight" BOOLEAN,
    "analysis" JSONB,
    "params" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_files" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "asset_version_id" UUID,
    "role" "FileRole" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sha256" TEXT,
    "bytes" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forge_sources" (
    "id" UUID NOT NULL,
    "asset_version_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "defaults" JSONB NOT NULL,
    "author" TEXT NOT NULL,
    "author_version" TEXT NOT NULL,
    "template_key" TEXT,
    "dfm_profile" TEXT NOT NULL,
    "checks" JSONB,
    "build_state" "ForgeBuildState" NOT NULL DEFAULT 'DRAFT',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "anon_id" TEXT,
    "kind" "JobKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "forge_state" "ForgeBuildState",
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "parent_job_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "provider_key" TEXT,
    "provider_task_id" TEXT,
    "model_code" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "asset_id" UUID,
    "asset_version_id" UUID,
    "error_code" TEXT,
    "error_message" TEXT,
    "reserved_credits" INTEGER NOT NULL DEFAULT 0,
    "committed_credits" INTEGER NOT NULL DEFAULT 0,
    "reservation_id" UUID,
    "locked_by" TEXT,
    "locked_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "timeout_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_events" (
    "seq" BIGSERIAL NOT NULL,
    "job_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" "JobStatus",
    "to_status" "JobStatus",
    "progress" INTEGER,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" BIGSERIAL NOT NULL,
    "topic" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colors" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "anon_id" TEXT,
    "purpose" "UploadPurpose" NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "reject_reason" TEXT,
    "sha256" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_parts" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "anon_id" TEXT,
    "title" TEXT NOT NULL,
    "status" "PrintPartStatus" NOT NULL DEFAULT 'UPLOADED',
    "upload_id" UUID,
    "asset_version_id" UUID,
    "forge_version_id" UUID,
    "source_file_id" UUID,
    "repaired_file_id" UUID,
    "use_repaired" BOOLEAN NOT NULL DEFAULT false,
    "validation_report" JSONB,
    "repair_report" JSONB,
    "analysis" JSONB,
    "settings" JSONB NOT NULL,
    "checks_failing" BOOLEAN NOT NULL DEFAULT false,
    "checks_acknowledged_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "anon_id" TEXT,
    "print_part_id" UUID NOT NULL,
    "inputs_hash" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "subtotal_minor" INTEGER NOT NULL,
    "shipping_minor" INTEGER NOT NULL,
    "tax_minor" INTEGER NOT NULL,
    "total_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "pricing_version" INTEGER NOT NULL,
    "is_estimate" BOOLEAN NOT NULL,
    "lead_time_days" INTEGER NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotency_key" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "print_part_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "source" "OrderSource" NOT NULL DEFAULT 'UPLOAD',
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal_minor" INTEGER NOT NULL,
    "shipping_minor" INTEGER NOT NULL,
    "tax_minor" INTEGER NOT NULL,
    "total_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "shipping_method" TEXT NOT NULL,
    "address" JSONB NOT NULL,
    "terms_version" TEXT NOT NULL,
    "is_estimate" BOOLEAN NOT NULL DEFAULT false,
    "stripe_session_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3),
    "routed_at" TIMESTAMP(3),
    "problem_report" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "print_part_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_minor" INTEGER NOT NULL,
    "line_total_minor" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'QUEUED_FOR_PRINT',
    "rework_count" INTEGER NOT NULL DEFAULT 0,
    "partner_printer_id" UUID,
    "partner_item_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "seq" BIGSERIAL NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID,
    "type" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "data" JSONB,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "carrier" TEXT NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_partners" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_mock" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "print_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_printers" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "materials" TEXT[],
    "bed_mm" JSONB NOT NULL,
    "queue_minutes" INTEGER NOT NULL DEFAULT 0,
    "status" "PrinterStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "partner_printers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "seq" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT,
    "data" JSONB,
    "ip" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "provider_events_raw" (
    "id" UUID NOT NULL,
    "provider_key" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "provider_events_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events_raw" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "stripe_events_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_configs" (
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_configs_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "generation_models" (
    "code" TEXT NOT NULL,
    "provider_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "costs" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "generation_models_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "magic_links_token_hash_key" ON "magic_links"("token_hash");

-- CreateIndex
CREATE INDEX "magic_links_email_idx" ON "magic_links"("email");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_owner_id_idx" ON "api_keys"("owner_id");

-- CreateIndex
CREATE INDEX "webhook_endpoints_owner_id_idx" ON "webhook_endpoints"("owner_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpoint_id_idx" ON "webhook_deliveries"("endpoint_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_wallets_owner_id_key" ON "credit_wallets"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_idempotency_key_key" ON "credit_ledger"("idempotency_key");

-- CreateIndex
CREATE INDEX "credit_ledger_wallet_id_created_at_idx" ON "credit_ledger"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_grants_wallet_id_expires_at_idx" ON "credit_grants"("wallet_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_grants_wallet_id_source_source_ref_key" ON "credit_grants"("wallet_id", "source", "source_ref");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_job_id_key" ON "reservations"("job_id");

-- CreateIndex
CREATE INDEX "reservations_status_expires_at_idx" ON "reservations"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_owner_id_idx" ON "subscriptions"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_packs_code_key" ON "credit_packs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_session_id_key" ON "payments"("stripe_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_payment_intent_id_key" ON "payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_invoice_id_key" ON "payments"("stripe_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_owner_id_idx" ON "payments"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_stripe_refund_id_key" ON "refunds"("stripe_refund_id");

-- CreateIndex
CREATE INDEX "assets_owner_id_kind_created_at_idx" ON "assets"("owner_id", "kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "asset_versions_asset_id_number_key" ON "asset_versions"("asset_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "asset_files_storage_key_key" ON "asset_files"("storage_key");

-- CreateIndex
CREATE INDEX "asset_files_asset_version_id_idx" ON "asset_files"("asset_version_id");

-- CreateIndex
CREATE INDEX "asset_files_expires_at_idx" ON "asset_files"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "forge_sources_asset_version_id_key" ON "forge_sources"("asset_version_id");

-- CreateIndex
CREATE INDEX "jobs_provider_key_provider_task_id_idx" ON "jobs"("provider_key", "provider_task_id");

-- CreateIndex
CREATE INDEX "jobs_owner_id_created_at_idx" ON "jobs"("owner_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_owner_id_idempotency_key_key" ON "jobs"("owner_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_anon_id_idempotency_key_key" ON "jobs"("anon_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "job_events_job_id_seq_idx" ON "job_events"("job_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_messages_topic_key_key" ON "outbox_messages"("topic", "key");

-- CreateIndex
CREATE UNIQUE INDEX "materials_code_key" ON "materials"("code");

-- CreateIndex
CREATE UNIQUE INDEX "uploads_storage_key_key" ON "uploads"("storage_key");

-- CreateIndex
CREATE INDEX "print_parts_anon_id_idx" ON "print_parts"("anon_id");

-- CreateIndex
CREATE INDEX "quotes_print_part_id_created_at_idx" ON "quotes"("print_part_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "carts_owner_id_key" ON "carts"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_print_part_id_key" ON "cart_items"("cart_id", "print_part_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_stripe_session_id_key" ON "orders"("stripe_session_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_owner_id_idempotency_key_key" ON "orders"("owner_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "order_events_order_id_seq_idx" ON "order_events"("order_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_tracking_number_key" ON "shipments"("tracking_number");

-- CreateIndex
CREATE UNIQUE INDEX "print_partners_code_key" ON "print_partners"("code");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_events_raw_provider_key_event_key_key" ON "provider_events_raw"("provider_key", "event_key");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "credit_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "credit_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "credit_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_files" ADD CONSTRAINT "asset_files_asset_version_id_fkey" FOREIGN KEY ("asset_version_id") REFERENCES "asset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forge_sources" ADD CONSTRAINT "forge_sources_asset_version_id_fkey" FOREIGN KEY ("asset_version_id") REFERENCES "asset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_parent_job_id_fkey" FOREIGN KEY ("parent_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_parts" ADD CONSTRAINT "print_parts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_print_part_id_fkey" FOREIGN KEY ("print_part_id") REFERENCES "print_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_printers" ADD CONSTRAINT "partner_printers_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "print_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Constraints Prisma cannot express (hand-written) ─────────────

-- Wallet invariants (ADR-005)
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_reserved_nonneg" CHECK ("reserved" >= 0);
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_balance_covers_reserved" CHECK ("balance" >= "reserved");
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_remaining_range" CHECK ("remaining" >= 0 AND "remaining" <= "amount");
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_amount_nonneg" CHECK ("amount" >= 0 AND ("committed_amount" IS NULL OR ("committed_amount" >= 0 AND "committed_amount" <= "amount")));

-- Money columns are non-negative
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_money_nonneg" CHECK ("subtotal_minor" >= 0 AND "shipping_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_money_nonneg" CHECK ("subtotal_minor" >= 0 AND "shipping_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_money_nonneg" CHECK ("amount_minor" >= 0 AND "refunded_minor" >= 0 AND "refunded_minor" <= "amount_minor");
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_pos" CHECK ("amount_minor" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_qty_range" CHECK ("quantity" BETWEEN 1 AND 500);

-- Append-only tables: reject UPDATE and DELETE
CREATE OR REPLACE FUNCTION sw_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER credit_ledger_append_only BEFORE UPDATE OR DELETE ON "credit_ledger"
  FOR EACH ROW EXECUTE FUNCTION sw_reject_mutation();
CREATE TRIGGER job_events_append_only BEFORE UPDATE OR DELETE ON "job_events"
  FOR EACH ROW EXECUTE FUNCTION sw_reject_mutation();
CREATE TRIGGER order_events_append_only BEFORE UPDATE OR DELETE ON "order_events"
  FOR EACH ROW EXECUTE FUNCTION sw_reject_mutation();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION sw_reject_mutation();
-- TRUNCATE bypasses row triggers; block it too (tests reset with a dedicated role function)
CREATE TRIGGER credit_ledger_no_truncate BEFORE TRUNCATE ON "credit_ledger"
  FOR EACH STATEMENT EXECUTE FUNCTION sw_reject_mutation();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION sw_reject_mutation();

-- Job scheduling: partial index for queued and retrying rows
CREATE INDEX "jobs_status_next_run_at_pending_idx" ON "jobs" ("status", "next_run_at")
  WHERE "status" IN ('QUEUED', 'RETRYING');

-- Outbox: unpublished rows
CREATE INDEX "outbox_messages_unpublished_idx" ON "outbox_messages" ("available_at")
  WHERE "published_at" IS NULL;

-- Library search: trigram index on asset title
CREATE INDEX "assets_title_trgm_idx" ON "assets" USING GIN ("title" gin_trgm_ops);
