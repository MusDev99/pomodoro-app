# 🍅 Pomodoro Focus Dashboard

Zero-dependency app: vanilla JS frontend + Python stdlib server + SQLite.

```bash
python3 server.py        # http://127.0.0.1:8000  (HOST / PORT env vars override)
npm test                 # node + python unit tests
scripts/validate.sh      # full validation gate (syntax, tests, tests-for-changes check)
```

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
| ⬇ CSV export | `GET /api/export/sessions.csv` (formula-injection safe) |
| 🔒 Security | same-origin writes only, input validation, static allowlist, binds to localhost |

Agent skills live in `.agents/skills/` (`code-review`, `feature-validation`).
