// ---------- CONFIG ----------
const API_URL = 'https://script.google.com/macros/s/AKfycbyX6N102QHuhZoHGKIipl81DWO9lDIc-TtVm8g3_Pv2vybzKmDBjeVi4i0BdQg8dynsVw/exec';

const AUTO_REFRESH_MS = 2 * 60 * 1000;
const WEATHER_REFRESH_MS = 15 * 60 * 1000; // weather changes slowly — 15 min is plenty
// Shared Drive folder of signed delivery receipts — the receipts icon
// just opens this link in a new tab, nothing fancier (no Drive API wired
// up, so no in-app file listing).
const RECEIPTS_FOLDER_URL = 'https://drive.google.com/drive/folders/14DWq8DSOMLxWztqyz8QwgpJrNpHVZn50?usp=sharing';
const AUTH_STORAGE_KEY = 'inboundTrackerAuth';        // { pin, name, role }
const QUEUE_STORAGE_KEY = 'inboundTrackerQueue';      // [{ action, authPin, queuedAt }]
const NOTIFY_STORAGE_KEY = 'inboundTrackerNotifyOn';  // 'true' | 'false'
const NOTIFIED_STORAGE_KEY = 'inboundTrackerNotified'; // { date: 'MM/dd/yyyy', keys: [...] }

// ---------- STATE ----------
let state = {
  locations: [],
  activeLocation: null,
  selectedDate: toApiDateString(new Date()), // 'MM/dd/yyyy', or 'ALL'
  pendingAction: null, // action to run automatically once sign-in succeeds
  adminDate: toApiDateString(new Date()),
  adminView: 'activity',
  editingStaffOriginalName: null,
  pendingDockLoad: null, // the load waiting on the dock modal before Mark Arrived fires
  activeMessageLoad: null // the load whose thread the messages sheet is showing
};

// ---------- DOM ----------
const locationTabsEl = document.getElementById('locationTabs');
const dateChipsEl = document.getElementById('dateChips');
const datePickerEl = document.getElementById('datePicker');
const progressBarEl = document.getElementById('progressBar');
const loadListEl = document.getElementById('loadList');
const emptyStateEl = document.getElementById('emptyState');
const lastUpdatedEl = document.getElementById('lastUpdated');
const userGreetingEl = document.getElementById('userGreeting');
const weatherPillEl = document.getElementById('weatherPill');
const notifyChipEl = document.getElementById('notifyChip');

const refreshBtn = document.getElementById('refreshBtn');
const reportBtn = document.getElementById('reportBtn');
const userBtn = document.getElementById('userBtn');
const searchBtn = document.getElementById('searchBtn');
const adminBtn = document.getElementById('adminBtn');
const receiptsBtn = document.getElementById('receiptsBtn');

const detailSheet = document.getElementById('detailSheet');
const sheetContent = document.getElementById('sheetContent');
const sheetCloseBtn = document.getElementById('sheetCloseBtn');

const searchSheet = document.getElementById('searchSheet');
const searchInput = document.getElementById('searchInput');
const searchResultsEl = document.getElementById('searchResults');
const searchCloseBtn = document.getElementById('searchCloseBtn');

const adminSheet = document.getElementById('adminSheet');
const adminTabActivity = document.getElementById('adminTabActivity');
const adminTabStaff = document.getElementById('adminTabStaff');
const adminActivityView = document.getElementById('adminActivityView');
const adminStaffView = document.getElementById('adminStaffView');
const adminDateChipsEl = document.getElementById('adminDateChips');
const adminHistoryListEl = document.getElementById('adminHistoryList');
const staffListEl = document.getElementById('staffList');
const addStaffBtn = document.getElementById('addStaffBtn');
const adminCloseBtn = document.getElementById('adminCloseBtn');

const staffModal = document.getElementById('staffModal');
const staffModalTitle = document.getElementById('staffModalTitle');
const staffNameInput = document.getElementById('staffNameInput');
const staffPinInput = document.getElementById('staffPinInput');
const staffAdminCheckbox = document.getElementById('staffAdminCheckbox');
const staffActiveCheckbox = document.getElementById('staffActiveCheckbox');
const staffModalError = document.getElementById('staffModalError');
const staffCancelBtn = document.getElementById('staffCancelBtn');
const staffSaveBtn = document.getElementById('staffSaveBtn');

const signInModal = document.getElementById('signInModal');
const signInPinInput = document.getElementById('signInPinInput');
const signInError = document.getElementById('signInError');
const signInCancel = document.getElementById('signInCancel');
const signInConfirm = document.getElementById('signInConfirm');

const dockModal = document.getElementById('dockModal');
const dockInput = document.getElementById('dockInput');
const dockSkipBtn = document.getElementById('dockSkipBtn');
const dockConfirmBtn = document.getElementById('dockConfirmBtn');

const messagesSheet = document.getElementById('messagesSheet');
const messagesTitle = document.getElementById('messagesTitle');
const messagesSubtitle = document.getElementById('messagesSubtitle');
const messagesList = document.getElementById('messagesList');
const messageInput = document.getElementById('messageInput');
const messageSendBtn = document.getElementById('messageSendBtn');
const messagesCloseBtn = document.getElementById('messagesCloseBtn');

const toastEl = document.getElementById('toast');

