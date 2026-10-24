// Pomodoro Focus Dashboard - State, Timer, REST API, & Web Audio Integration
// Pure timer helpers live in timer-core.js (unit-tested).

const { modeDuration, remainingSeconds, nextMode, snapshot, restore, formatTime, goalProgress, shortcutAction, STORAGE_KEY } = window.TimerCore;

let config = {
  focus_duration: 25,
  short_break: 5,
  long_break: 15,
  long_break_interval: 4,
  auto_start: 0,
  daily_goal: 4,
  theme: 'light'
};

let currentMode = 'focus';
let totalDuration = modeDuration('focus', config);
let timeLeft = totalDuration;
let endsAt = null;
let timerId = null;
let isRunning = false;
let completedFocusCycles = 0;
let activeTaskId = null;
let todaySessions = 0;

// DOM Elements
const bodyEl = document.body;
const timeDisplayEl = document.getElementById('time-display');
const modeStatusEl = document.getElementById('mode-status');
const activeTaskPillEl = document.getElementById('active-task-pill');
const startBtnEl = document.getElementById('start-btn');
const startTextEl = document.getElementById('start-text');
const startIconEl = document.getElementById('start-icon');
const resetBtnEl = document.getElementById('reset-btn');
const tabButtons = document.querySelectorAll('.tab-btn');
const progressCircle = document.querySelector('.progress-ring-circle');

// Progress ring setup
const radius = progressCircle.r.baseVal.value;
const circumference = 2 * Math.PI * radius;
progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
progressCircle.style.strokeDashoffset = '0';

function setProgress(percent) {
  const offset = circumference - (percent / 100) * circumference;
  progressCircle.style.strokeDashoffset = offset;
}

function modeTitle(mode) {
  return mode === 'focus' ? 'Focus' : mode === 'shortBreak' ? 'Short Break' : 'Long Break';
}

function updateDisplay() {
  const formatted = formatTime(timeLeft);
  timeDisplayEl.textContent = formatted;
  document.title = `${formatted} - ${modeTitle(currentMode)}`;

  const percent = ((totalDuration - timeLeft) / totalDuration) * 100;
  setProgress(percent);
}

function setButtonState(running) {
  if (running) {
    startTextEl.textContent = 'Pause';
    startIconEl.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
    startBtnEl.classList.remove('paused');
  } else {
    startTextEl.textContent = 'Start';
    startIconEl.innerHTML = '<path d="M8 5v14l11-7z"/>';
    if (timeLeft < totalDuration && timeLeft > 0) {
      startBtnEl.classList.add('paused');
    } else {
      startBtnEl.classList.remove('paused');
    }
  }
}

// ---- Persistence: survive page refresh ----
function saveTimerState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot({
      mode: currentMode, running: isRunning, timeLeft, completedCycles: completedFocusCycles, activeTaskId
    }, Date.now())));
  } catch (e) { /* storage unavailable */ }
}

function tick() {
  timeLeft = remainingSeconds(endsAt, Date.now());
  updateDisplay();
  if (timeLeft <= 0) {
    handleSessionComplete();
  }
}

function startTimer() {
  if (isRunning) return;
  window.ambientSound.init(); // unlock audio on a user gesture so the end chime can play
  requestNotificationPermission();
  isRunning = true;
  endsAt = Date.now() + timeLeft * 1000;
  setButtonState(true);
  // Wall-clock based: ticking faster than 1s keeps the display accurate when throttled.
  timerId = setInterval(tick, 250);
  saveTimerState();
}

function pauseTimer() {
  if (!isRunning) return;
  clearInterval(timerId);
  timerId = null;
  timeLeft = remainingSeconds(endsAt, Date.now());
  endsAt = null;
  isRunning = false;
  setButtonState(false);
  saveTimerState();
}

function resetTimer() {
  pauseTimer();
  timeLeft = totalDuration;
  modeStatusEl.textContent = currentMode === 'focus' ? 'Stay Focused' : 'Rest & Recharge';
  updateDisplay();
  setButtonState(false);
  saveTimerState();
}

// ---- End-of-session alerts ----
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function notifySessionEnd(finishedMode, upcomingMode) {
  window.ambientSound.chime();
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(`${modeTitle(finishedMode)} complete`, {
        body: `Up next: ${modeTitle(upcomingMode)}`,
        tag: 'pomodoro-session-end'
      });
    } catch (e) { /* some browsers only allow notifications via service workers */ }
  }
}

