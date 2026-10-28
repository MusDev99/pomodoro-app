---
name: feature-validation
description: Validates that a new or changed feature is implemented correctly and that all unit tests pass. Use after implementing a feature, before committing, pushing, or opening a PR.
---

# Feature Validation Skill

Goal: prove a feature works and the unit tests pass before it is declared done.
Never report a feature complete on the strength of "it should work".

## Steps

1. **Define acceptance criteria** (3-6 bullets) from the request. Example for "daily goal": setting saved, progress bar updates, capped at 100%, invalid goal ignored by the store.
2. **Map each criterion to a test**.
   - Pure logic → `tests/timer-core.test.js` (`node:test`). Put DOM-free code in `timer-core.js` so it is testable.
   - Data/stats behaviour → `tests/store.test.js` (in-memory storage + fake clock, see `makeStore`).
   - Add the missing tests. Include failure paths (invalid input, missing id, corrupt storage).
3. **Run the gate**: `scripts/validate.sh` (or `npm test` for tests only).
   - It runs syntax checks, Node tests, and checks that source changes come with test changes.
   - If something fails, reproduce, fix the **code** (not the test, unless the test is wrong), and re-run until green. Never skip, delete, or weaken a test to pass.
4. **UI smoke test** for any frontend change: serve the folder (`python3 -m http.server 8123`), drive it with Playwright (preinstalled; `require('playwright')`), and confirm at desktop and phone (375px) widths: no console errors, the feature's happy path works, and a page reload keeps state where expected. Use a fresh browser context so `localStorage` starts empty.
5. **Report** with the table below, quoting real test counts from the run output.

## Report format

| Criterion | Test / evidence | Result |
|-----------|-----------------|--------|
| e.g. Goal rejects 0 | `settings fall back to defaults and only keep valid values` | ✅ |

```
Gate: ✅ N node tests passed, smoke test clean
```

If any row is ❌ or unverified, say so plainly and do not mark the feature done.

## Definition of done
- [ ] Acceptance criteria each map to a passing test
- [ ] `scripts/validate.sh` exits 0
- [ ] UI smoke test run for frontend changes (or stated why not)
- [ ] No unrelated files changed (`git status`)