// ---------- INIT ----------
refreshBtn.addEventListener('click', () => loadData(true));
reportBtn.addEventListener('click', () => runGatedAction({ type: 'sendReport', payload: {} }));
userBtn.addEventListener('click', switchUser);
searchBtn.addEventListener('click', openSearchSheet);
adminBtn.addEventListener('click', openAdminSheet);
receiptsBtn.addEventListener('click', () => window.open(RECEIPTS_FOLDER_URL, '_blank', 'noopener'));
datePickerEl.addEventListener('change', onDatePicked);
notifyChipEl.addEventListener('click', toggleNotifications);

sheetCloseBtn.addEventListener('click', closeSheet);
detailSheet.addEventListener('click', (e) => { if (e.target === detailSheet) closeSheet(); });

searchCloseBtn.addEventListener('click', closeSearchSheet);
searchSheet.addEventListener('click', (e) => { if (e.target === searchSheet) closeSearchSheet(); });

dockSkipBtn.addEventListener('click', () => confirmMarkArrived(''));
dockConfirmBtn.addEventListener('click', () => confirmMarkArrived(dockInput.value.trim()));
dockModal.addEventListener('click', (e) => { if (e.target === dockModal) closeDockModal(); });

messagesCloseBtn.addEventListener('click', closeMessagesSheet);
messagesSheet.addEventListener('click', (e) => { if (e.target === messagesSheet) closeMessagesSheet(); });
messageSendBtn.addEventListener('click', sendMessageFromInput);
messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessageFromInput(); });
searchInput.addEventListener('input', debounce(runSearch, 300));

adminCloseBtn.addEventListener('click', closeAdminSheet);
adminSheet.addEventListener('click', (e) => { if (e.target === adminSheet) closeAdminSheet(); });
adminTabActivity.addEventListener('click', () => setAdminView('activity'));
adminTabStaff.addEventListener('click', () => setAdminView('staff'));
addStaffBtn.addEventListener('click', () => openStaffModal(null));

staffCancelBtn.addEventListener('click', closeStaffModal);
staffSaveBtn.addEventListener('click', confirmStaffSave);

signInCancel.addEventListener('click', closeSignInModal);
signInConfirm.addEventListener('click', confirmSignIn);
signInPinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmSignIn(); });

window.addEventListener('online', flushQueue);
window.addEventListener('resize', debounce(updateStickyOffsets, 150));

renderGreeting();
renderNotifyChip();
renderDateBar();
flushQueue().then(() => loadData(false));
loadWeather();
updateStickyOffsets();
setInterval(() => loadData(false), AUTO_REFRESH_MS);
setInterval(loadWeather, WEATHER_REFRESH_MS);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// Sticky bars are stacked (topbar > location tabs > date bar). Rather than
// hardcode pixel offsets that break on notched phones or larger text
// settings, measure the real rendered heights and feed them back in as
// CSS variables the stylesheet's sticky `top` values reference.
function updateStickyOffsets() {
  const topbarEl = document.querySelector('.topbar');
  const tabsEl = document.querySelector('.tabs');
  if (topbarEl) document.documentElement.style.setProperty('--topbar-h', topbarEl.offsetHeight + 'px');
  if (tabsEl) document.documentElement.style.setProperty('--tabs-h', tabsEl.offsetHeight + 'px');
}

// ---------- DATE HELPERS ----------
function pad2(n) { return n < 10 ? '0' + n : String(n); }

function toApiDateString(d) {
  return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + '/' + d.getFullYear();
}

function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function shortLabel(d) {
  return (d.getMonth() + 1) + '/' + d.getDate();
}

function buildQuickChips(selectedKey) {
  const today = new Date();
  return [
    { key: toApiDateString(addDays(today, -1)), label: 'Yesterday ' + shortLabel(addDays(today, -1)) },
    { key: toApiDateString(today), label: 'Today ' + shortLabel(today) },
    { key: toApiDateString(addDays(today, 1)), label: 'Tomorrow ' + shortLabel(addDays(today, 1)) },
    { key: 'ALL', label: 'All Days' }
  ].map((c) => ({ ...c, active: c.key === selectedKey }));
}

// ---------- DATE BAR (main list) ----------
function renderDateBar() {
  dateChipsEl.innerHTML = '';
  buildQuickChips(state.selectedDate).forEach((chip) => {
    const btn = document.createElement('button');
    btn.className = 'date-chip' + (chip.active ? ' active' : '');
    btn.textContent = chip.label;
    btn.addEventListener('click', () => setSelectedDate(chip.key));
    dateChipsEl.appendChild(btn);
  });

  if (state.selectedDate !== 'ALL') {
    const [m, d, y] = state.selectedDate.split('/');
    datePickerEl.value = y + '-' + pad2(Number(m)) + '-' + pad2(Number(d));
  } else {
    datePickerEl.value = '';
  }
}

function setSelectedDate(dateKey) {
  state.selectedDate = dateKey;
  renderDateBar();
  loadData(false);
}

function onDatePicked(e) {
  const val = e.target.value; // yyyy-mm-dd
  if (!val) return;
  const [y, m, d] = val.split('-').map(Number);
  setSelectedDate(pad2(m) + '/' + pad2(d) + '/' + y);
}

// ---------- AUTH (sign in once per device, PIN identifies the person) ----------
function getAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveAuth(auth) {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  } catch (e) { /* ignore — worst case, they sign in again next time */ }
}

function clearAuth() {
  try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch (e) {}
}

function renderGreeting() {
  const auth = getAuth();
  if (auth && auth.name) {
    userGreetingEl.textContent = 'Hi, ' + auth.name;
    userGreetingEl.classList.remove('hidden');
  } else {
    userGreetingEl.textContent = '';
    userGreetingEl.classList.add('hidden');
  }
  adminBtn.classList.toggle('hidden', !(auth && auth.role === 'admin'));
  updateStickyOffsets();
}

