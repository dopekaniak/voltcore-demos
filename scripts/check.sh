#!/usr/bin/env bash
# Run lint, typecheck, and tests; print each exit code. Exit non-zero if any failed.
cd "$(dirname "$0")/.."
pnpm lint >/tmp/sw-lint.log 2>&1; L=$?
pnpm typecheck >/tmp/sw-typecheck.log 2>&1; T=$?
pnpm test >/tmp/sw-test.log 2>&1; X=$?
echo "lint=$L typecheck=$T test=$X"
[ $L -ne 0 ] && tail -40 /tmp/sw-lint.log
[ $T -ne 0 ] && grep -E "error TS|ERROR" /tmp/sw-typecheck.log | head -40
[ $X -ne 0 ] && grep -E "FAIL|✗|×|Error|failed" /tmp/sw-test.log | head -60
exit $(( L + T + X ))
