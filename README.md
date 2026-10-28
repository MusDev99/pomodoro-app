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
| 🔔 Alerts | end-of-session chime + desktop notification |
| ⌨️ Shortcuts | `Space` start/pause · `R` reset · `1`/`2`/`3` modes |
| 🎯 Daily goal | progress bar, configurable in settings |
| 🌗 Dark mode | toggle in top bar, saved |
| 📊 Stats | local-time day buckets, streak, 7-day chart |
| 🍅 Estimates | optional pomodoro estimate per task, shown as `done/estimate` |
| 🗓 Heatmap | focus minutes per day for the last 12 weeks |
| 📈 Focus by task | top tasks by focus time |
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

Data is per browser and per device; clearing site data deletes it. Export CSV to keep a copy.

Agent skills live in `.agents/skills/` (`code-review`, `feature-validation`).