function switchUser() {
  clearAuth();
  renderGreeting();
  closeAdminSheet();
  showToast('Signed out', false);
  openSignInModal({ type: 'noop', payload: {} });
}

/**
 * Runs a PIN-gated action (mark arrived, undo, send report, admin
 * actions). If this device already has a saved PIN, it fires
 * immediately — no modal, no typing, so it doesn't slow anyone down.
 * Only asks for a PIN the first time, or again if the server ever
 * rejects a saved PIN (e.g. it was deactivated or changed).
 */
// ---------- DOCK ASSIGNMENT ----------
// A quick, optional stop before Mark Arrived actually fires — free text so
// it works the same at a 2-door location and a 175-dock one. "Skip" keeps
// this as fast as before for locations that don't care about dock numbers.
function openDockModal(load) {
  state.pendingDockLoad = load;
  dockInput.value = '';
  dockModal.classList.remove('hidden');
  setTimeout(() => dockInput.focus(), 50);
}

function closeDockModal() {
  dockModal.classList.add('hidden');
  state.pendingDockLoad = null;
}

function confirmMarkArrived(dock) {
  const load = state.pendingDockLoad;
  if (!load) return;
  closeDockModal();
  runGatedAction({
    type: 'markArrived',
    payload: {
      location: load.location,
      bol: load.inboundBol,
      carrier: load.carrier,
      project: load.project,
      palletGroupId: load.palletGroupId,
      pallets: load.pallets,
      inboundScheduled: load.inboundScheduled,
      appointmentTime: load.appointmentTime,
      inboundNotes: load.inboundNotes,
      dock: dock
    }
  });
}

async function runGatedAction(action) {
  const auth = getAuth();
  if (!auth) {
    openSignInModal(action);
    return;
  }
  await performAction(action, auth);
}

async function performAction(action, auth) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: action.type,
        authPin: auth.pin,
        ...action.payload
      })
    });
    const json = await res.json();

    if (!json.ok) {
      if (json.error === 'Invalid PIN') {
        clearAuth();
        renderGreeting();
        showToast('PIN no longer valid — please sign in again', false);
        openSignInModal(action);
      } else {
        showToast(json.error || 'Action failed', false);
      }
      return null;
    }

    if (action.type !== 'sendMessage') closeSheet();
    if (action.type === 'sendReport') {
      showToast('Report sent', false);
    } else if (action.type === 'markArrived' || action.type === 'unmarkArrived') {
      showToast(action.type === 'markArrived' ? 'Marked arrived' : 'Arrival undone', false);
      if (action.type === 'markArrived') vibrate();
      await loadData(false);
    }
    return json;
  } catch (err) {
    // Likely offline (spotty dock wifi). For check-in actions, queue it
    // and update the screen optimistically so the warehouse team isn't blocked;
    // it'll sync automatically once the connection comes back. Admin
    // actions (staff/history) just fail with a clear message instead —
    // those aren't worth the complexity of queuing.
    if (action.type === 'markArrived' || action.type === 'unmarkArrived') {
      queueAction(action, auth);
      applyOptimisticUpdate(action, auth);
      showToast('Saved offline — will sync automatically', true);
      if (action.type === 'markArrived') vibrate();
    } else {
      showToast('Network error — try again', false);
    }
    return null;
  }
}

function vibrate() {
  try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
}

function applyOptimisticUpdate(action, auth) {
  const { location, bol } = action.payload;
  state.locations.forEach((locGroup) => {
    if (locGroup.location !== location) return;
    locGroup.loads.forEach((load) => {
      if (String(load.inboundBol) !== String(bol)) return;
      if (action.type === 'markArrived') {
        load.arrived = true;
        load.arrivedAt = new Date().toISOString();
        load.markedBy = auth.name;
        load.arrivedDock = action.payload.dock || null;
      } else {
        load.arrived = false;
        load.arrivedAt = null;
        load.markedBy = null;
        load.arrivedDock = null;
      }
    });
  });
  renderTabs();
  renderLoadList();
}

// ---------- OFFLINE QUEUE ----------
function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveQueue(queue) {
  try { localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue)); } catch (e) {}
}

function queueAction(action, auth) {
  const queue = getQueue();
  queue.push({ action, authPin: auth.pin, queuedAt: Date.now() });
  saveQueue(queue);
}

async function flushQueue() {
  const queue = getQueue();
  if (queue.length === 0) return;

  const remaining = [];
  for (const item of queue) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: item.action.type,
          authPin: item.authPin,
          ...item.action.payload
        })
      });
      const json = await res.json();
      if (!json.ok) remaining.push(item); // e.g. PIN deactivated since queuing
    } catch (err) {
      remaining.push(item); // still offline — try again next time
    }
  }

  saveQueue(remaining);
  const synced = queue.length - remaining.length;
  if (synced > 0) showToast(synced + ' queued update' + (synced > 1 ? 's' : '') + ' synced', false);
}

// ---------- SIGN-IN MODAL ----------
function openSignInModal(action) {
  state.pendingAction = action;
  signInPinInput.value = '';
  signInError.classList.add('hidden');
  signInModal.classList.remove('hidden');
  setTimeout(() => signInPinInput.focus(), 50);
}

function closeSignInModal() {
  signInModal.classList.add('hidden');
  state.pendingAction = null;
}

