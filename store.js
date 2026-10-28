// localStorage-backed data layer (tasks, sessions, settings, stats). No DOM, so it can be
// unit-tested with `node --test` by passing any object with getItem/setItem.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PomodoroStore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const KEYS = { tasks: 'pomodoro-tasks', sessions: 'pomodoro-sessions', settings: 'pomodoro-settings' };
  const MAX_TASK_LENGTH = 80;
  const MAX_ESTIMATE = 20;
  const MAX_SESSION_SECONDS = 24 * 60 * 60;
  const TOP_TASKS_LIMIT = 10;
  const VALID_MODES = ['focus', 'shortBreak', 'longBreak'];

  const DEFAULT_SETTINGS = {
    focus_duration: 25,
    short_break: 5,
    long_break: 15,
    long_break_interval: 4,
    auto_start: 0,
    daily_goal: 4,
    theme: 'light',
  };

  // key -> [min, max] for integers, or an array of allowed strings.
  const SETTING_RULES = {
    focus_duration: [1, 90],
    short_break: [1, 30],
    long_break: [1, 60],
    long_break_interval: [1, 10],
    auto_start: [0, 1],
    daily_goal: [1, 24],
    theme: ['light', 'dark'],
  };

  /** 'YYYY-MM-DD' for a Date in local time. */
  function localDayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  }

  /** Keep only known settings with valid values; invalid entries are dropped. */
  function cleanSettings(data) {
    const clean = {};
    if (!data || typeof data !== 'object') return clean;
    Object.keys(SETTING_RULES).forEach((key) => {
      if (!(key in data)) return;
      const rule = SETTING_RULES[key];
      let value = data[key];
      if (typeof rule[0] === 'string') {
        if (rule.includes(value)) clean[key] = value;
        return;
      }
      if (typeof value === 'boolean') value = Number(value);
      if (Number.isInteger(value) && value >= rule[0] && value <= rule[1]) clean[key] = value;
    });
    return clean;
  }

  /** Consecutive active days ending today (or yesterday if today has no session yet). */
  function computeStreak(activeDays, today) {
    const active = new Set(activeDays);
    let day = today;
    if (!active.has(localDayKey(day))) day = addDays(day, -1);
    let streak = 0;
    while (active.has(localDayKey(day))) {
      streak++;
      day = addDays(day, -1);
    }
    return streak;
  }

  /** Neutralise spreadsheet formula injection: prefix cells starting with = + - @ (or tab/CR). */
  function csvSafe(value) {
    const s = String(value);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }

  function csvCell(value) {
    const s = csvSafe(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const round1 = (n) => Math.round(n * 10) / 10;

  function createStore(storage, now = () => new Date()) {
    let lastId = 0;

    function read(key, fallback) {
      try {
        const v = JSON.parse(storage.getItem(key));
        return v === null || v === undefined ? fallback : v;
      } catch (e) {
        return fallback;
      }
    }

    function write(key, value) {
      try { storage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota / unavailable */ }
    }

    function newId() {
      lastId = Math.max(lastId + 1, now().getTime());
      return String(lastId);
    }

    function readList(key) {
      const v = read(key, []);
      return Array.isArray(v) ? v : [];
    }

    const rawTasks = () => readList(KEYS.tasks);
    const rawSessions = () => readList(KEYS.sessions);
    const focusSessions = () => rawSessions().filter((s) => s.mode === 'focus');

    function getSettings() {
      return { ...DEFAULT_SETTINGS, ...cleanSettings(read(KEYS.settings, {})) };
    }

    /** Merge valid entries into saved settings; returns the full settings object. */
    function saveSettings(partial) {
      const next = { ...getSettings(), ...cleanSettings(partial) };
      write(KEYS.settings, next);
      return next;
    }

    /** Tasks in creation order, each with `actual` = focus sessions logged against it. */
    function listTasks() {
      const counts = {};
      focusSessions().forEach((s) => {
        if (s.task_id != null) counts[s.task_id] = (counts[s.task_id] || 0) + 1;
      });
      return rawTasks().map((t) => ({ ...t, actual: counts[t.id] || 0 }));
    }

    function addTask(text, estimate = 0) {
      const clean = typeof text === 'string' ? text.trim().slice(0, MAX_TASK_LENGTH) : '';
      if (!clean) return null;
      const est = Number.isInteger(estimate) ? Math.min(MAX_ESTIMATE, Math.max(0, estimate)) : 0;
      const task = { id: newId(), text: clean, completed: false, estimate: est, created_at: now().toISOString() };
      write(KEYS.tasks, rawTasks().concat(task));
      return task;
    }

    function updateTask(id, fields) {
      let found = false;
      const tasks = rawTasks().map((t) => {
        if (t.id !== id) return t;
        found = true;
        const next = { ...t };
        if (typeof fields.completed === 'boolean') next.completed = fields.completed;
        if (typeof fields.text === 'string' && fields.text.trim()) next.text = fields.text.trim().slice(0, MAX_TASK_LENGTH);
        if (Number.isInteger(fields.estimate)) next.estimate = Math.min(MAX_ESTIMATE, Math.max(0, fields.estimate));
        return next;
      });
      if (found) write(KEYS.tasks, tasks);
      return found;
    }

    function deleteTask(id) {
      const tasks = rawTasks();
      const kept = tasks.filter((t) => t.id !== id);
      if (kept.length !== tasks.length) write(KEYS.tasks, kept);
      return kept.length !== tasks.length;
    }

    function logSession({ mode = 'focus', duration_seconds = 1500, task_id = null } = {}) {
      if (!VALID_MODES.includes(mode)) return null;
      if (!Number.isInteger(duration_seconds) || duration_seconds < 1 || duration_seconds > MAX_SESSION_SECONDS) return null;
      const session = {
        id: newId(), mode, duration_seconds,
        completed_at: now().toISOString(),
        task_id: task_id == null ? null : String(task_id),
      };
      write(KEYS.sessions, rawSessions().concat(session));
      return session;
    }

    /** {dayKey: {seconds, count}} for focus sessions in local time. */
    function perDay() {
      const out = {};
      focusSessions().forEach((s) => {
        const key = localDayKey(new Date(s.completed_at));
        const d = out[key] || (out[key] = { seconds: 0, count: 0 });
        d.seconds += s.duration_seconds;
        d.count++;
      });
      return out;
    }

    /** Today, last 7 days, streak and totals. */
    function summary() {
      const today = now();
      const days = perDay();
      const daily = [];
      for (let i = 6; i >= 0; i--) {
        const d = addDays(today, -i);
        const key = localDayKey(d);
        daily.push({
          date: key,
          label: d.toLocaleDateString('en-US', { weekday: 'short' }),
          minutes: round1((days[key] ? days[key].seconds : 0) / 60),
        });
      }
      const t = days[localDayKey(today)] || { seconds: 0, count: 0 };
      const all = focusSessions();
      return {
        today_minutes: round1(t.seconds / 60),
        today_sessions: t.count,
        streak: computeStreak(Object.keys(days), today),
        total_sessions: all.length,
        total_minutes: round1(all.reduce((acc, s) => acc + s.duration_seconds, 0) / 60),
        daily_breakdown: daily,
      };
    }

    /** Focus time per task (top `limit` by minutes), including sessions with no/deleted task. */
    function taskStats(limit = TOP_TASKS_LIMIT) {
      const titles = {};
      rawTasks().forEach((t) => { titles[t.id] = t.text; });
      const groups = new Map();
      focusSessions().forEach((s) => {
        const g = groups.get(s.task_id) || { task_id: s.task_id, sessions: 0, seconds: 0 };
        g.sessions++;
        g.seconds += s.duration_seconds;
        groups.set(s.task_id, g);
      });
      return [...groups.values()]
        .sort((a, b) => b.seconds - a.seconds || String(a.task_id).localeCompare(String(b.task_id)))
        .slice(0, limit)
        .map((g) => ({
          task_id: g.task_id,
          label: g.task_id == null ? 'No task' : titles[g.task_id] || '(deleted task)',
          sessions: g.sessions,
          minutes: round1(g.seconds / 60),
        }));
    }

    /** Focus minutes per local day for the last `days` days, oldest first, zero-filled. */
    function heatmap(days = 84) {
      const today = now();
      const per = perDay();
      const out = [];
      for (let i = days - 1; i >= 0; i--) {
        const key = localDayKey(addDays(today, -i));
        const d = per[key] || { seconds: 0, count: 0 };
        out.push({ date: key, minutes: round1(d.seconds / 60), sessions: d.count });
      }
      return out;
    }

    /** Full session history as CSV text (local timestamps, task title resolved). */
    function sessionsCsv() {
      const titles = {};
      rawTasks().forEach((t) => { titles[t.id] = t.text; });
      const lines = [['id', 'mode', 'duration_seconds', 'completed_at_local', 'task_id', 'task'].join(',')];
      rawSessions().forEach((s) => {
        const d = new Date(s.completed_at);
        const local = `${localDayKey(d)} ${d.toTimeString().slice(0, 8)}`;
        const row = [s.id, s.mode, s.duration_seconds, local, s.task_id ?? '', titles[s.task_id] ?? ''];
        lines.push(row.map(csvCell).join(','));
      });
      return lines.join('\n') + '\n';
    }

    return {
      getSettings, saveSettings, listTasks, addTask, updateTask, deleteTask,
      logSession, summary, taskStats, heatmap, sessionsCsv,
    };
  }

  return { createStore, KEYS, DEFAULT_SETTINGS, localDayKey, computeStreak, csvSafe, cleanSettings };
});
