// Pomodoro Focus Dashboard - State, Timer, REST API, & Web Audio Integration

let config = {
  focus_duration: 25,
  short_break: 5,
  long_break: 15,
  long_break_interval: 4
};

let currentMode = 'focus';
let totalDuration = config.focus_duration * 60;
let timeLeft = totalDuration;
let timerId = null;
let isRunning = false;
let completedFocusCycles = 0;
let activeTaskId = null;

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

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updateDisplay() {
  const formatted = formatTime(timeLeft);
  timeDisplayEl.textContent = formatted;
  const modeTitle = currentMode === 'focus' ? 'Focus' : currentMode === 'shortBreak' ? 'Short Break' : 'Long Break';
  document.title = `${formatted} - ${modeTitle}`;

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

function startTimer() {
  if (isRunning) return;
  isRunning = true;
  setButtonState(true);

  timerId = setInterval(() => {
    if (timeLeft > 0) {
      timeLeft--;
      updateDisplay();
    } else {
      handleSessionComplete();
    }
  }, 1000);
}

function pauseTimer() {
  if (!isRunning) return;
  clearInterval(timerId);
  timerId = null;
  isRunning = false;
  setButtonState(false);
}

function resetTimer() {
  pauseTimer();
  timeLeft = totalDuration;
  modeStatusEl.textContent = currentMode === 'focus' ? 'Stay Focused' : 'Rest & Recharge';
  updateDisplay();
  setButtonState(false);
}

async function handleSessionComplete() {
  pauseTimer();
  modeStatusEl.textContent = 'Session Complete!';

  // Log session to backend
  if (currentMode === 'focus') {
    completedFocusCycles++;
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'focus',
          duration_seconds: totalDuration,
          task_id: activeTaskId
        })
      });
      loadStats();
    } catch (e) {
      console.error('Failed to log session', e);
    }

    // Auto-advance mode: check if long break is due
    if (completedFocusCycles % config.long_break_interval === 0) {
      switchMode('longBreak');
    } else {
      switchMode('shortBreak');
    }
  } else {
    switchMode('focus');
  }
}

function switchMode(newMode) {
  pauseTimer();
  currentMode = newMode;

  if (newMode === 'focus') {
    totalDuration = config.focus_duration * 60;
    modeStatusEl.textContent = 'Stay Focused';
  } else if (newMode === 'shortBreak') {
    totalDuration = config.short_break * 60;
    modeStatusEl.textContent = 'Rest & Recharge';
  } else if (newMode === 'longBreak') {
    totalDuration = config.long_break * 60;
    modeStatusEl.textContent = 'Long Refresh';
  }

  timeLeft = totalDuration;
  bodyEl.setAttribute('data-mode', newMode);

  tabButtons.forEach(btn => {
    if (btn.dataset.mode === newMode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  updateDisplay();
  setButtonState(false);
}

// Timer Controls Listeners
startBtnEl.addEventListener('click', () => {
  if (isRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
});

resetBtnEl.addEventListener('click', () => {
  resetTimer();
});

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const selectedMode = btn.dataset.mode;
    if (selectedMode !== currentMode) {
      switchMode(selectedMode);
    }
  });
});

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

function selectActiveTask(task) {
  if (activeTaskId === task.id) {
    activeTaskId = null;
    activeTaskPillEl.style.display = 'none';
  } else {
    activeTaskId = task.id;
    activeTaskPillEl.textContent = `🎯 ${task.text}`;
    activeTaskPillEl.style.display = 'block';
  }
  renderTasks();
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

async function loadStats() {
  try {
    const res = await fetch('/api/stats/summary');
    if (!res.ok) return;
    const stats = await res.json();

    todayFocusMinsEl.textContent = Math.round(stats.today_minutes);
    todaySessionsCountEl.textContent = stats.today_sessions;
    streakCountEl.textContent = stats.streak;

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
// Timer Preferences Modal
// ====================================================
const settingsModal = document.getElementById('settings-modal');
const openSettingsBtn = document.getElementById('open-settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const settingsForm = document.getElementById('settings-form');

const settingFocusInput = document.getElementById('setting-focus');
const settingShortInput = document.getElementById('setting-short');
const settingLongInput = document.getElementById('setting-long');
const settingIntervalInput = document.getElementById('setting-interval');

openSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.add('open');
  settingsModal.setAttribute('aria-hidden', 'false');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.remove('open');
  settingsModal.setAttribute('aria-hidden', 'true');
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.remove('open');
  }
});

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      config = { ...config, ...data };
      settingFocusInput.value = config.focus_duration;
      settingShortInput.value = config.short_break;
      settingLongInput.value = config.long_break;
      settingIntervalInput.value = config.long_break_interval;

      // Update current timer if not running
      if (!isRunning) {
        switchMode(currentMode);
      }
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
    long_break_interval: parseInt(settingIntervalInput.value, 10)
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    if (res.ok) {
      config = { ...config, ...updated };
      settingsModal.classList.remove('open');
      if (!isRunning) {
        switchMode(currentMode);
      }
    }
  } catch (err) {
    console.error('Failed to save settings', err);
  }
});

// Initialization
loadSettings();
fetchTasks();
loadStats();
updateDisplay();