async function confirmSignIn() {
  const pin = signInPinInput.value.trim();
  if (!pin) {
    signInError.textContent = 'Enter your PIN';
    signInError.classList.remove('hidden');
    return;
  }

  signInConfirm.disabled = true;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'verifyPin', authPin: pin })
    });
    const json = await res.json();

    if (!json.ok) {
      signInError.textContent = 'Incorrect PIN';
      signInError.classList.remove('hidden');
      signInConfirm.disabled = false;
      return;
    }

    const auth = { pin, name: json.name, role: json.role };
    saveAuth(auth);
    renderGreeting();

    const action = state.pendingAction;
    closeSignInModal();

    if (action && action.type !== 'noop') {
      const result = await performAction(action, auth);
      if (action.type === 'sendMessage' && result && result.ok) {
        messageInput.value = '';
        if (state.activeMessageLoad) {
          state.activeMessageLoad.messageCount = (state.activeMessageLoad.messageCount || 0) + 1;
          await loadMessagesThread();
          renderLoadList();
        }
      }
    } else {
      showToast('Signed in as ' + auth.name, false);
    }
  } catch (err) {
    signInError.textContent = 'Network error — try again';
    signInError.classList.remove('hidden');
  } finally {
    signInConfirm.disabled = false;
  }
}

// ---------- WEATHER ----------
async function loadWeather() {
  try {
    const res = await fetch(API_URL + '?action=weather', { cache: 'no-store' });
    const json = await res.json();
    if (!json.ok) return;

    weatherPillEl.textContent = json.emoji + ' ' + json.tempF + '°F · Fort Smith';
    weatherPillEl.classList.remove('hidden');
    updateStickyOffsets();
  } catch (err) {
    // Weather is a nice-to-have — fail silently.
  }
}

// ---------- NOTIFICATIONS (overdue loads) ----------
// Fires a Notification while this app is open (foreground or a
// background tab) the moment a load crosses into "late". This is NOT
// push in the sense of waking a fully-closed app/phone — that would
// need a service like Firebase Cloud Messaging. See README.
function notificationsEnabled() {
  try { return localStorage.getItem(NOTIFY_STORAGE_KEY) === 'true'; } catch (e) { return false; }
}

function renderNotifyChip() {
  const on = notificationsEnabled() && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  notifyChipEl.textContent = '🔔 Alerts: ' + (on ? 'On' : 'Off');
  notifyChipEl.classList.toggle('notify-on', on);
}

async function toggleNotifications() {
  if (typeof Notification === 'undefined') {
    showToast('Notifications aren\'t supported in this browser', false);
    return;
  }

  const currentlyOn = notificationsEnabled() && Notification.permission === 'granted';
  if (currentlyOn) {
    localStorage.setItem(NOTIFY_STORAGE_KEY, 'false');
    renderNotifyChip();
    showToast('Overdue alerts turned off', false);
    return;
  }

  if (Notification.permission === 'denied') {
    showToast('Notifications are blocked for this site in your browser settings', false);
    return;
  }

  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') {
    showToast('Notifications need permission to work', false);
    return;
  }

  localStorage.setItem(NOTIFY_STORAGE_KEY, 'true');
  renderNotifyChip();
  showToast('Overdue alerts on — keep this app open to receive them', false);
}

function getNotifiedState() {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTIFIED_STORAGE_KEY) || 'null');
    const today = toApiDateString(new Date());
    if (!raw || raw.date !== today) return { date: today, keys: [] }; // reset daily
    return raw;
  } catch (e) {
    return { date: toApiDateString(new Date()), keys: [] };
  }
}

