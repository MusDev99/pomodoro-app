"""API tests for server.py (stdlib unittest, temp SQLite DB, ephemeral port)."""

import json
import os
import sqlite3
import sys
import tempfile
from contextlib import closing
import threading
import time
import unittest
import urllib.error
import urllib.request
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402

server.DashboardRequestHandler.log_message = lambda *args, **kwargs: None  # quiet test output


class ApiTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db = os.path.join(cls.tmp.name, "test.db")
        cls.httpd = server.make_server("127.0.0.1", 0, cls.db)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.tmp.cleanup()

    def setUp(self):
        with closing(sqlite3.connect(self.db)) as conn:
            conn.execute("DELETE FROM tasks")
            conn.execute("DELETE FROM sessions")
            conn.execute("DELETE FROM settings")
            for k, v in server.DEFAULT_SETTINGS.items():
                conn.execute("INSERT INTO settings (key, value) VALUES (?, ?)", (k, v))
            conn.commit()

    def call(self, method, path, body=None, headers=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req) as resp:
                payload = resp.read()
                return resp.status, (json.loads(payload) if resp.headers.get_content_type() == "application/json" else payload), resp.headers
        except urllib.error.HTTPError as e:
            payload = e.read()
            try:
                payload = json.loads(payload)
            except ValueError:
                pass
            return e.code, payload, e.headers


class TaskTests(ApiTestCase):
    def test_create_list_update_delete(self):
        status, body, _ = self.call("POST", "/api/tasks", {"text": "  Write tests  "})
        self.assertEqual(status, 201)
        self.assertEqual(body["text"], "Write tests")
        tid = body["id"]

        _, tasks, _ = self.call("GET", "/api/tasks")
        self.assertEqual([t["text"] for t in tasks], ["Write tests"])
        self.assertFalse(tasks[0]["completed"])

        self.assertEqual(self.call("PUT", f"/api/tasks/{tid}", {"completed": True})[0], 200)
        self.assertTrue(self.call("GET", "/api/tasks")[1][0]["completed"])

        self.assertEqual(self.call("DELETE", f"/api/tasks/{tid}")[0], 200)
        self.assertEqual(self.call("GET", "/api/tasks")[1], [])

    def test_rejects_bad_text(self):
        for bad in ["", "   ", None, 123, ["x"], "x" * 81]:
            status, _, _ = self.call("POST", "/api/tasks", {"text": bad})
            self.assertEqual(status, 400, bad)

    def test_rejects_invalid_json_and_non_object(self):
        self.assertEqual(self.call("POST", "/api/tasks", raw=b"{not json")[0], 400)
        self.assertEqual(self.call("POST", "/api/tasks", raw=b"[1,2]")[0], 400)

    def test_duplicate_id_conflict(self):
        self.assertEqual(self.call("POST", "/api/tasks", {"id": "a", "text": "one"})[0], 201)
        self.assertEqual(self.call("POST", "/api/tasks", {"id": "a", "text": "two"})[0], 409)

    def test_update_and_delete_missing_task_404(self):
        self.assertEqual(self.call("PUT", "/api/tasks/nope", {"completed": True})[0], 404)
        self.assertEqual(self.call("DELETE", "/api/tasks/nope")[0], 404)

    def test_update_validation(self):
        _, body, _ = self.call("POST", "/api/tasks", {"text": "x"})
        tid = body["id"]
        self.assertEqual(self.call("PUT", f"/api/tasks/{tid}", {"completed": "yes"})[0], 400)
        self.assertEqual(self.call("PUT", f"/api/tasks/{tid}", {"text": ""})[0], 400)
        self.assertEqual(self.call("PUT", f"/api/tasks/{tid}", {})[0], 400)


