#!/usr/bin/env python3
"""
Lightweight zero-dependency Python REST API & static server for the Pomodoro Focus Dashboard.
Uses built-in http.server and sqlite3.
"""

import csv
import http.server
import io
import json
import os
import sqlite3
from contextlib import closing, contextmanager
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "pomodoro.db")

MAX_BODY_BYTES = 64 * 1024
MAX_TASK_LENGTH = 80
MAX_ESTIMATE = 20
HEATMAP_DEFAULT_DAYS = 84
HEATMAP_MAX_DAYS = 365
TOP_TASKS_LIMIT = 10
MAX_SESSION_SECONDS = 24 * 60 * 60
VALID_MODES = {"focus", "shortBreak", "longBreak"}

# Only these files are served statically (never pomodoro.db, server.py, .git, ...).
STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/app.js": "app.js",
    "/audio.js": "audio.js",
    "/timer-core.js": "timer-core.js",
    "/style.css": "style.css",
}

DEFAULT_SETTINGS = {
    "focus_duration": "25",
    "short_break": "5",
    "long_break": "15",
    "long_break_interval": "4",
    "auto_start": "0",
    "daily_goal": "4",
    "theme": "light",
}

# key -> (min, max) for integers, or a set of allowed strings.
SETTING_RULES = {
    "focus_duration": (1, 90),
    "short_break": (1, 30),
    "long_break": (1, 60),
    "long_break_interval": (1, 10),
    "auto_start": (0, 1),
    "daily_goal": (1, 24),
    "theme": {"light", "dark"},
}


@contextmanager
def connect(db_file):
    """Open a SQLite connection that commits on success, rolls back on error, always closes."""
    conn = sqlite3.connect(db_file)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


class ApiError(Exception):
    """Raised by request handlers to return a JSON error with a given status."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def init_db(db_file=DB_FILE):
    """Create tables, indexes and default settings if they do not exist."""
    with closing(sqlite3.connect(db_file)) as conn:
        c = conn.cursor()
        c.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        # Migration: per-task pomodoro estimate (added after the first release)
        if "estimate" not in {r[1] for r in c.execute("PRAGMA table_info(tasks)")}:
            c.execute("ALTER TABLE tasks ADD COLUMN estimate INTEGER NOT NULL DEFAULT 0")
        # completed_at is stored in UTC; queries convert with the 'localtime' modifier.
        c.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            mode TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL,
            completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            task_id TEXT
        )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_sessions_completed_at ON sessions (completed_at)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_sessions_task_id ON sessions (task_id)")
        c.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """)
        for k, v in DEFAULT_SETTINGS.items():
            c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))
        conn.commit()


def validate_task_text(value):
    """Return a trimmed task title or raise ApiError(400)."""
    if not isinstance(value, str) or not value.strip():
        raise ApiError(400, "Task text required")
    text = value.strip()
    if len(text) > MAX_TASK_LENGTH:
        raise ApiError(400, f"Task text must be at most {MAX_TASK_LENGTH} characters")
    return text


def validate_estimate(value):
    """Return a pomodoro estimate in 0..MAX_ESTIMATE (0 = none) or raise ApiError(400)."""
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_ESTIMATE:
        raise ApiError(400, f"estimate must be an integer between 0 and {MAX_ESTIMATE}")
    return value


def validate_settings(data):
    """Validate a settings payload and return {key: str(value)}; raises ApiError(400)."""
    if not isinstance(data, dict) or not data:
        raise ApiError(400, "Settings object required")
    clean = {}
    for key, value in data.items():
        rule = SETTING_RULES.get(key)
        if rule is None:
            raise ApiError(400, f"Unknown setting: {key}")
        if isinstance(rule, set):
            if value not in rule:
                raise ApiError(400, f"{key} must be one of {sorted(rule)}")
            clean[key] = value
            continue
        if isinstance(value, bool):
            value = int(value)
        if not isinstance(value, int):
            raise ApiError(400, f"{key} must be an integer")
        low, high = rule
        if not low <= value <= high:
            raise ApiError(400, f"{key} must be between {low} and {high}")
        clean[key] = str(value)
    return clean


