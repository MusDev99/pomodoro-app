// Unit tests for timer-core.js — run with `node --test tests/*.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../timer-core.js');

const config = { focus_duration: 25, short_break: 5, long_break: 15, long_break_interval: 4 };

test('modeDuration converts minutes to seconds per mode', () => {
  assert.equal(T.modeDuration('focus', config), 1500);
  assert.equal(T.modeDuration('shortBreak', config), 300);
  assert.equal(T.modeDuration('longBreak', config), 900);
});

test('remainingSeconds is wall-clock based and never negative', () => {
  assert.equal(T.remainingSeconds(10_000, 0), 10);
  assert.equal(T.remainingSeconds(10_000, 9_001), 1);   // rounds up partial seconds
  assert.equal(T.remainingSeconds(10_000, 10_000), 0);
  assert.equal(T.remainingSeconds(10_000, 99_999), 0);
});

test('a throttled timer catches up after a long gap (no drift)', () => {
  const start = 1_000_000;
  const endsAt = start + 1500 * 1000;
  // browser froze timers for 10 minutes, one tick fires
  assert.equal(T.remainingSeconds(endsAt, start + 600_000), 900);
});

test('nextMode: short breaks, long break every N focus cycles, break -> focus', () => {
  assert.equal(T.nextMode('focus', 1, 4), 'shortBreak');
  assert.equal(T.nextMode('focus', 3, 4), 'shortBreak');
  assert.equal(T.nextMode('focus', 4, 4), 'longBreak');
  assert.equal(T.nextMode('focus', 8, 4), 'longBreak');
  assert.equal(T.nextMode('focus', 1, 1), 'longBreak');
  assert.equal(T.nextMode('shortBreak', 1, 4), 'focus');
  assert.equal(T.nextMode('longBreak', 4, 4), 'focus');
});

test('snapshot/restore roundtrip for a paused timer', () => {
  const snap = T.snapshot({ mode: 'focus', running: false, timeLeft: 700, completedCycles: 2, activeTaskId: 't1' }, 5000);
  assert.equal(snap.endsAt, null);
  const r = T.restore(JSON.stringify(snap), 999_999, config);
  assert.deepEqual(r, { mode: 'focus', completedCycles: 2, activeTaskId: 't1', running: false, timeLeft: 700, expired: false });
});

test('restore keeps a running timer running with the right remaining time', () => {
  const snap = T.snapshot({ mode: 'shortBreak', running: true, timeLeft: 300, completedCycles: 1 }, 10_000);
  const r = T.restore(snap, 70_000, config); // 60s later
  assert.equal(r.running, true);
  assert.equal(r.timeLeft, 240);
  assert.equal(r.expired, false);
});

test('restore flags a timer that finished while the page was closed', () => {
  const snap = T.snapshot({ mode: 'focus', running: true, timeLeft: 60, completedCycles: 0 }, 0);
  const r = T.restore(snap, 120_000, config);
  assert.equal(r.expired, true);
  assert.equal(r.running, false);
});

test('restore rejects garbage and clamps out-of-range values', () => {
  assert.equal(T.restore(null, 0, config), null);
  assert.equal(T.restore('not json', 0, config), null);
  assert.equal(T.restore({ mode: 'nap' }, 0, config), null);
  const r = T.restore({ mode: 'focus', running: false, timeLeft: 99999, completedCycles: -3 }, 0, config);
  assert.equal(r.timeLeft, 1500);        // clamped to mode length (e.g. settings shrank)
  assert.equal(r.completedCycles, 0);
  assert.equal(T.restore({ mode: 'focus', running: false, timeLeft: 0 }, 0, config).timeLeft, 1500);
});

test('formatTime pads mm:ss', () => {
  assert.equal(T.formatTime(0), '00:00');
  assert.equal(T.formatTime(65), '01:05');
  assert.equal(T.formatTime(1500), '25:00');
  assert.equal(T.formatTime(5400), '90:00');
});

test('goalProgress caps at 100% and flags reached', () => {
  assert.deepEqual(T.goalProgress(1, 4), { done: 1, goal: 4, percent: 25, reached: false });
  assert.equal(T.goalProgress(4, 4).reached, true);
  assert.equal(T.goalProgress(9, 4).percent, 100);
  assert.equal(T.goalProgress(0, 0).goal, 1); // guards divide-by-zero
});

test('shortcutAction maps keys and ignores form fields', () => {
  const body = { tagName: 'BODY' };
  assert.equal(T.shortcutAction(' ', body), 'toggle');
  assert.equal(T.shortcutAction('r', body), 'reset');
  assert.equal(T.shortcutAction('R', body), 'reset');
  assert.equal(T.shortcutAction('1', body), 'focus');
  assert.equal(T.shortcutAction('2', body), 'shortBreak');
  assert.equal(T.shortcutAction('3', body), 'longBreak');
  assert.equal(T.shortcutAction('x', body), null);
  assert.equal(T.shortcutAction(' ', { tagName: 'INPUT' }), null);
  assert.equal(T.shortcutAction('r', { tagName: 'INPUT' }), null);
  assert.equal(T.shortcutAction('1', { tagName: 'TEXTAREA' }), null);
  assert.equal(T.shortcutAction(' ', { tagName: 'BUTTON' }), null); // native click handles space
  assert.equal(T.shortcutAction('r', { tagName: 'BUTTON' }), 'reset');
});