class EstimateTests(ApiTestCase):
    def test_estimate_defaults_and_roundtrip(self):
        _, t, _ = self.call("POST", "/api/tasks", {"text": "plain"})
        self.assertEqual((t["estimate"], t["actual"]), (0, 0))
        _, t2, _ = self.call("POST", "/api/tasks", {"text": "planned", "estimate": 4})
        self.assertEqual(t2["estimate"], 4)
        self.assertEqual(self.call("PUT", f"/api/tasks/{t['id']}", {"estimate": 3})[0], 200)
        by_id = {x["id"]: x for x in self.call("GET", "/api/tasks")[1]}
        self.assertEqual(by_id[t["id"]]["estimate"], 3)

    def test_rejects_invalid_estimate(self):
        _, t, _ = self.call("POST", "/api/tasks", {"text": "x"})
        for bad in [-1, 21, "3", 1.5, True, None]:
            self.assertEqual(self.call("POST", "/api/tasks", {"text": "y", "estimate": bad})[0], 400, bad)
            self.assertEqual(self.call("PUT", f"/api/tasks/{t['id']}", {"estimate": bad})[0], 400, bad)

    def test_actual_counts_only_focus_sessions_for_that_task(self):
        _, t, _ = self.call("POST", "/api/tasks", {"text": "write", "estimate": 2})
        for _ in range(2):
            self.call("POST", "/api/sessions", {"mode": "focus", "duration_seconds": 1500, "task_id": t["id"]})
        self.call("POST", "/api/sessions", {"mode": "shortBreak", "duration_seconds": 300, "task_id": t["id"]})
        self.call("POST", "/api/sessions", {"mode": "focus", "duration_seconds": 1500})
        task = self.call("GET", "/api/tasks")[1][0]
        self.assertEqual((task["estimate"], task["actual"]), (2, 2))

    def test_migration_adds_estimate_column_and_keeps_rows(self):
        path = os.path.join(self.tmp.name, "old.db")
        with closing(sqlite3.connect(path)) as conn:
            conn.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, text TEXT NOT NULL, "
                         "completed INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
            conn.execute("INSERT INTO tasks (id, text) VALUES ('1', 'legacy')")
            conn.commit()
        server.init_db(path)
        server.init_db(path)  # idempotent
        with closing(sqlite3.connect(path)) as conn:
            self.assertEqual(conn.execute("SELECT text, estimate FROM tasks").fetchall(), [("legacy", 0)])