function saveNotifiedState(s) {
  try { localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
}

/**
 * Called after every data refresh. Diffs the current overdue set against
 * what's already been notified today and fires a Notification for any
 * newly-overdue load, across ALL locations (not just the one currently
 * being viewed).
 */
function checkOverdueNotifications() {
  if (!notificationsEnabled() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!isToday()) return; // "late" only means anything for today's view

  const notified = getNotifiedState();
  const notifiedSet = new Set(notified.keys);
  let didNotify = false;

  state.locations.forEach((locGroup) => {
    locGroup.loads.forEach((load) => {
      if (!isOverdue(load)) return;
      const key = load.location + '::' + load.inboundBol;
      if (notifiedSet.has(key)) return;

      try {
        new Notification('Late: BOL ' + load.inboundBol, {
          body: load.location + ' · scheduled ' + (load.appointmentTime || '') +
            ' · ' + (load.carrier || 'Carrier TBD') + ' hasn\'t checked in',
          tag: key
        });
      } catch (e) { /* ignore — some browsers restrict Notification() outside a SW */ }

      notifiedSet.add(key);
      didNotify = true;
    });
  });

  if (didNotify) saveNotifiedState({ date: notified.date, keys: Array.from(notifiedSet) });
}

// ---------- DATA LOADING ----------
async function loadData(isManualRefresh) {
  try {
    const url = API_URL + '?action=data&date=' + encodeURIComponent(state.selectedDate);
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Failed to load data');

    state.locations = json.locations;
    if (!state.activeLocation && state.locations.length > 0) {
      state.activeLocation = state.locations[0].location;
    }

    renderTabs();
    renderLoadList();
    checkOverdueNotifications();

    const queueCount = getQueue().length;
    lastUpdatedEl.textContent = 'Updated ' + formatNow() + (queueCount > 0 ? ' · ' + queueCount + ' queued' : '');
    if (isManualRefresh) showToast('Refreshed', false);
  } catch (err) {
    if (isManualRefresh) showToast('Refresh failed — check connection', false);
    console.error(err);
    if (state.locations.length === 0) {
      emptyStateEl.textContent = 'Could not load data. Pull down or tap refresh to retry.';
    }
  }
}

function formatNow() {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ---------- RENDER: TABS ----------
function renderTabs() {
  locationTabsEl.innerHTML = '';
  state.locations.forEach((loc) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (loc.location === state.activeLocation ? ' active' : '');
    const pendingCount = loc.loads.filter((l) => !l.arrived).length;
    btn.textContent = loc.location + (pendingCount > 0 ? ' (' + pendingCount + ')' : '');
    btn.addEventListener('click', () => {
      state.activeLocation = loc.location;
      renderTabs();
      renderLoadList();
    });
    locationTabsEl.appendChild(btn);
  });
  renderProgressBar();
}

// ---------- RENDER: PROGRESS BAR ----------
function renderProgressBar() {
  const active = state.locations.find((l) => l.location === state.activeLocation);
  if (!active || active.loads.length === 0) {
    progressBarEl.innerHTML = '';
    progressBarEl.style.display = 'none';
    return;
  }

  // Cancelled loads stay visible in the list (below) but don't count
  // toward the day's total — they were never going to arrive.
  const countable = active.loads.filter((l) => !(l.change && l.change.type === 'CANCELLED'));
  const total = countable.length;
  const arrivedCount = countable.filter((l) => l.arrived).length;
  if (total === 0) {
    progressBarEl.innerHTML = '';
    progressBarEl.style.display = 'none';
    return;
  }
  const pct = Math.round((arrivedCount / total) * 100);

  progressBarEl.style.display = 'flex';
  progressBarEl.innerHTML = `
    <span>${arrivedCount} / ${total} arrived</span>
    <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    <span>${pct}%</span>
  `;
}

// ---------- RENDER: LOAD LIST ----------
function isToday() {
  return state.selectedDate === toApiDateString(new Date());
}

function isOverdue(load) {
  if (load.arrived) return false;
  if (load.change) return false; // rescheduled/delayed/cancelled loads aren't "no-shows"
  if (!isToday()) return false;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return parseTimeToMinutes(load.appointmentTime) < nowMinutes;
}

function renderLoadList() {
  const active = state.locations.find((l) => l.location === state.activeLocation);
  loadListEl.innerHTML = '';

  if (!active || active.loads.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = state.selectedDate === 'ALL'
      ? 'No inbound loads for this location.'
      : 'No inbound loads scheduled for this date.';
    loadListEl.appendChild(empty);
    return;
  }

  // Straight chronological order — all the 7am loads, then all the 8am
  // loads, and so on, regardless of arrived/late/flagged status. Those
  // are still called out with pills/badges on each card; they just don't
  // reshuffle the list anymore.
  const sorted = [...active.loads].sort((a, b) => {
    const dateCmp = String(a.inboundScheduled).localeCompare(String(b.inboundScheduled));
    if (dateCmp !== 0) return dateCmp;
    return compareTimeStrings(a.appointmentTime, b.appointmentTime);
  });

  sorted.forEach((load) => loadListEl.appendChild(renderLoadCard(load)));
}

function compareTimeStrings(a, b) {
  return parseTimeToMinutes(a) - parseTimeToMinutes(b);
}

function parseTimeToMinutes(str) {
  if (!str) return 9999;
  const m = String(str).match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!m) return 9999;
  let hour = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return hour * 60 + min;
}

function renderLoadCard(load) {
  const card = document.createElement('div');
  card.className = 'load-card' + (load.arrived ? ' arrived' : '');

  const top = document.createElement('div');
  top.className = 'load-card-top';

  const timeBlock = document.createElement('div');
  timeBlock.innerHTML = `
    <div class="load-time">${escapeHtml(load.appointmentTime || '—')}</div>
    <div class="load-date">${escapeHtml(load.inboundScheduled || '')}</div>
  `;

  const pill = document.createElement('div');
  const overdue = isOverdue(load);
  if (load.change && !load.arrived) {
    const changeLabels = { RESCHEDULED: 'Rescheduled', DELAYED: 'Delayed', CANCELLED: 'Cancelled' };
    pill.className = 'change-badge ' + load.change.type.toLowerCase();
    pill.textContent = changeLabels[load.change.type] || load.change.type;
  } else {
    pill.className = 'status-pill ' + (load.arrived ? 'arrived' : (overdue ? 'late' : 'pending'));
    pill.textContent = load.arrived ? 'Arrived' : (overdue ? 'Late' : 'Pending');
  }

  const topRight = document.createElement('div');
  topRight.className = 'load-card-top-right';
  topRight.appendChild(pill);

  const messageBtn = document.createElement('button');
  messageBtn.className = 'message-chip';
  messageBtn.innerHTML = '💬 Message' + (load.messageCount > 0 ? ' <span>' + load.messageCount + '</span>' : '');
  messageBtn.title = 'Messages';
  messageBtn.addEventListener('click', (e) => { e.stopPropagation(); openMessagesSheet(load); });
  topRight.appendChild(messageBtn);

  top.appendChild(timeBlock);
  top.appendChild(topRight);

  const bol = document.createElement('div');
  bol.className = 'load-bol';
  bol.textContent = 'BOL ' + load.inboundBol;
  bol.addEventListener('click', () => openDetailSheet(load));

  const meta = document.createElement('div');
  meta.className = 'load-meta';
  meta.innerHTML = `
    <span><b>${escapeHtml(load.carrier || 'Carrier TBD')}</b></span>
    <span>${escapeHtml(load.pallets || '')} pallets</span>
    <span>${escapeHtml(load.project || '')}</span>
  `;

  card.appendChild(top);
  card.appendChild(bol);
  card.appendChild(meta);

  if (load.change) {
    const changeDetail = document.createElement('div');
    changeDetail.className = 'change-detail';
    changeDetail.textContent = formatChangeDetailText(load.change);
    card.appendChild(changeDetail);
  }

  if (load.arrived && load.arrivedDock) {
    const dockChip = document.createElement('div');
    dockChip.className = 'dock-chip';
    dockChip.textContent = 'Dock ' + load.arrivedDock;
    card.appendChild(dockChip);
  }

  if (load.inboundNotes) {
    const notes = document.createElement('div');
    notes.className = 'load-notes';
    notes.textContent = load.inboundNotes;
    card.appendChild(notes);
  }

  const actions = document.createElement('div');
  actions.className = 'load-actions';

  if (load.arrived) {
    const undoBtn = document.createElement('button');
    undoBtn.className = 'btn btn-unarrive';
    undoBtn.textContent = 'Undo (arrived ' + formatArrivedAt(load.arrivedAt) + ')';
    undoBtn.addEventListener('click', () => runGatedAction(
      { type: 'unmarkArrived', payload: { location: load.location, bol: load.inboundBol } }
    ));
    actions.appendChild(undoBtn);
  } else {
    const arriveBtn = document.createElement('button');
    arriveBtn.className = 'btn btn-arrive';
    arriveBtn.textContent = 'Mark Arrived';
    arriveBtn.addEventListener('click', () => openDockModal(load));
    actions.appendChild(arriveBtn);
  }

  card.appendChild(actions);
  return card;
}

