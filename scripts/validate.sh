#!/usr/bin/env bash
# Feature validation gate: syntax checks + all unit tests. Exit non-zero on any failure.
# Usage: scripts/validate.sh [base-ref]   (base-ref defaults to origin/main; used for the test-coverage check)
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-origin/main}"
step() { printf '\n▶ %s\n' "$1"; }

step "Python syntax"
python3 -m py_compile server.py tests/test_server.py

step "JavaScript syntax"
for f in app.js audio.js timer-core.js tests/timer-core.test.js; do node --check "$f"; done

step "Node unit tests (timer-core)"
node --test tests/*.test.js

step "Python API tests (server)"
python3 -m unittest discover -s tests

step "Changed-code-has-tests check (vs $BASE)"
if git rev-parse --verify -q "$BASE" >/dev/null; then
  changed=$(git diff --name-only "$BASE"...HEAD -- server.py timer-core.js app.js || true)
  tests_changed=$(git diff --name-only "$BASE"...HEAD -- tests || true)
  if [ -n "$changed" ] && [ -z "$tests_changed" ]; then
    echo "✗ Source changed ($(echo $changed)) but no files under tests/ changed." >&2
    exit 1
  fi
  echo "✓ ok"
else
  echo "(skipped: $BASE not found)"
fi

printf '\n✅ All validation checks passed\n'