class InsightsApiTests(ApiTestCase):
    def test_task_stats_ranks_by_minutes_and_labels_orphans(self):
        _, a, _ = self.call("POST", "/api/tasks", {"text": "Alpha"})
        _, b, _ = self.call("POST", "/api/tasks", {"text": "Beta"})
        self.call("POST", "/api/sessions", {"mode": "focus", "duration_seconds": 600, "task_id": a["id"]})
        self.call("POST", "/api/sessions", {"mode": "focus", "duration_seconds": 1500, "task_id": b["id"]})
        self.call("POST", "/api/sessions", {"mode": "focus", "duration_seconds": 300})
        self.call("POST", "/api/sessions", {"mode": "focus", "duration_seconds": 60, "task_id": "gone"})
        self.call("POST", "/api/sessions", {"mode": "longBreak", "duration_seconds": 900, "task_id": a["id"]})
        status, rows, _ = self.call("GET", "/api/stats/tasks")
        self.assertEqual(status, 200)
        self.assertEqual([r["label"] for r in rows], ["Beta", "Alpha", "No task", "(deleted task)"])
        self.assertEqual(rows[0], {"task_id": b["id"], "label": "Beta", "sessions": 1, "minutes": 25.0})
        self.assertEqual(rows[1]["minutes"], 10.0)  # break excluded

    def test_task_stats_empty(self):
        self.assertEqual(self.call("GET", "/api/stats/tasks")[1], [])

    def test_heatmap_shape_and_today(self):
        self.call("POST", "/api/sessions", {"mode": "focus", "duration_seconds": 1500})
        status, days, _ = self.call("GET", "/api/stats/heatmap?days=30")
        self.assertEqual(status, 200)
        self.assertEqual(len(days), 30)
        self.assertEqual(days[-1]["date"], datetime.now().strftime("%Y-%m-%d"))
        self.assertEqual((days[-1]["minutes"], days[-1]["sessions"]), (25.0, 1))
        self.assertEqual(sum(d["minutes"] for d in days[:-1]), 0)
        self.assertEqual(len(self.call("GET", "/api/stats/heatmap")[1]), server.HEATMAP_DEFAULT_DAYS)

    def test_heatmap_rejects_bad_days(self):
        for bad in ["6", "366", "abc", "-1", ""]:
            self.assertEqual(self.call("GET", f"/api/stats/heatmap?days={bad}")[0], 400, bad)

    def test_csv_export(self):
        _, t, _ = self.call("POST", "/api/tasks", {"text": "Ship it"})
        self.call("POST", "/api/sessions", {"mode": "focus", "duration_seconds": 1500, "task_id": t["id"]})
        status, body, headers = self.call("GET", "/api/export/sessions.csv")
        self.assertEqual(status, 200)
        self.assertIn("text/csv", headers.get("Content-Type"))
        self.assertIn("attachment", headers.get("Content-Disposition"))
        lines = body.decode().strip().split("\n")
        self.assertEqual(lines[0], "id,mode,duration_seconds,completed_at_local,task_id,task")
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[1].endswith(f",{t['id']},Ship it"))

    def test_csv_neutralises_formula_injection_and_quotes(self):
        _, t, _ = self.call("POST", "/api/tasks", {"text": '=HYPERLINK("http://evil","x"),a'})
        self.call("POST", "/api/sessions", {"mode": "focus", "duration_seconds": 60, "task_id": t["id"]})
        import csv, io
        rows = list(csv.reader(io.StringIO(self.call("GET", "/api/export/sessions.csv")[1].decode())))
        self.assertEqual(rows[1][5], '\'=HYPERLINK("http://evil","x"),a')

    def test_csv_empty_has_header_only(self):
        body = self.call("GET", "/api/export/sessions.csv")[1].decode().strip()
        self.assertEqual(body, "id,mode,duration_seconds,completed_at_local,task_id,task")

    def test_csv_safe_helper(self):
        for risky in ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]:
            self.assertEqual(server.csv_safe(risky), "'" + risky)
        self.assertEqual(server.csv_safe("normal"), "normal")
        self.assertEqual(server.csv_safe(25), 25)


class SessionTests(ApiTestCase):
    def test_record_session(self):
        status, body, _ = self.call("POST", "/api/sessions",
                                    {"mode": "focus", "duration_seconds": 1500, "task_id": 7})
        self.assertEqual(status, 201)
        with closing(sqlite3.connect(self.db)) as conn:
            row = conn.execute("SELECT mode, duration_seconds, task_id FROM sessions").fetchone()
        self.assertEqual(row, ("focus", 1500, "7"))

    def test_rejects_invalid_sessions(self):
        cases = [
            {"mode": "nap", "duration_seconds": 60},
            {"mode": "focus", "duration_seconds": "abc"},
            {"mode": "focus", "duration_seconds": 0},
            {"mode": "focus", "duration_seconds": -5},
            {"mode": "focus", "duration_seconds": True},
            {"mode": "focus", "duration_seconds": 10**9},
        ]
        for case in cases:
            self.assertEqual(self.call("POST", "/api/sessions", case)[0], 400, case)


class SettingsTests(ApiTestCase):
    def test_defaults_include_new_keys(self):
        _, s, _ = self.call("GET", "/api/settings")
        self.assertEqual(s["focus_duration"], 25)
        self.assertEqual(s["auto_start"], 0)
        self.assertEqual(s["daily_goal"], 4)
        self.assertEqual(s["theme"], "light")

    def test_update_roundtrip(self):
        status, _, _ = self.call("PUT", "/api/settings",
                                 {"focus_duration": 50, "auto_start": 1, "theme": "dark", "daily_goal": 8})
        self.assertEqual(status, 200)
        _, s, _ = self.call("GET", "/api/settings")
        self.assertEqual((s["focus_duration"], s["auto_start"], s["theme"], s["daily_goal"]), (50, 1, "dark", 8))

    def test_rejects_invalid_values_atomically(self):
        bad_payloads = [
            {"focus_duration": 0}, {"focus_duration": 91}, {"focus_duration": "25"},
            {"focus_duration": 1.5}, {"theme": "neon"}, {"auto_start": 2},
            {"bogus": 1}, {}, [],
        ]
        for p in bad_payloads:
            self.assertEqual(self.call("PUT", "/api/settings", p)[0], 400, p)
        # a valid key next to an invalid one must not be partially applied
        self.assertEqual(self.call("PUT", "/api/settings", {"short_break": 9, "theme": "neon"})[0], 400)
        self.assertEqual(self.call("GET", "/api/settings")[1]["short_break"], 5)


