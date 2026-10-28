// Unit tests for store.js — run with `node --test tests/*.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../store.js');

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    raw: data,
  };
}

/** Store with a controllable clock (local time). */
function makeStore(start = new Date(2026, 9, 28, 10, 0, 0)) {
  const clock = { t: start };
  const storage = memoryStorage();
  const store = S.createStore(storage, () => clock.t);
  return { store, storage, clock };
}

test('settings fall back to defaults and only keep valid values', () => {
  const { store } = makeStore();
  assert.deepEqual(store.getSettings(), S.DEFAULT_SETTINGS);
  const saved = store.saveSettings({ focus_duration: 50, short_break: 999, theme: 'neon', bogus: 1, auto_start: true });
  assert.equal(saved.focus_duration, 50);
  assert.equal(saved.short_break, 5);
  assert.equal(saved.theme, 'light');
  assert.equal(saved.auto_start, 1);
  assert.equal('bogus' in saved, false);
  assert.equal(store.getSettings().focus_duration, 50);
});

test('corrupt storage is ignored instead of crashing', () => {
  const { store, storage } = makeStore();
  storage.setItem(S.KEYS.tasks, '{not json');
  storage.setItem(S.KEYS.sessions, '"a string"');
  assert.deepEqual(store.listTasks(), []);
  assert.equal(store.summary().total_sessions, 0);
});

test('task CRUD trims text, clamps estimate and gives unique ids', () => {
  const { store } = makeStore();
  assert.equal(store.addTask('   '), null);
  const a = store.addTask('  Write report  ', 50);
  const b = store.addTask('x'.repeat(200), -3);
  assert.notEqual(a.id, b.id);
  assert.equal(a.text, 'Write report');
  assert.equal(a.estimate, 20);
  assert.equal(b.text.length, 80);
  assert.equal(b.estimate, 0);

  assert.equal(store.updateTask(a.id, { completed: true }), true);
  assert.equal(store.updateTask('missing', { completed: true }), false);
  assert.equal(store.listTasks()[0].completed, true);

  assert.equal(store.deleteTask(b.id), true);
  assert.equal(store.deleteTask(b.id), false);
  assert.deepEqual(store.listTasks().map((t) => t.id), [a.id]);
});

test('logSession validates input and counts focus sessions per task', () => {
  const { store } = makeStore();
  const t = store.addTask('Deep work', 3);
  assert.equal(store.logSession({ mode: 'nap' }), null);
  assert.equal(store.logSession({ duration_seconds: 0 }), null);
  store.logSession({ mode: 'focus', duration_seconds: 1500, task_id: t.id });
  store.logSession({ mode: 'focus', duration_seconds: 1500, task_id: t.id });
  store.logSession({ mode: 'shortBreak', duration_seconds: 300, task_id: t.id });
  assert.equal(store.listTasks()[0].actual, 2);
});

test('summary buckets by local day and computes the streak', () => {
  const { store, clock } = makeStore(new Date(2026, 9, 26, 9));
  store.logSession({ duration_seconds: 1500 });          // Mon
  clock.t = new Date(2026, 9, 27, 23, 30);
  store.logSession({ duration_seconds: 600 });           // Tue late evening
  clock.t = new Date(2026, 9, 28, 8);
  store.logSession({ duration_seconds: 1500 });          // Wed (today)
  store.logSession({ mode: 'longBreak', duration_seconds: 900 });

  const s = store.summary();
  assert.equal(s.today_sessions, 1);
  assert.equal(s.today_minutes, 25);
  assert.equal(s.streak, 3);
  assert.equal(s.total_sessions, 3);
  assert.equal(s.total_minutes, 60);
  assert.equal(s.daily_breakdown.length, 7);
  assert.equal(s.daily_breakdown[6].date, '2026-10-28');
  assert.equal(s.daily_breakdown[5].minutes, 10);
});

test('computeStreak counts from yesterday when today is empty, and stops at gaps', () => {
  const today = new Date(2026, 9, 28);
  assert.equal(S.computeStreak(['2026-10-27', '2026-10-26', '2026-10-24'], today), 2);
  assert.equal(S.computeStreak(['2026-10-25'], today), 0);
  assert.equal(S.computeStreak([], today), 0);
});

test('taskStats groups by task, labels missing tasks, sorts by minutes', () => {
  const { store } = makeStore();
  const a = store.addTask('A');
  const b = store.addTask('B');
  store.logSession({ duration_seconds: 600, task_id: a.id });
  store.logSession({ duration_seconds: 1800, task_id: b.id });
  store.logSession({ duration_seconds: 300 });
  store.deleteTask(a.id);
  const rows = store.taskStats();
  assert.deepEqual(rows.map((r) => r.label), ['B', '(deleted task)', 'No task']);
  assert.equal(rows[0].minutes, 30);
});

test('heatmap is zero-filled, oldest first, ending today', () => {
  const { store } = makeStore();
  store.logSession({ duration_seconds: 1200 });
  const days = store.heatmap(14);
  assert.equal(days.length, 14);
  assert.equal(days[13].date, '2026-10-28');
  assert.equal(days[13].minutes, 20);
  assert.equal(days[0].date, '2026-10-15');
  assert.equal(days[0].minutes, 0);
});

test('sessionsCsv escapes quotes/commas and neutralises formulas', () => {
  const { store } = makeStore();
  const t = store.addTask('=HYPERLINK("x"), evil');
  store.logSession({ duration_seconds: 1500, task_id: t.id });
  const lines = store.sessionsCsv().trim().split('\n');
  assert.equal(lines[0], 'id,mode,duration_seconds,completed_at_local,task_id,task');
  assert.match(lines[1], /,focus,1500,2026-10-28 10:00:00,/);
  assert.ok(lines[1].endsWith(`"'=HYPERLINK(""x""), evil"`));
});

test('data persists across store instances on the same storage', () => {
  const { store, storage } = makeStore();
  store.addTask('Keep me');
  const again = S.createStore(storage);
  assert.equal(again.listTasks()[0].text, 'Keep me');
});