async function handleSessionComplete() {
  pauseTimer();
  const finishedMode = currentMode;
  const finishedDuration = totalDuration;
  const finishedTaskId = activeTaskId;

  if (finishedMode === 'focus') completedFocusCycles++;
  const upcoming = nextMode(finishedMode, completedFocusCycles, config.long_break_interval);

  notifySessionEnd(finishedMode, upcoming);
  switchMode(upcoming);
  modeStatusEl.textContent = 'Session Complete!';
  if (config.auto_start) startTimer();
  saveTimerState();

  // Log focus session to backend
  if (finishedMode === 'focus') {
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'focus',
          duration_seconds: finishedDuration,
          task_id: finishedTaskId
        })
      });
      loadStats();
    } catch (e) {
      console.error('Failed to log session', e);
    }
  }
}

function switchMode(newMode) {
  pauseTimer();
  currentMode = newMode;
  totalDuration = modeDuration(newMode, config);
  modeStatusEl.textContent = newMode === 'focus' ? 'Stay Focused'
    : newMode === 'shortBreak' ? 'Rest & Recharge' : 'Long Refresh';

  timeLeft = totalDuration;
  bodyEl.setAttribute('data-mode', newMode);

  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === newMode);
  });

  updateDisplay();
  setButtonState(false);
  saveTimerState();
}

function toggleTimer() {
  if (isRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
}

// Timer Controls Listeners
startBtnEl.addEventListener('click', toggleTimer);
resetBtnEl.addEventListener('click', resetTimer);

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const selectedMode = btn.dataset.mode;
    if (selectedMode !== currentMode) {
      switchMode(selectedMode);
    }
  });
});

// Keyboard shortcuts: Space start/pause, R reset, 1/2/3 switch mode
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (settingsModal.classList.contains('open')) return;
  const action = shortcutAction(e.key, e.target);
  if (!action) return;
  e.preventDefault();
  if (action === 'toggle') toggleTimer();
  else if (action === 'reset') resetTimer();
  else if (action !== currentMode) switchMode(action);
});

// Recompute immediately when the tab becomes visible again
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isRunning) tick();
});

/** Restore a persisted timer after settings are loaded (durations depend on config). */
function restoreTimerState() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  const saved = restore(raw, Date.now(), config);
  if (!saved) {
    switchMode(currentMode); // apply configured durations
    return;
  }

  completedFocusCycles = saved.completedCycles;
  activeTaskId = saved.activeTaskId;
  switchMode(saved.mode);
  if (saved.expired) {
    timeLeft = 0;
    handleSessionComplete();
    return;
  }
  timeLeft = saved.timeLeft;
  updateDisplay();
  if (saved.running) startTimer(); else setButtonState(false);
}

// ====================================================
// Task Tracker (REST API & SQLite Integration)
// ====================================================
const taskFormEl = document.getElementById('task-form');
const taskInputEl = document.getElementById('task-input');
const taskListEl = document.getElementById('task-list');
const taskCounterEl = document.getElementById('task-counter');
const taskEmptyStateEl = document.getElementById('task-empty-state');

let tasks = [];

async function fetchTasks() {
  try {
    const res = await fetch('/api/tasks');
    if (res.ok) {
      tasks = await res.json();
      syncActiveTaskPill();
      renderTasks();
    }
  } catch (err) {
    console.error('Failed to load tasks', err);
  }
}

function updateTaskCounter() {
  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  taskCounterEl.textContent = `${completed}/${total}`;
  if (total === 0) {
    taskEmptyStateEl.classList.add('visible');
  } else {
    taskEmptyStateEl.classList.remove('visible');
  }
}

