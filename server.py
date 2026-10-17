#!/usr/bin/env python3
"""
Lightweight Zero-Dependency Python REST API & Static Server for Pomodoro Focus Dashboard.
Uses built-in http.server and sqlite3.
"""

import http.server
import socketserver
import json
import sqlite3
import os
import sys
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timedelta

PORT = 8000
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pomodoro.db")

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    # Tasks table
    c.execute("""
    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)
    # Focus sessions table
    c.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        task_id TEXT
    )
    """)
    # Settings table
    c.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """)
    # Default settings if empty
    defaults = {
        "focus_duration": "25",
        "short_break": "5",
        "long_break": "15",
        "long_break_interval": "4"
    }
    for k, v in defaults.items():
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))

    conn.commit()
    conn.close()

class DashboardRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS for convenience
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > 0:
            raw = self.rfile.read(content_length)
            return json.loads(raw.decode('utf-8'))
        return {}

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        if path == '/api/tasks':
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT id, text, completed, created_at FROM tasks ORDER BY created_at ASC")
            rows = c.fetchall()
            conn.close()
            tasks = [{"id": r[0], "text": r[1], "completed": bool(r[2]), "created_at": r[3]} for r in rows]
            return self._send_json(tasks)

        if path == '/api/settings':
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT key, value FROM settings")
            rows = c.fetchall()
            conn.close()
            settings = {r[0]: int(r[1]) if r[1].isdigit() else r[1] for r in rows}
            return self._send_json(settings)

        if path == '/api/stats/summary':
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            
            # Today's focus stats
            today_str = datetime.now().strftime("%Y-%m-%d")
            c.execute("""
                SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0)
                FROM sessions 
                WHERE mode = 'focus' AND date(completed_at) = date('now', 'localtime')
            """)
            today_count, today_seconds = c.fetchone()

            # Past 7 days breakdown
            daily_stats = []
            for i in range(6, -1, -1):
                day_date = datetime.now() - timedelta(days=i)
                day_str = day_date.strftime("%Y-%m-%d")
                day_label = day_date.strftime("%a")
                c.execute("""
                    SELECT COALESCE(SUM(duration_seconds), 0)
                    FROM sessions 
                    WHERE mode = 'focus' AND date(completed_at) = ?
                """, (day_str,))
                sec = c.fetchone()[0]
                daily_stats.append({
                    "date": day_str,
                    "label": day_label,
                    "minutes": round(sec / 60, 1)
                })

            # Calculate streak (consecutive active days)
            c.execute("""
                SELECT DISTINCT date(completed_at)
                FROM sessions
                WHERE mode = 'focus'
                ORDER BY date(completed_at) DESC
            """)
            active_dates = [r[0] for r in c.fetchall()]
            streak = 0
            check_date = datetime.now().date()
            if active_dates and active_dates[0] == check_date.strftime("%Y-%m-%d"):
                streak = 1
                check_date -= timedelta(days=1)
                for d_str in active_dates[1:]:
                    if d_str == check_date.strftime("%Y-%m-%d"):
                        streak += 1
                        check_date -= timedelta(days=1)
                    else:
                        break
            elif active_dates and active_dates[0] == (check_date - timedelta(days=1)).strftime("%Y-%m-%d"):
                check_date -= timedelta(days=1)
                for d_str in active_dates:
                    if d_str == check_date.strftime("%Y-%m-%d"):
                        streak += 1
                        check_date -= timedelta(days=1)
                    else:
                        break

            # Total all-time sessions
            c.execute("SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0) FROM sessions WHERE mode = 'focus'")
            total_sessions, total_seconds = c.fetchone()
            conn.close()

            return self._send_json({
                "today_minutes": round(today_seconds / 60, 1),
                "today_sessions": today_count,
                "streak": streak,
                "total_sessions": total_sessions,
                "total_minutes": round(total_seconds / 60, 1),
                "daily_breakdown": daily_stats
            })

        # Static file fallback
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        if path == '/api/tasks':
            data = self._read_body()
            task_id = str(data.get('id') or int(datetime.now().timestamp() * 1000))
            text = (data.get('text') or '').strip()
            completed = 1 if data.get('completed') else 0

            if not text:
                return self._send_json({"error": "Task text required"}, 400)

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("INSERT INTO tasks (id, text, completed) VALUES (?, ?, ?)", (task_id, text, completed))
            conn.commit()
            conn.close()
            return self._send_json({"id": task_id, "text": text, "completed": bool(completed)}, 201)

        if path == '/api/sessions':
            data = self._read_body()
            session_id = str(data.get('id') or int(datetime.now().timestamp() * 1000))
            mode = data.get('mode', 'focus')
            duration = int(data.get('duration_seconds', 1500))
            task_id = data.get('task_id')

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("INSERT INTO sessions (id, mode, duration_seconds, task_id) VALUES (?, ?, ?, ?)",
                      (session_id, mode, duration, task_id))
            conn.commit()
            conn.close()
            return self._send_json({"id": session_id, "status": "recorded"}, 201)

        self.send_error(404, "Endpoint not found")

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        if path.startswith('/api/tasks/'):
            task_id = path.split('/')[-1]
            data = self._read_body()
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            updates = []
            params = []
            if 'text' in data:
                updates.append("text = ?")
                params.append(data['text'].strip())
            if 'completed' in data:
                updates.append("completed = ?")
                params.append(1 if data['completed'] else 0)

            if updates:
                params.append(task_id)
                c.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?", params)
                conn.commit()
            conn.close()
            return self._send_json({"id": task_id, "updated": True})

        if path == '/api/settings':
            data = self._read_body()
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            for k, v in data.items():
                c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (str(k), str(v)))
            conn.commit()
            conn.close()
            return self._send_json({"status": "updated"})

        self.send_error(404, "Endpoint not found")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        if path.startswith('/api/tasks/'):
            task_id = path.split('/')[-1]
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            conn.commit()
            conn.close()
            return self._send_json({"id": task_id, "deleted": True})

        self.send_error(404, "Endpoint not found")

def run():
    init_db()
    # Allow port reuse immediately
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), DashboardRequestHandler) as httpd:
        print(f"Focus Dashboard server running on http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")

if __name__ == "__main__":
    run()
