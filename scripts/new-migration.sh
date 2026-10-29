#!/usr/bin/env bash
# Create a migration from the schema diff (non-interactive), then apply it to the dev and
# test databases. Usage: scripts/new-migration.sh <name> [extra-sql-file]
set -euo pipefail
cd "$(dirname "$0")/../packages/db"
set -a; . ../../.env; set +a
name="$1"
dir="prisma/migrations/$(date -u +%Y%m%d%H%M%S)_${name}"
mkdir -p "$dir"
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script \
  --shadow-database-url "postgresql://sw:sw@localhost:5432/sw_shadow" 2>/dev/null | grep -v '^warn\|^For more information' > "$dir/migration.sql"
# Hand-written objects Prisma cannot model must never be dropped by a generated diff.
if grep -E 'DROP INDEX "(jobs_status_next_run_at_pending_idx|outbox_messages_unpublished_idx)"|DROP (TRIGGER|FUNCTION)|DROP CONSTRAINT "[a-z_]+_(nonneg|covers_reserved|range|pos)"' "$dir/migration.sql"; then
  echo "refusing: the diff drops hand-written SQL objects; edit $dir/migration.sql" >&2; exit 1
fi
if [ "${2:-}" != "" ]; then cat "$2" >> "$dir/migration.sql"; fi
npx prisma migrate deploy >/dev/null
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy >/dev/null
npx prisma generate >/dev/null
echo "created and applied $dir"