function formatArrivedAt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

function formatArrivedAtFull(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

// Broker-reported reschedule/delay/cancel flag, shown on the card and in
// the detail sheet. The original schedule is untouched underneath this —
// see LoadChanges in the backend for the audit trail.
function formatChangeDetailText(change) {
  let text = '';
  if (change.type === 'RESCHEDULED') {
    text = 'Broker: new date ' + (change.newDate || '—') + (change.newTime ? ' at ' + change.newTime : '');
  } else if (change.type === 'DELAYED') {
    text = 'Broker: approx. new ETA ' + (change.newTime || '—');
  } else if (change.type === 'CANCELLED') {
    text = 'Broker: marked cancelled';
  } else {
    text = 'Broker update';
  }
  if (change.notes) text += ' — ' + change.notes;
  text += ' (' + (change.changedBy || 'broker') + ')';
  return text;
}

// ---------- DETAIL SHEET ----------
function openDetailSheet(load) {
  sheetContent.innerHTML = `
    <h2>BOL ${escapeHtml(load.inboundBol)}</h2>
    <div class="load-date" style="margin-bottom:10px;">${escapeHtml(load.location)}</div>
    ${detailRow('Status', load.arrived ? 'Arrived ' + formatArrivedAt(load.arrivedAt) : 'Pending')}
    ${detailRow('Scheduled Date', load.inboundScheduled)}
    ${detailRow('Appointment Time', load.appointmentTime)}
    ${detailRow('Carrier', load.carrier)}
    ${detailRow('Project', load.project)}
    ${detailRow('Pallet Group ID', load.palletGroupId)}
    ${detailRow('Material', load.material)}
    ${detailRow('Manufacture', load.manufacture)}
    ${detailRow('Description', load.desc)}
    ${detailRow('Power', load.power)}
    ${detailRow('PCs', load.pcs)}
    ${detailRow('Pallets', load.pallets)}
    ${detailRow('Warehouse', load.warehouse)}
    ${detailRow('Warehouse Address', load.warehouseAddress)}
    ${load.inboundNotes ? detailRow('Notes', load.inboundNotes) : ''}
    ${load.markedBy ? detailRow('Marked By', load.markedBy) : ''}
    ${load.arrivedDock ? detailRow('Dock', load.arrivedDock) : ''}
    ${load.change ? detailRow('Broker Update', formatChangeDetailText(load.change)) : ''}
  `;
  detailSheet.classList.remove('hidden');
}

function detailRow(label, value) {
  return `<div class="detail-row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value || '—')}</span></div>`;
}

function closeSheet() {
  detailSheet.classList.add('hidden');
}

// ---------- MESSAGES (quick notes with the broker) ----------
async function openMessagesSheet(load) {
  state.activeMessageLoad = load;
  messagesTitle.textContent = 'BOL ' + load.inboundBol;
  messagesSubtitle.textContent = load.location + ' · ' + (load.carrier || 'Carrier TBD');
  messageInput.value = '';
  messagesList.innerHTML = '<div class="search-empty">Loading…</div>';
  messagesSheet.classList.remove('hidden');
  await loadMessagesThread();
  setTimeout(() => messageInput.focus(), 100);
}

function closeMessagesSheet() {
  messagesSheet.classList.add('hidden');
  state.activeMessageLoad = null;
}

async function loadMessagesThread() {
  const load = state.activeMessageLoad;
  if (!load) return;
  try {
    const url = API_URL + '?action=messages&location=' + encodeURIComponent(load.location) +
      '&bol=' + encodeURIComponent(load.inboundBol);
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    renderMessagesList(json.ok ? json.messages : []);
  } catch (err) {
    messagesList.innerHTML = '<div class="search-empty">Could not reach the server.</div>';
  }
}

function renderMessagesList(messages) {
  if (!messages || messages.length === 0) {
    messagesList.innerHTML = '<div class="search-empty">No messages yet on this load.</div>';
    return;
  }
  messagesList.innerHTML = messages.map((m) => `
    <div class="message-bubble ${m.senderType === 'broker' ? 'from-broker' : 'from-staff'}">
      <div class="message-meta">${escapeHtml(m.sender || (m.senderType === 'broker' ? 'Broker' : 'Staff'))} · ${formatArrivedAtFull(m.timestamp)}</div>
      <div class="message-text">${linkifyMessage(m.message)}</div>
    </div>
  `).join('');
  messagesList.scrollTop = messagesList.scrollHeight;
}

// Turns a pasted link (e.g. a Google Drive photo link) into a tappable
// link instead of dead text — the message itself stays plain text/HTML-
// escaped, only recognized URLs get wrapped in an anchor.
function linkifyMessage(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const clean = url.replace(/[),.]+$/, '');
    const trailing = url.slice(clean.length);
    return `<a href="${clean}" target="_blank" rel="noopener">${clean}</a>${trailing}`;
  });
}

