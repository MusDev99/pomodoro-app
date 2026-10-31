# 🍅 Pomodoro Focus Dashboard

Zero-dependency static app: vanilla JS + `localStorage`. No backend — all data stays in the browser.

```bash
npm start                # any static server works; this one is http://localhost:8000
npm test                 # node unit tests
scripts/validate.sh      # full validation gate (syntax, tests, tests-for-changes check)
```

You can also just open `index.html` directly in a browser.

| Feature | Notes |
|---|---|
| ⏱ Timer | wall-clock based (no drift), survives reload, auto-advance, optional auto-start |
| 🔔 Alerts | end-of-session chime + notification via the service worker (works on Android); tap it to return to the app |
| ⌨️ Shortcuts | `Space` start/pause · `R` reset · `1`/`2`/`3` modes |
| 🎯 Daily goal | progress bar, configurable in settings |
| 🌗 Dark mode | toggle in top bar, saved |
| 📊 Stats | local-time day buckets, streak, 7-day chart |
| ✏️ Tasks | edit inline (pencil), reorder by dragging the handle or with ↑/↓ on it |
| 🍅 Estimates | optional pomodoro estimate per task, shown as `done/estimate` |
| 🗓 Heatmap | focus minutes per day for the last 12 weeks |
| 📈 Focus by task | top tasks by focus time |
| 📅 Weekly review | last 7 days vs the 7 before, best day, top task, longest streak |
| 💾 Backup | export/import everything as JSON in Settings; importing merges by id |
| ⬇ CSV export | generated in the browser (formula-injection safe) |
| 📱 Mobile | single-column layout, touch-sized controls, bottom-sheet settings |

## Storage

`store.js` keeps everything in `localStorage` under these keys:

| Key | Contents |
|---|---|
| `pomodoro-tasks` | task list |
| `pomodoro-sessions` | completed sessions (stats are computed from these) |
| `pomodoro-settings` | timer preferences + theme |
| `pomodoro-timer-state` | running timer snapshot (survives reload) |

Data is per browser and per device; clearing site data deletes it. Use **Settings → Export backup** to keep a copy or move it to another device (import merges, so you can combine devices).

Agent skills live in `.agents/skills/` (`code-review`, `feature-validation`). `code-review/SKILL.md` is the shared checklist used in every MusDev99 repo; `code-review/repo-checks.md` holds this app's extra checks.
