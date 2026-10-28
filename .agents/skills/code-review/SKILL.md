---
name: code-review
description: Reviews code changes in the Pomodoro app for correctness, security, and style, and verifies tests pass. Use when reviewing a PR/diff or checking code quality before merge.
---

# Code Review Skill (Pomodoro Focus Dashboard)

Stack: static vanilla JS app (`app.js`, `timer-core.js`, `store.js`, `audio.js`); all data lives in `localStorage`, no backend.
Pure logic belongs in `timer-core.js` (timer) and `store.js` (data + stats), because those are unit-tested.

## Process

1. **Scope the diff**: `git diff origin/main...HEAD --stat`, then read every changed file in full, not only hunks.
2. **Run the gate first**: `scripts/validate.sh`. If it fails, report the failure output verbatim as a 🔴 blocker; do not review further until the author has fixed it.
3. **Walk the checklist** below and record findings.
4. **Report** using the format at the bottom.

## Checklist

### Correctness
- Does the change do what the PR says? Trace one realistic input end to end.
- Edge cases: empty/oversized input, missing ids, duplicate ids, corrupt/missing `localStorage` data, timer at 0, page reload mid-session, tab in background.
- Time handling: `completed_at` is stored as a UTC ISO string; day buckets must go through `localDayKey(new Date(...))`. Flag any string-slice date compare.
- Timer must be wall-clock based (`endsAt - Date.now()`), never a decrementing counter.

### Security / data safety
- `store.js` validates and clamps everything it writes; reads tolerate corrupt JSON without throwing.
- Every `localStorage` access is wrapped so private mode / quota errors cannot break the app.
- CSV export goes through `csvSafe` (formula injection).
- Frontend uses `textContent`/DOM APIs for user text, never `innerHTML` with task text.

### Tests
- New behaviour has tests in `tests/` (`store.test.js` for data/stats, `timer-core.test.js` for timer logic).
- Tests assert behaviour, including failure paths (invalid input, missing ids, corrupt storage), not just the happy path.
- No skipped, disabled, or weakened tests to get green.

### Style and maintainability
- Matches surrounding code: naming, comment density, vanilla JS (no new dependencies without discussion).
- Every new function has a short docstring/JSDoc stating purpose, parameters, and return.
- DOM-free logic goes in `timer-core.js` / `store.js`, not `app.js`.
- Layout still works at phone width (≤600px): no horizontal scroll, touch targets ≥ 44px.
- Accessibility: buttons have `aria-label`, modals trap focus and close on Esc, controls are keyboard reachable.

### Performance
- Avoid re-reading/parsing `localStorage` inside loops; read once per operation.

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
| 1 | 🔴 blocker | store.js:123 | ... | ... |
| 2 | 🟠 should-fix | ... | ... | ... |
| 3 | 🟡 nit | ... | ... | ... |

Verdict: ✅ approve | 🔁 request changes
```