class SecurityAndStaticTests(ApiTestCase):
    def test_no_wildcard_cors(self):
        _, _, headers = self.call("GET", "/api/tasks")
        self.assertIsNone(headers.get("Access-Control-Allow-Origin"))

    def test_cross_origin_write_blocked(self):
        status, _, _ = self.call("POST", "/api/tasks", {"text": "evil"},
                                 headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 403)
        self.assertEqual(self.call("GET", "/api/tasks")[1], [])

    def test_same_origin_write_allowed(self):
        host = self.base.replace("http://", "")
        status, _, _ = self.call("POST", "/api/tasks", {"text": "ok"}, headers={"Origin": self.base})
        self.assertEqual(status, 201, host)

    def test_static_allowlist(self):
        self.assertEqual(self.call("GET", "/")[0], 200)
        self.assertEqual(self.call("GET", "/app.js")[0], 200)
        self.assertEqual(self.call("GET", "/timer-core.js")[0], 200)
        for path in ["/server.py", "/test.db", "/.git/config", "/summary_task2.md", "/tests/test_server.py"]:
            self.assertEqual(self.call("GET", path)[0], 404, path)

    def test_unknown_api_404(self):
        self.assertEqual(self.call("GET", "/api/nope")[0], 404)


class PwaTests(ApiTestCase):
    def test_manifest_is_valid_installable_json(self):
        status, body, headers = self.call("GET", "/manifest.webmanifest")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Content-Type"), "application/manifest+json")
        manifest = json.loads(body)
        for key in ["name", "short_name", "start_url", "display", "icons", "theme_color", "background_color"]:
            self.assertIn(key, manifest)
        self.assertIn(manifest["display"], {"standalone", "fullscreen", "minimal-ui"})
        purposes = {i.get("purpose") for i in manifest["icons"]}
        sizes = {i["sizes"] for i in manifest["icons"]}
        self.assertIn("192x192", sizes)
        self.assertIn("512x512", sizes)
        self.assertIn("maskable", purposes)

    def test_every_manifest_icon_is_served_as_png(self):
        manifest = json.loads(self.call("GET", "/manifest.webmanifest")[1])
        for icon in manifest["icons"]:
            status, body, headers = self.call("GET", "/" + icon["src"])
            self.assertEqual(status, 200, icon["src"])
            self.assertEqual(headers.get("Content-Type"), "image/png")
            self.assertEqual(body[:8], b"\x89PNG\r\n\x1a\n", icon["src"])

    def test_apple_touch_icon_served(self):
        status, body, _ = self.call("GET", "/icons/apple-touch-icon.png")
        self.assertEqual(status, 200)
        self.assertEqual(body[:4], b"\x89PNG")

    def test_service_worker_served_uncached_and_js(self):
        status, body, headers = self.call("GET", "/sw.js")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Cache-Control"), "no-cache")
        self.assertIn("javascript", headers.get("Content-Type"))
        self.assertIn(b"addEventListener('fetch'", body)

    def test_api_is_not_cached_by_worker(self):
        sw = self.call("GET", "/sw.js")[1].decode()
        self.assertIn("url.pathname.startsWith('/api/')", sw)

    def test_index_links_manifest_and_icons(self):
        html = self.call("GET", "/")[1].decode()
        self.assertIn('rel="manifest" href="manifest.webmanifest"', html)
        self.assertIn('rel="apple-touch-icon"', html)
        self.assertIn('name="viewport"', html)
        self.assertIn("viewport-fit=cover", html)
        self.assertIn('id="install-btn"', html)

    def test_shell_assets_referenced_by_worker_exist(self):
        sw = self.call("GET", "/sw.js")[1].decode()
        import re
        shell = re.search(r"const SHELL = \[(.*?)\];", sw, re.S).group(1)
        paths = re.findall(r"'(/[^']*)'", shell)
        self.assertGreater(len(paths), 5)
        for path in paths:
            self.assertEqual(self.call("GET", path)[0], 200, path)


