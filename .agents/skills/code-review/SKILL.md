---
name: code-review
description: Reviews code changes in the Pomodoro app for correctness, security, and style, and verifies tests pass. Use when reviewing a PR/diff or checking code quality before merge.
---

# Code Review Skill (Pomodoro Focus Dashboard)

Stack: vanilla JS frontend (`app.js`, `timer-core.js`, `audio.js`), Python stdlib server (`server.py`) with SQLite.
Pure logic belongs in `timer-core.js` (frontend) and the helper functions in `server.py`, because those are unit-tested.

## Process

1. **Scope the diff**: `git diff origin/main...HEAD --stat`, then read every changed file in full, not only hunks.
2. **Run the gate first**: `scripts/validate.sh`. If it fails, report the failure output verbatim as a 🔴 blocker; do not review further until the author has fixed it.
3. **Walk the checklist** below and record findings.
4. **Report** using the format at the bottom.

## Checklist

### Correctness
- Does the change do what the PR says? Trace one realistic input end to end.
- Edge cases: empty/oversized input, missing rows (404 vs 200), duplicate ids, timer at 0, page reload mid-session, tab in background.
- Time handling: `sessions.completed_at` is stored in **UTC**; queries must use `date(completed_at,'localtime')`. Flag any naive date compare.
- Timer must be wall-clock based (`endsAt - Date.now()`), never a decrementing counter.

### Security (server.py)
- No wildcard CORS. Mutating routes go through the same-origin (`Origin` vs `Host`) check.
- All request data validated before touching SQLite; SQL uses `?` params only (f-strings only for fixed column fragments).
- Static serving stays on the `STATIC_FILES` allowlist, so `pomodoro.db`, `server.py`, `.git` stay unreachable.
- Frontend uses `textContent`/DOM APIs for user text, never `innerHTML` with task text.

### Tests
- New behaviour has tests in `tests/` (`test_server.py` for API, `timer-core.test.js` for pure JS logic).
- Tests assert behaviour, including failure paths (400/403/404/409), not just the happy path.
- No skipped, disabled, or weakened tests to get green.

### Style and maintainability
- Matches surrounding code: naming, comment density, vanilla JS (no new dependencies without discussion).
- Every new function has a short docstring/JSDoc stating purpose, parameters, and return.
- DOM-free logic goes in `timer-core.js`, not `app.js`.
- Accessibility: buttons have `aria-label`, modals trap focus and close on Esc, controls are keyboard reachable.

### Performance
- No per-row queries in loops; prefer one grouped query. Indexes exist for new filter columns.

## Feedback rules
- Be specific: file:line, what is wrong, why it matters, and a suggested fix.
- Separate blockers from nits. Do not block on style preferences.
- Praise what is solid in one line; do not pad.

## Report format

```
## Review: <branch or PR>
Gate: ✅ scripts/validate.sh passed  |  ❌ failed (paste output)

| # | Severity | Location | Finding | Suggested fix |
|---|----------|----------|---------|---------------|
| 1 | 🔴 blocker | server.py:123 | ... | ... |
| 2 | 🟠 should-fix | ... | ... | ... |
| 3 | 🟡 nit | ... | ... | ... |

Verdict: ✅ approve | 🔁 request changes
```