function renderTasks() {
  taskListEl.innerHTML = '';

  tasks.forEach((task) => {
    const li = document.createElement('li');
    li.className = `task-item ${task.completed ? 'completed' : ''} ${task.id === activeTaskId ? 'selected-task' : ''}`;
    li.dataset.id = task.id;

    // Checkbox button
    const checkBtn = document.createElement('button');
    checkBtn.className = 'task-checkbox-btn';
    checkBtn.type = 'button';
    checkBtn.setAttribute('aria-label', task.completed ? 'Mark incomplete' : 'Mark complete');
    checkBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
    checkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTask(task.id, !task.completed);
    });

    // Task text
    const textSpan = document.createElement('span');
    textSpan.className = 'task-text';
    textSpan.textContent = task.text;
    textSpan.addEventListener('click', () => selectActiveTask(task));

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'task-delete-btn';
    deleteBtn.type = 'button';
    deleteBtn.setAttribute('aria-label', 'Delete task');
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTask(task.id);
    });

    li.appendChild(checkBtn);
    li.appendChild(textSpan);
    li.appendChild(deleteBtn);
    taskListEl.appendChild(li);
  });

  updateTaskCounter();
}

function syncActiveTaskPill() {
  const task = tasks.find(t => t.id === activeTaskId);
  if (!task) {
    activeTaskId = null;
    activeTaskPillEl.style.display = 'none';
    return;
  }
  activeTaskPillEl.textContent = `🎯 ${task.text}`;
  activeTaskPillEl.style.display = 'block';
}

function selectActiveTask(task) {
  activeTaskId = activeTaskId === task.id ? null : task.id;
  syncActiveTaskPill();
  renderTasks();
  saveTimerState();
}

async function addTask(text) {
  const clean = text.trim();
  if (!clean) return;

  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean })
    });
    if (res.ok) {
      await fetchTasks();
    }
  } catch (err) {
    console.error('Failed to add task', err);
  }
}