class StatsTests(unittest.TestCase):
    def setUp(self):
        self._tz = os.environ.get("TZ")
        os.environ["TZ"] = "Asia/Kuala_Lumpur"  # UTC+8
        time.tzset()
        self.conn = sqlite3.connect(":memory:")
        self.conn.execute("""CREATE TABLE sessions (id TEXT PRIMARY KEY, mode TEXT, duration_seconds INTEGER,
                             completed_at TIMESTAMP, task_id TEXT)""")

    def tearDown(self):
        self.conn.close()
        if self._tz is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = self._tz
        time.tzset()

    def add(self, sid, completed_utc, mode="focus", secs=1500):
        self.conn.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, NULL)", (sid, mode, secs, completed_utc))

    def test_utc_timestamps_bucketed_by_local_day(self):
        # 2026-10-23 17:00 UTC == 2026-10-24 01:00 in UTC+8 -> belongs to "today" (24th)
        self.add("a", "2026-10-23 17:00:00")
        summary = server.build_summary(self.conn, now=datetime(2026, 10, 24, 12, 0))
        self.assertEqual(summary["today_sessions"], 1)
        self.assertEqual(summary["today_minutes"], 25.0)
        self.assertEqual(summary["daily_breakdown"][-1]["date"], "2026-10-24")
        self.assertEqual(summary["daily_breakdown"][-1]["minutes"], 25.0)
        self.assertEqual(summary["daily_breakdown"][-2]["minutes"], 0)

    def test_breaks_not_counted_and_week_window(self):
        self.add("f", "2026-10-24 02:00:00")
        self.add("b", "2026-10-24 03:00:00", mode="shortBreak", secs=300)
        self.add("old", "2026-10-01 02:00:00")
        s = server.build_summary(self.conn, now=datetime(2026, 10, 24, 12, 0))
        self.assertEqual(s["today_sessions"], 1)
        self.assertEqual(len(s["daily_breakdown"]), 7)
        self.assertEqual(sum(d["minutes"] for d in s["daily_breakdown"]), 25.0)
        self.assertEqual(s["total_sessions"], 2)

    def test_heatmap_zero_fills_and_buckets_local_days(self):
        self.add("a", "2026-10-23 17:00:00")                    # local 24th 01:00
        self.add("b", "2026-10-20 02:00:00", secs=3000)          # local 20th
        self.add("c", "2026-10-20 03:00:00", mode="shortBreak")  # ignored
        days = server.build_heatmap(self.conn, days=7, now=datetime(2026, 10, 24, 12, 0))
        self.assertEqual([d["date"] for d in days][0], "2026-10-18")
        self.assertEqual(days[-1]["date"], "2026-10-24")
        by = {d["date"]: d for d in days}
        self.assertEqual(by["2026-10-24"]["minutes"], 25.0)
        self.assertEqual((by["2026-10-20"]["minutes"], by["2026-10-20"]["sessions"]), (50.0, 1))
        self.assertEqual(by["2026-10-21"]["minutes"], 0)

    def test_streak(self):
        d = date(2026, 10, 24)
        fmt = lambda *days: [date(2026, 10, x).strftime("%Y-%m-%d") for x in days]
        self.assertEqual(server.compute_streak([], d), 0)
        self.assertEqual(server.compute_streak(fmt(24, 23, 22), d), 3)
        self.assertEqual(server.compute_streak(fmt(23, 22), d), 2)      # today not yet done
        self.assertEqual(server.compute_streak(fmt(24, 22), d), 1)      # gap breaks streak
        self.assertEqual(server.compute_streak(fmt(21, 20), d), 0)      # stale


if __name__ == "__main__":
    unittest.main()