def compute_streak(active_dates, today):
    """
    Count consecutive active days ending today (or yesterday if today has no session yet).

    active_dates: iterable of 'YYYY-MM-DD' strings. today: datetime.date.
    """
    active = set(active_dates)
    day = today
    if day.strftime("%Y-%m-%d") not in active:
        day -= timedelta(days=1)
    streak = 0
    while day.strftime("%Y-%m-%d") in active:
        streak += 1
        day -= timedelta(days=1)
    return streak


def build_summary(conn, now=None):
    """Aggregate focus statistics (today, last 7 days, streak, totals) in local time."""
    now = now or datetime.now()
    local_day = "date(completed_at, 'localtime')"
    today = now.date()
    week_start = (today - timedelta(days=6)).strftime("%Y-%m-%d")

    per_day = {
        r[0]: (r[1], r[2])
        for r in conn.execute(
            f"SELECT {local_day}, COALESCE(SUM(duration_seconds), 0), COUNT(*) FROM sessions "
            f"WHERE mode = 'focus' AND {local_day} >= ? GROUP BY {local_day}",
            (week_start,),
        )
    }

    daily = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        key = d.strftime("%Y-%m-%d")
        seconds = per_day.get(key, (0, 0))[0]
        daily.append({"date": key, "label": d.strftime("%a"), "minutes": round(seconds / 60, 1)})

    today_seconds, today_count = per_day.get(today.strftime("%Y-%m-%d"), (0, 0))
    active_dates = [r[0] for r in conn.execute(
        f"SELECT DISTINCT {local_day} FROM sessions WHERE mode = 'focus'")]
    total_sessions, total_seconds = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0) FROM sessions WHERE mode = 'focus'"
    ).fetchone()

    return {
        "today_minutes": round(today_seconds / 60, 1),
        "today_sessions": today_count,
        "streak": compute_streak(active_dates, today),
        "total_sessions": total_sessions,
        "total_minutes": round(total_seconds / 60, 1),
        "daily_breakdown": daily,
    }


def list_tasks(conn):
    """All tasks with their estimate and the number of focus sessions logged against them."""
    rows = conn.execute(
        "SELECT t.id, t.text, t.completed, t.created_at, t.estimate, "
        "(SELECT COUNT(*) FROM sessions s WHERE s.task_id = t.id AND s.mode = 'focus') "
        "FROM tasks t ORDER BY t.created_at ASC, t.rowid ASC"
    ).fetchall()
    return [
        {"id": r[0], "text": r[1], "completed": bool(r[2]), "created_at": r[3],
         "estimate": r[4], "actual": r[5]}
        for r in rows
    ]


def build_task_stats(conn, limit=TOP_TASKS_LIMIT):
    """Focus time per task (top `limit` by minutes), including sessions with no/deleted task."""
    rows = conn.execute(
        "SELECT s.task_id, t.text, COUNT(*), COALESCE(SUM(s.duration_seconds), 0) AS secs "
        "FROM sessions s LEFT JOIN tasks t ON t.id = s.task_id "
        "WHERE s.mode = 'focus' GROUP BY s.task_id ORDER BY secs DESC, s.task_id LIMIT ?",
        (limit,),
    ).fetchall()
    result = []
    for task_id, text, count, secs in rows:
        if task_id is None:
            label = "No task"
        else:
            label = text or "(deleted task)"
        result.append({"task_id": task_id, "label": label, "sessions": count,
                       "minutes": round(secs / 60, 1)})
    return result


def build_heatmap(conn, days=HEATMAP_DEFAULT_DAYS, now=None):
    """Focus minutes per local day for the last `days` days, oldest first, zero-filled."""
    now = now or datetime.now()
    today = now.date()
    start = today - timedelta(days=days - 1)
    local_day = "date(completed_at, 'localtime')"
    per_day = {
        r[0]: (r[1], r[2])
        for r in conn.execute(
            f"SELECT {local_day}, COALESCE(SUM(duration_seconds), 0), COUNT(*) FROM sessions "
            f"WHERE mode = 'focus' AND {local_day} >= ? GROUP BY {local_day}",
            (start.strftime("%Y-%m-%d"),),
        )
    }
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        key = d.strftime("%Y-%m-%d")
        secs, count = per_day.get(key, (0, 0))
        out.append({"date": key, "minutes": round(secs / 60, 1), "sessions": count})
    return out