async function toggleTask(id, completed) {
  try {
    await fetch(`/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed })
    });
    await fetchTasks();
  } catch (err) {
    console.error('Failed to toggle task', err);
  }
}

async function deleteTask(id) {
  if (activeTaskId === id) {
    activeTaskId = null;
    activeTaskPillEl.style.display = 'none';
  }
  try {
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    await fetchTasks();
  } catch (err) {
    console.error('Failed to delete task', err);
  }
}

taskFormEl.addEventListener('submit', (e) => {
  e.preventDefault();
  addTask(taskInputEl.value);
  taskInputEl.value = '';
});

// ====================================================
// Ambient Sound Controls
// ====================================================
const soundChips = document.querySelectorAll('.sound-chip');
const soundStatusPill = document.getElementById('sound-status-pill');
const ambientVolumeSlider = document.getElementById('ambient-volume');

soundChips.forEach(chip => {
  chip.addEventListener('click', () => {
    const soundType = chip.dataset.sound;
    const isNowPlaying = window.ambientSound.play(soundType);

    soundChips.forEach(c => c.classList.remove('active'));
    if (isNowPlaying) {
      chip.classList.add('active');
      soundStatusPill.textContent = 'Playing';
      soundStatusPill.classList.remove('muted');
    } else {
      soundStatusPill.textContent = 'Muted';
      soundStatusPill.classList.add('muted');
    }
  });
});

ambientVolumeSlider.addEventListener('input', (e) => {
  window.ambientSound.setVolume(parseFloat(e.target.value));
});

// ====================================================
// Focus Analytics
// ====================================================
const todayFocusMinsEl = document.getElementById('today-focus-mins');
const todaySessionsCountEl = document.getElementById('today-sessions-count');
const streakCountEl = document.getElementById('streak-count');
const weeklyTotalEl = document.getElementById('weekly-total');
const weeklyChartEl = document.getElementById('weekly-chart');

const goalTextEl = document.getElementById('goal-text');
const goalBarEl = document.getElementById('goal-bar-fill');
const goalTrackEl = document.getElementById('goal-bar');

function renderGoal() {
  const g = goalProgress(todaySessions, config.daily_goal);
  goalTextEl.textContent = g.reached ? `🎉 Goal reached! ${g.done}/${g.goal}` : `${g.done}/${g.goal} sessions`;
  goalBarEl.style.width = `${g.percent}%`;
  goalTrackEl.setAttribute('aria-valuenow', String(g.percent));
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats/summary');
    if (!res.ok) return;
    const stats = await res.json();

    todayFocusMinsEl.textContent = Math.round(stats.today_minutes);
    todaySessionsCountEl.textContent = stats.today_sessions;
    streakCountEl.textContent = stats.streak;
    todaySessions = stats.today_sessions;
    renderGoal();

    const weeklyMins = stats.daily_breakdown.reduce((acc, d) => acc + d.minutes, 0);
    const weeklyHours = (weeklyMins / 60).toFixed(1);
    weeklyTotalEl.textContent = `${weeklyHours}h total`;

    // Render bar chart
    renderChart(stats.daily_breakdown);
  } catch (err) {
    console.error('Failed to load stats', err);
  }
}

function renderChart(dailyData) {
  weeklyChartEl.innerHTML = '';
  const maxMins = Math.max(...dailyData.map(d => d.minutes), 60); // minimum scale 60m

  dailyData.forEach(day => {
    const col = document.createElement('div');
    col.className = 'chart-bar-col';

    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-fill-wrap';

    const bar = document.createElement('div');
    bar.className = 'chart-bar-fill';
    const percentHeight = Math.max(4, Math.round((day.minutes / maxMins) * 100));
    bar.style.height = `${percentHeight}%`;
    bar.title = `${day.label}: ${day.minutes} mins`;

    wrap.appendChild(bar);

    const label = document.createElement('span');
    label.className = 'chart-bar-label';
    label.textContent = day.label;

    col.appendChild(wrap);
    col.appendChild(label);
    weeklyChartEl.appendChild(col);
  });
}

// ====================================================
// Theme (light / dark)
// ====================================================
const themeToggleBtn = document.getElementById('theme-toggle-btn');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleBtn.setAttribute('aria-pressed', String(theme === 'dark'));
  try { localStorage.setItem('pomodoro-theme', theme); } catch (e) { /* ignore */ }
}

themeToggleBtn.addEventListener('click', async () => {
  const next = config.theme === 'dark' ? 'light' : 'dark';
  config.theme = next;
  applyTheme(next);
  try {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: next })
    });
  } catch (err) {
    console.error('Failed to save theme', err);
  }
});

// ====================================================
// Timer Preferences Modal (Esc to close, focus trap, focus restore)
// ====================================================
const settingsModal = document.getElementById('settings-modal');
const openSettingsBtn = document.getElementById('open-settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const settingsForm = document.getElementById('settings-form');

const settingFocusInput = document.getElementById('setting-focus');
const settingShortInput = document.getElementById('setting-short');
const settingLongInput = document.getElementById('setting-long');
const settingIntervalInput = document.getElementById('setting-interval');
const settingGoalInput = document.getElementById('setting-goal');
const settingAutoStartInput = document.getElementById('setting-autostart');

let lastFocusedBeforeModal = null;

function openSettings() {
  lastFocusedBeforeModal = document.activeElement;
  settingsModal.classList.add('open');
  settingsModal.setAttribute('aria-hidden', 'false');
  settingFocusInput.focus();
}

function closeSettings() {
  settingsModal.classList.remove('open');
  settingsModal.setAttribute('aria-hidden', 'true');
  if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) lastFocusedBeforeModal.focus();
}

openSettingsBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', closeSettings);

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

settingsModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSettings();
    return;
  }
  if (e.key !== 'Tab') return;
  const focusable = settingsModal.querySelectorAll('button, input, select, [href], [tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

function fillSettingsForm() {
  settingFocusInput.value = config.focus_duration;
  settingShortInput.value = config.short_break;
  settingLongInput.value = config.long_break;
  settingIntervalInput.value = config.long_break_interval;
  settingGoalInput.value = config.daily_goal;
  settingAutoStartInput.checked = Boolean(config.auto_start);
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      config = { ...config, ...data };
      fillSettingsForm();
      applyTheme(config.theme);
      renderGoal();
    }
  } catch (err) {
    console.error('Failed to load settings', err);
  }
}

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const updated = {
    focus_duration: parseInt(settingFocusInput.value, 10),
    short_break: parseInt(settingShortInput.value, 10),
    long_break: parseInt(settingLongInput.value, 10),
    long_break_interval: parseInt(settingIntervalInput.value, 10),
    daily_goal: parseInt(settingGoalInput.value, 10),
    auto_start: settingAutoStartInput.checked ? 1 : 0
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    if (res.ok) {
      config = { ...config, ...updated };
      closeSettings();
      renderGoal();
      if (!isRunning) {
        switchMode(currentMode);
      }
    }
  } catch (err) {
    console.error('Failed to save settings', err);
  }
});

// Initialization: settings first (durations depend on them), then restore the timer
(async function init() {
  updateDisplay();
  await Promise.all([loadSettings(), fetchTasks(), loadStats()]);
  restoreTimerState();
})();