async function sendMessageFromInput() {
  const load = state.activeMessageLoad;
  const text = messageInput.value.trim();
  if (!load || !text) return;

  const auth = getAuth();
  if (!auth) {
    state.pendingAction = { type: 'sendMessage', payload: { location: load.location, bol: load.inboundBol, message: text } };
    openSignInModal(state.pendingAction);
    return;
  }

  messageSendBtn.disabled = true;
  const result = await performAction(
    { type: 'sendMessage', payload: { location: load.location, bol: load.inboundBol, message: text } },
    auth
  );
  messageSendBtn.disabled = false;

  if (result && result.ok) {
    messageInput.value = '';
    load.messageCount = (load.messageCount || 0) + 1;
    await loadMessagesThread();
    renderLoadList();
  }
}

// ---------- SEARCH ----------
function openSearchSheet() {
  searchInput.value = '';
  searchResultsEl.innerHTML = '<div class="search-empty">Type a BOL number or carrier name.</div>';
  searchSheet.classList.remove('hidden');
  setTimeout(() => searchInput.focus(), 100);
}

function closeSearchSheet() {
  searchSheet.classList.add('hidden');
}

async function runSearch() {
  const q = searchInput.value.trim();
  if (!q) {
    searchResultsEl.innerHTML = '<div class="search-empty">Type a BOL number or carrier name.</div>';
    return;
  }

  searchResultsEl.innerHTML = '<div class="search-empty">Searching…</div>';

  try {
    const res = await fetch(API_URL + '?action=search&q=' + encodeURIComponent(q), { cache: 'no-store' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);

    renderSearchResults(json.results);
  } catch (err) {
    searchResultsEl.innerHTML = '<div class="search-empty">Search failed — check connection.</div>';
  }
}

function renderSearchResults(results) {
  if (!results || results.length === 0) {
    searchResultsEl.innerHTML = '<div class="search-empty">No matching loads found.</div>';
    return;
  }

  searchResultsEl.innerHTML = '';
  results.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'search-result';

    const statusText = r.arrived
      ? 'Arrived ' + formatArrivedAtFull(r.arrivedAt) + (r.markedBy ? ' by ' + r.markedBy : '') + (r.arrivedDock ? ' · Dock ' + r.arrivedDock : '')
      : 'Not yet arrived';

    item.innerHTML = `
      <div class="search-result-top">
        <span>BOL ${escapeHtml(r.inboundBol)}</span>
        <span>${escapeHtml(r.location)}</span>
      </div>
      <div class="search-result-meta">${escapeHtml(r.carrier || 'Carrier TBD')} · Scheduled ${escapeHtml(r.inboundScheduled || '—')} ${escapeHtml(r.appointmentTime || '')}</div>
      <div class="search-result-status ${r.arrived ? 'arrived' : 'pending'}">${escapeHtml(statusText)}</div>
    `;
    searchResultsEl.appendChild(item);
  });
}

// ---------- ADMIN SHEET: Activity + Staff ----------
function openAdminSheet() {
  const auth = getAuth();
  if (!auth || auth.role !== 'admin') {
    showToast('Admin access required', false);
    return;
  }
  setAdminView('activity');
  renderAdminDateChips();
  loadHistory();
  adminSheet.classList.remove('hidden');
}

function closeAdminSheet() {
  adminSheet.classList.add('hidden');
}

function setAdminView(view) {
  state.adminView = view;
  adminTabActivity.classList.toggle('active', view === 'activity');
  adminTabStaff.classList.toggle('active', view === 'staff');
  adminActivityView.classList.toggle('hidden', view !== 'activity');
  adminStaffView.classList.toggle('hidden', view !== 'staff');
  if (view === 'staff') loadStaff();
}

function renderAdminDateChips() {
  adminDateChipsEl.innerHTML = '';
  buildQuickChips(state.adminDate).forEach((chip) => {
    const btn = document.createElement('button');
    btn.className = 'date-chip' + (chip.active ? ' active' : '');
    btn.textContent = chip.label;
    btn.addEventListener('click', () => {
      state.adminDate = chip.key;
      renderAdminDateChips();
      loadHistory();
    });
    adminDateChipsEl.appendChild(btn);
  });
}