def csv_safe(value):
    """Neutralise spreadsheet formula injection: prefix cells starting with = + - @ (or tab/CR)."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def sessions_csv(conn):
    """Full session history as CSV text (local timestamps, task title resolved)."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["id", "mode", "duration_seconds", "completed_at_local", "task_id", "task"])
    rows = conn.execute(
        "SELECT s.id, s.mode, s.duration_seconds, datetime(s.completed_at, 'localtime'), "
        "s.task_id, t.text FROM sessions s LEFT JOIN tasks t ON t.id = s.task_id "
        "ORDER BY s.completed_at ASC, s.rowid ASC"
    )
    for row in rows:
        writer.writerow([csv_safe(v) if v is not None else "" for v in row])
    return out.getvalue()


class DashboardRequestHandler(http.server.SimpleHTTPRequestHandler):
    db_file = DB_FILE

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    # ---- helpers -------------------------------------------------------
    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            raise ApiError(400, "Invalid Content-Length")
        if length > MAX_BODY_BYTES:
            raise ApiError(413, "Request body too large")
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "Invalid JSON body")

    def _check_same_origin(self):
        """Reject cross-site writes (CSRF / DNS rebinding): Origin host must match Host."""
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc != self.headers.get("Host", ""):
            raise ApiError(403, "Cross-origin requests are not allowed")

    def _connect(self):
        return connect(self.db_file)

    def _dispatch(self, handler, mutating):
        try:
            if mutating:
                self._check_same_origin()
            handler(urlparse(self.path).path.rstrip("/"))
        except ApiError as e:
            self._send_json({"error": e.message}, e.status)

    # ---- verbs ---------------------------------------------------------
    def do_OPTIONS(self):
        # No CORS: the API is same-origin only.
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        self._dispatch(self._get, mutating=False)

    def do_POST(self):
        self._dispatch(self._post, mutating=True)

    def do_PUT(self):
        self._dispatch(self._put, mutating=True)

    def do_DELETE(self):
        self._dispatch(self._delete, mutating=True)

    def do_HEAD(self):
        if self._static_path() is None:
            return self.send_error(404, "Not found")
        super().do_HEAD()

    def _static_path(self):
        name = STATIC_FILES.get(urlparse(self.path).path)
        return name

    def _get(self, path):
        if path == "/api/tasks":
            with self._connect() as conn:
                return self._send_json(list_tasks(conn))

        if path == "/api/settings":
            with self._connect() as conn:
                rows = conn.execute("SELECT key, value FROM settings").fetchall()
            return self._send_json({r[0]: int(r[1]) if r[1].isdigit() else r[1] for r in rows})

        if path == "/api/stats/summary":
            with self._connect() as conn:
                return self._send_json(build_summary(conn))

        if path == "/api/stats/tasks":
            with self._connect() as conn:
                return self._send_json(build_task_stats(conn))

        if path == "/api/stats/heatmap":
            query = parse_qs(urlparse(self.path).query, keep_blank_values=True)
            try:
                days = int(query.get("days", [HEATMAP_DEFAULT_DAYS])[0])
            except ValueError:
                raise ApiError(400, "days must be an integer")
            if not 7 <= days <= HEATMAP_MAX_DAYS:
                raise ApiError(400, f"days must be between 7 and {HEATMAP_MAX_DAYS}")
            with self._connect() as conn:
                return self._send_json(build_heatmap(conn, days))

        if path == "/api/export/sessions.csv":
            with self._connect() as conn:
                body = sessions_csv(conn).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="pomodoro-sessions.csv"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path.startswith("/api/"):
            raise ApiError(404, "Endpoint not found")

        name = self._static_path()
        if name is None:
            raise ApiError(404, "Not found")
        self.path = "/" + name
        return super().do_GET()

    def _post(self, path):
        if path == "/api/tasks":
            data = self._read_body()
            if not isinstance(data, dict):
                raise ApiError(400, "JSON object required")
            text = validate_task_text(data.get("text"))
            task_id = str(data.get("id") or int(datetime.now().timestamp() * 1000))
            completed = 1 if data.get("completed") else 0
            estimate = validate_estimate(data.get("estimate", 0))
            try:
                with self._connect() as conn:
                    conn.execute("INSERT INTO tasks (id, text, completed, estimate) VALUES (?, ?, ?, ?)",
                                 (task_id, text, completed, estimate))
            except sqlite3.IntegrityError:
                raise ApiError(409, "Task id already exists")
            return self._send_json({"id": task_id, "text": text, "completed": bool(completed),
                                    "estimate": estimate, "actual": 0}, 201)

        if path == "/api/sessions":
            data = self._read_body()
            if not isinstance(data, dict):
                raise ApiError(400, "JSON object required")
            mode = data.get("mode", "focus")
            if mode not in VALID_MODES:
                raise ApiError(400, f"mode must be one of {sorted(VALID_MODES)}")
            duration = data.get("duration_seconds", 1500)
            if isinstance(duration, bool) or not isinstance(duration, int) \
                    or not 1 <= duration <= MAX_SESSION_SECONDS:
                raise ApiError(400, f"duration_seconds must be an integer in 1..{MAX_SESSION_SECONDS}")
            task_id = data.get("task_id")
            if task_id is not None:
                task_id = str(task_id)
            session_id = str(data.get("id") or int(datetime.now().timestamp() * 1000))
            try:
                with self._connect() as conn:
                    conn.execute(
                        "INSERT INTO sessions (id, mode, duration_seconds, task_id) VALUES (?, ?, ?, ?)",
                        (session_id, mode, duration, task_id))
            except sqlite3.IntegrityError:
                raise ApiError(409, "Session id already exists")
            return self._send_json({"id": session_id, "status": "recorded"}, 201)

        raise ApiError(404, "Endpoint not found")

    def _put(self, path):
        if path.startswith("/api/tasks/"):
            task_id = path.split("/")[-1]
            data = self._read_body()
            if not isinstance(data, dict):
                raise ApiError(400, "JSON object required")
            updates, params = [], []
            if "text" in data:
                updates.append("text = ?")
                params.append(validate_task_text(data["text"]))
            if "completed" in data:
                if not isinstance(data["completed"], bool):
                    raise ApiError(400, "completed must be a boolean")
                updates.append("completed = ?")
                params.append(int(data["completed"]))
            if "estimate" in data:
                updates.append("estimate = ?")
                params.append(validate_estimate(data["estimate"]))
            if not updates:
                raise ApiError(400, "Nothing to update")
            with self._connect() as conn:
                cur = conn.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?",
                                   params + [task_id])
            if cur.rowcount == 0:
                raise ApiError(404, "Task not found")
            return self._send_json({"id": task_id, "updated": True})

        if path == "/api/settings":
            clean = validate_settings(self._read_body())
            with self._connect() as conn:
                conn.executemany("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                                 list(clean.items()))
            return self._send_json({"status": "updated"})

        raise ApiError(404, "Endpoint not found")

    def _delete(self, path):
        if path.startswith("/api/tasks/"):
            task_id = path.split("/")[-1]
            with self._connect() as conn:
                cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            if cur.rowcount == 0:
                raise ApiError(404, "Task not found")
            return self._send_json({"id": task_id, "deleted": True})

        raise ApiError(404, "Endpoint not found")


def make_server(host=HOST, port=PORT, db_file=DB_FILE):
    """Build a threaded server bound to a SQLite file (port 0 picks a free port)."""
    init_db(db_file)
    handler = type("BoundHandler", (DashboardRequestHandler,), {"db_file": db_file})
    server = http.server.ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    return server


def run():
    httpd = make_server()
    print(f"Focus Dashboard server running on http://{HOST}:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    run()