async function loadHistory() {
  const auth = getAuth();
  if (!auth) return;
  adminHistoryListEl.innerHTML = '<div class="search-empty">Loading…</div>';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'getHistory', authPin: auth.pin, date: state.adminDate })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    renderHistoryList(json.entries);
  } catch (err) {
    adminHistoryListEl.innerHTML = '<div class="search-empty">Could not load history.</div>';
  }
}

function renderHistoryList(entries) {
  if (!entries || entries.length === 0) {
    adminHistoryListEl.innerHTML = '<div class="search-empty">No activity for this date.</div>';
    return;
  }

  adminHistoryListEl.innerHTML = '';
  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'history-row';

    const isArrived = entry.status === 'ARRIVED';
    const statusLabel = isArrived ? 'Arrived' : 'Marked Not Arrived';
    const statusClass = isArrived ? 'status-arrived' : 'status-unarrived';

    row.innerHTML = `
      <div class="history-row-top">
        <span>BOL ${escapeHtml(entry.inboundBol)} · ${escapeHtml(entry.location)}</span>
        <span class="${statusClass}">${statusLabel}</span>
      </div>
      <div class="history-row-meta">
        ${escapeHtml(entry.carrier || 'Carrier TBD')} · ${escapeHtml(formatArrivedAtFull(entry.timestamp))} · by ${escapeHtml(entry.markedBy || '—')}
      </div>
    `;

    if (isArrived) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'history-row-actions';
      const undoBtn = document.createElement('button');
      undoBtn.className = 'btn btn-unarrive';
      undoBtn.textContent = 'Undo this arrival';
      undoBtn.addEventListener('click', async () => {
        const result = await runGatedActionReturning(
          { type: 'unmarkArrived', payload: { location: entry.location, bol: entry.inboundBol } }
        );
        if (result) loadHistory();
      });
      actionsDiv.appendChild(undoBtn);
      row.appendChild(actionsDiv);
    }

    adminHistoryListEl.appendChild(row);
  });
}

// Same as runGatedAction but returns the result so callers can chain a
// follow-up (like refreshing the history list after an undo).
async function runGatedActionReturning(action) {
  const auth = getAuth();
  if (!auth) {
    openSignInModal(action);
    return null;
  }
  return performAction(action, auth);
}

// ---------- ADMIN SHEET: Staff roster ----------
async function loadStaff() {
  const auth = getAuth();
  if (!auth) return;
  staffListEl.innerHTML = '<div class="search-empty">Loading…</div>';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'listStaff', authPin: auth.pin })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    renderStaffList(json.staff);
  } catch (err) {
    staffListEl.innerHTML = '<div class="search-empty">Could not load staff.</div>';
  }
}

function renderStaffList(staff) {
  if (!staff || staff.length === 0) {
    staffListEl.innerHTML = '<div class="search-empty">No staff yet.</div>';
    return;
  }

  staffListEl.innerHTML = '';
  staff.forEach((s) => {
    const isActive = String(s.active).toLowerCase() === 'yes';
    const row = document.createElement('div');
    row.className = 'staff-row' + (isActive ? '' : ' inactive');
    row.innerHTML = `
      <div>
        <div class="staff-row-name">${escapeHtml(s.name)}</div>
        <div class="staff-row-role">${escapeHtml(s.role)}${isActive ? '' : ' · inactive'}</div>
      </div>
    `;
    const editBtn = document.createElement('button');
    editBtn.className = 'staff-row-edit';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openStaffModal(s));
    row.appendChild(editBtn);
    staffListEl.appendChild(row);
  });
}

function openStaffModal(record) {
  state.editingStaffOriginalName = record ? record.name : null;
  staffModalTitle.textContent = record ? 'Edit Staff' : 'Add Staff';
  staffNameInput.value = record ? record.name : '';
  staffPinInput.value = record ? record.pin : '';
  staffAdminCheckbox.checked = record ? record.role === 'admin' : false;
  staffActiveCheckbox.checked = record ? String(record.active).toLowerCase() === 'yes' : true;
  staffModalError.classList.add('hidden');
  staffModal.classList.remove('hidden');
  setTimeout(() => staffNameInput.focus(), 50);
}

function closeStaffModal() {
  staffModal.classList.add('hidden');
}

async function confirmStaffSave() {
  const auth = getAuth();
  if (!auth) return;

  const name = staffNameInput.value.trim();
  const pin = staffPinInput.value.trim();

  if (!name) {
    staffModalError.textContent = 'Enter a name';
    staffModalError.classList.remove('hidden');
    return;
  }
  if (!/^\d{4,8}$/.test(pin)) {
    staffModalError.textContent = 'PIN must be 4-8 digits';
    staffModalError.classList.remove('hidden');
    return;
  }

  staffSaveBtn.disabled = true;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'saveStaff',
        authPin: auth.pin,
        originalName: state.editingStaffOriginalName || undefined,
        name,
        pin,
        role: staffAdminCheckbox.checked ? 'admin' : 'staff',
        active: staffActiveCheckbox.checked
      })
    });
    const json = await res.json();
    if (!json.ok) {
      staffModalError.textContent = json.error || 'Could not save';
      staffModalError.classList.remove('hidden');
      return;
    }

    closeStaffModal();
    showToast('Staff saved', false);
    loadStaff();
  } catch (err) {
    staffModalError.textContent = 'Network error — try again';
    staffModalError.classList.remove('hidden');
  } finally {
    staffSaveBtn.disabled = false;
  }
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------- TOAST ----------
let toastTimer = null;
function showToast(msg, isOffline) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('offline', !!isOffline);
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), isOffline ? 3200 : 2200);
}

// ---------- UTIL ----------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
