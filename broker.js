// ---------- CONFIG ----------
// Same deployed Web App as the main app — keep these two files in sync
// if you ever redeploy to a new /exec URL.
const API_URL = 'https://script.google.com/macros/s/AKfycbyX6N102QHuhZoHGKIipl81DWO9lDIc-TtVm8g3_Pv2vybzKmDBjeVi4i0BdQg8dynsVw/exec';

const AUTO_REFRESH_MS = 2 * 60 * 1000;
const BROKER_AUTH_KEY = 'inboundTrackerBrokerAuth'; // { name, code }
const BROKER_NOTIFY_KEY = 'inboundTrackerBrokerNotifyOn'; // 'true' | 'false'
const BROKER_SEEN_MSG_KEY = 'inboundTrackerBrokerSeenMsgCounts'; // { "location::bol": count }
// Shared Drive folder of signed delivery receipts — same link as the
// warehouse app, opened as a plain link (no Drive API wired up here).
const RECEIPTS_FOLDER_URL = 'https://drive.google.com/drive/folders/14DWq8DSOMLxWztqyz8QwgpJrNpHVZn50?usp=sharing';

// ---------- STATE ----------
let state = {
  loads: [],
  locations: [],  // unique location names seen in the last load, in order
  activeLocation: 'ALL', // 'ALL' or one location name
  selectedDate: toApiDateString(new Date()), // 'MM/dd/yyyy' or 'ALL'
  actionMode: null,     // 'reschedule' | 'delay' | 'cancel'
  actionLoad: null,      // the load object the open action modal targets
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
const brokerGreetingEl = document.getElementById('brokerGreeting');

const appShell = document.getElementById('appShell');
const refreshBtn = document.getElementById('refreshBtn');
const signOutBtn = document.getElementById('signOutBtn');
const receiptsBtn = document.getElementById('receiptsBtn');
const exportBtn = document.getElementById('exportBtn');
const notifyChipEl = document.getElementById('notifyChip');

const signInModal = document.getElementById('signInModal');
const brokerNameInput = document.getElementById('brokerNameInput');
const brokerCodeInput = document.getElementById('brokerCodeInput');
const signInError = document.getElementById('signInError');
const signInConfirm = document.getElementById('signInConfirm');

const searchBtn = document.getElementById('searchBtn');
const searchSheet = document.getElementById('searchSheet');
const searchInput = document.getElementById('searchInput');
const searchResultsEl = document.getElementById('searchResults');
const searchCloseBtn = document.getElementById('searchCloseBtn');

const detailSheet = document.getElementById('detailSheet');
const sheetContent = document.getElementById('sheetContent');
const sheetCloseBtn = document.getElementById('sheetCloseBtn');

const messagesSheet = document.getElementById('messagesSheet');
const messagesTitle = document.getElementById('messagesTitle');
const messagesSubtitle = document.getElementById('messagesSubtitle');
const messagesList = document.getElementById('messagesList');
const messageInput = document.getElementById('messageInput');
const messageSendBtn = document.getElementById('messageSendBtn');
const messagesCloseBtn = document.getElementById('messagesCloseBtn');

const actionModal = document.getElementById('actionModal');
const actionModalTitle = document.getElementById('actionModalTitle');
const actionModalSubtitle = document.getElementById('actionModalSubtitle');
const actionDateField = document.getElementById('actionDateField');
const actionDateInput = document.getElementById('actionDateInput');
const actionTimeField = document.getElementById('actionTimeField');
const actionTimeLabel = document.getElementById('actionTimeLabel');
const actionTimeInput = document.getElementById('actionTimeInput');
const actionNotesInput = document.getElementById('actionNotesInput');
const actionModalError = document.getElementById('actionModalError');
const actionCancelBtn = document.getElementById('actionCancelBtn');
const actionConfirmBtn = document.getElementById('actionConfirmBtn');

const toastEl = document.getElementById('toast');

// ---------- LAYOUT ----------
// Measures the actual topbar/tabs height so the sticky date-bar below
// them lines up correctly (same trick as the main app — avoids hardcoded
// pixel offsets that break if the topbar ever wraps to another line).
function updateStickyOffsets() {
  const topbarEl = document.querySelector('.topbar');
  const tabsEl = document.querySelector('.tabs');
  if (topbarEl) document.documentElement.style.setProperty('--topbar-h', topbarEl.offsetHeight + 'px');
  if (tabsEl) document.documentElement.style.setProperty('--tabs-h', tabsEl.offsetHeight + 'px');
}

// ---------- DATE HELPERS ----------
function pad2(n) { return String(n).padStart(2, '0'); }

function toApiDateString(d) {
  return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + '/' + d.getFullYear();
}

function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function buildDateChips() {
  const today = new Date();
  const chips = [
    { label: 'Today', value: toApiDateString(today) },
    { label: 'Tomorrow', value: toApiDateString(addDays(today, 1)) },
    { label: 'All Upcoming', value: 'ALL' }
  ];
  dateChipsEl.innerHTML = '';
  chips.forEach(function (chip) {
    const btn = document.createElement('button');
    btn.className = 'date-chip' + (state.selectedDate === chip.value ? ' active' : '');
    btn.textContent = chip.label;
    btn.addEventListener('click', function () {
      state.selectedDate = chip.value;
      buildDateChips();
      loadData();
    });
    dateChipsEl.appendChild(btn);
  });

  if (state.selectedDate !== 'ALL') {
    const parts = state.selectedDate.split('/');
    const m = parts[0], d = parts[1], y = parts[2];
    datePickerEl.value = y + '-' + pad2(Number(m)) + '-' + pad2(Number(d));
  } else {
    datePickerEl.value = '';
  }
}

// Lets the broker jump to any date, not just Today/Tomorrow/All Upcoming —
// e.g. to check yesterday's deliveries or a load scheduled further out.
function onDatePicked(e) {
  const val = e.target.value; // yyyy-mm-dd
  if (!val) return;
  const parts = val.split('-').map(Number);
  const y = parts[0], m = parts[1], d = parts[2];
  state.selectedDate = pad2(m) + '/' + pad2(d) + '/' + y;
  buildDateChips();
  loadData();
}

// ---------- LOCATION TABS ----------
// On a busy day (14-28 loads per location, times three), scrolling
// through everything to find one location's loads gets old fast — these
// tabs let the broker narrow to just the location they're updating.
function renderLocationTabs() {
  locationTabsEl.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = 'tab-btn' + (state.activeLocation === 'ALL' ? ' active' : '');
  allBtn.textContent = 'All Locations';
  allBtn.addEventListener('click', function () {
    state.activeLocation = 'ALL';
    renderLocationTabs();
    renderLoadList();
  });
  locationTabsEl.appendChild(allBtn);

  state.locations.forEach(function (loc) {
    const pendingCount = state.loads.filter(function (l) { return l.location === loc && !l.arrived; }).length;
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (state.activeLocation === loc ? ' active' : '');
    btn.textContent = loc + (pendingCount > 0 ? ' (' + pendingCount + ')' : '');
    btn.addEventListener('click', function () {
      state.activeLocation = loc;
      renderLocationTabs();
      renderLoadList();
    });
    locationTabsEl.appendChild(btn);
  });

  renderProgressBar();
  updateStickyOffsets();
}

// ---------- RENDER: PROGRESS BAR ----------
// Same "X / Y arrived" bar as the warehouse app, scoped to whichever
// location tab (or All Locations) and date range is currently selected.
function renderProgressBar() {
  const visible = state.activeLocation === 'ALL'
    ? state.loads
    : state.loads.filter(function (l) { return l.location === state.activeLocation; });

  // Cancelled loads don't count toward the total — they were never
  // going to arrive.
  const countable = visible.filter(function (l) { return !(l.change && l.change.type === 'CANCELLED'); });
  const total = countable.length;
  if (total === 0) {
    progressBarEl.innerHTML = '';
    progressBarEl.style.display = 'none';
    return;
  }
  const arrivedCount = countable.filter(function (l) { return l.arrived; }).length;
  const pct = Math.round((arrivedCount / total) * 100);

  progressBarEl.style.display = 'flex';
  progressBarEl.innerHTML =
    '<span>' + arrivedCount + ' / ' + total + ' arrived</span>' +
    '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
    '<span>' + pct + '%</span>';
}

// ---------- EXPORT (CSV of the currently viewed loads) ----------
// A plain record of scheduled vs. arrival time, plus any reschedule/
// delay/cancel flags, for whichever day and location tab is currently
// selected. Note: this has an appointment time and an arrival (check-in)
// time, but no departure/release time, since the warehouse team doesn't
// clock trucks out — so it documents when a truck was scheduled and when
// it showed up, not how long it actually dwelled at the dock.
function exportCsv() {
  if (state.selectedDate === 'ALL') {
    showToast('Pick a specific day (or use the calendar) to export — All Upcoming doesn\'t include arrival times');
    return;
  }

  const visible = state.activeLocation === 'ALL'
    ? state.loads
    : state.loads.filter(function (l) { return l.location === state.activeLocation; });

  if (visible.length === 0) {
    showToast('Nothing to export for this view');
    return;
  }

  const headers = [
    'Location', 'BOL', 'Carrier', 'Material', 'Module Type', 'Module Class',
    'Module Qty', 'MW', 'Pallets', 'Delivery Location Ref',
    'Scheduled Date', 'Appointment Time',
    'Arrived', 'Arrived At', 'Dock',
    'Flag Type', 'Flag New Date', 'Flag New Time', 'Flag Notes', 'Flag By',
    'Load Notes'
  ];

  const rows = visible
    .slice()
    .sort(function (a, b) {
      const dateCmp = String(a.inboundScheduled).localeCompare(String(b.inboundScheduled));
      if (dateCmp !== 0) return dateCmp;
      return parseTimeToMinutes(a.appointmentTime) - parseTimeToMinutes(b.appointmentTime);
    })
    .map(function (l) {
      const change = l.change || {};
      return [
        l.location,
        l.inboundBol,
        l.carrier || '',
        l.material || '',
        l.moduleType || '',
        l.moduleClass || '',
        l.moduleQty || '',
        l.mw || '',
        l.pallets || '',
        l.locationRef || '',
        l.inboundScheduled || '',
        l.appointmentTime || '',
        l.arrived ? 'Yes' : 'No',
        l.arrived ? formatArrivedAtFull(l.arrivedAt) : '',
        l.arrivedDock || '',
        change.type || '',
        change.newDate || '',
        change.newTime || '',
        change.notes || '',
        change.changedBy || '',
        l.inboundNotes || ''
      ];
    });

  const csvLines = [headers].concat(rows).map(function (fields) {
    return fields.map(csvEscape).join(',');
  });
  const csv = csvLines.join('\r\n');

  const dateLabel = state.selectedDate.replace(/\//g, '-');
  const locLabel = state.activeLocation === 'ALL' ? 'All-Locations' : state.activeLocation.replace(/\s+/g, '-');
  const filename = 'loads_' + locLabel + '_' + dateLabel + '.csv';

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// ---------- AUTH ----------
function getBrokerAuth() {
  try {
    return JSON.parse(localStorage.getItem(BROKER_AUTH_KEY) || 'null');
  } catch (e) {
    return null;
  }
}

function saveBrokerAuth(auth) {
  localStorage.setItem(BROKER_AUTH_KEY, JSON.stringify(auth));
}

function clearBrokerAuth() {
  localStorage.removeItem(BROKER_AUTH_KEY);
}

function renderGreeting() {
  const auth = getBrokerAuth();
  if (auth && auth.name) {
    brokerGreetingEl.textContent = 'Signed in as ' + auth.name;
    brokerGreetingEl.classList.remove('hidden');
  } else {
    brokerGreetingEl.classList.add('hidden');
  }
}

// ---------- ALERTS (new messages from the warehouse) ----------
// Same idea as the "overdue" alerts in the warehouse app: local browser
// notifications only (no server push), opt-in, and only fire while this
// tab is open somewhere (foreground or a background tab) — not when the
// browser/phone is fully closed. Triggers on a NEW message where the
// warehouse team sent the last word on a load, so the broker doesn't
// have to keep the portal open and staring at it to know someone asked
// something.
function notificationsEnabled() {
  try { return localStorage.getItem(BROKER_NOTIFY_KEY) === 'true'; } catch (e) { return false; }
}

function renderNotifyChip() {
  const on = notificationsEnabled() && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  notifyChipEl.textContent = '🔔 Alerts: ' + (on ? 'On' : 'Off');
  notifyChipEl.classList.toggle('notify-on', on);
}

async function toggleNotifications() {
  if (typeof Notification === 'undefined') {
    showToast('Notifications aren\'t supported in this browser');
    return;
  }

  const currentlyOn = notificationsEnabled() && Notification.permission === 'granted';
  if (currentlyOn) {
    localStorage.setItem(BROKER_NOTIFY_KEY, 'false');
    renderNotifyChip();
    showToast('Message alerts turned off');
    return;
  }

  if (Notification.permission === 'denied') {
    showToast('Notifications are blocked for this site in your browser settings');
    return;
  }

  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') {
    renderNotifyChip();
    return;
  }
  localStorage.setItem(BROKER_NOTIFY_KEY, 'true');
  renderNotifyChip();
  showToast('You\'ll get an alert here when the warehouse messages you');
  // Establish a baseline so turning this on doesn't immediately fire
  // notifications for every message that already existed.
  primeSeenMessageCounts();
}

function getSeenMessageCounts() {
  try {
    return JSON.parse(localStorage.getItem(BROKER_SEEN_MSG_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function saveSeenMessageCounts(counts) {
  try { localStorage.setItem(BROKER_SEEN_MSG_KEY, JSON.stringify(counts)); } catch (e) {}
}

function primeSeenMessageCounts() {
  const seen = {};
  state.loads.forEach(function (load) {
    seen[load.location + '::' + load.inboundBol] = load.messageCount || 0;
  });
  saveSeenMessageCounts(seen);
}

/**
 * Called after every data refresh. Fires a Notification for any load
 * whose message count went up since we last checked AND whose latest
 * message came from the warehouse team (never for the broker's own
 * sends). Only covers loads in the currently-loaded date range/location
 * filter — a message on a day outside what's loaded won't be caught
 * until that range is viewed.
 */
function checkNewMessageNotifications() {
  const seen = getSeenMessageCounts();
  if (!notificationsEnabled() || typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    // Still keep the baseline in sync so nothing floods in once alerts
    // are turned back on.
    primeSeenMessageCounts();
    return;
  }

  state.loads.forEach(function (load) {
    const key = load.location + '::' + load.inboundBol;
    const count = load.messageCount || 0;
    const previously = key in seen ? seen[key] : count; // unseen load: don't notify on first sight
    if (count > previously && load.lastMessageSenderType === 'staff') {
      try {
        new Notification('New message · BOL ' + load.inboundBol, {
          body: load.location + ' · ' + (load.carrier || 'Carrier TBD') + ' — the warehouse team sent a message',
          tag: key
        });
      } catch (e) { /* ignore — some browsers restrict Notification() outside a SW */ }
    }
    seen[key] = count;
  });
  saveSeenMessageCounts(seen);
}

// The app shell (topbar, banner, tabs, load list — everything but the
// sign-in prompt) stays hidden until a valid access code is confirmed,
// so there's nothing to see here beyond "enter your code" without one.
function revealAppShell() {
  appShell.classList.remove('hidden');
  // The topbar/tabs were display:none while hidden, so their measured
  // heights were 0 — recompute now that they're actually laid out.
  setTimeout(updateStickyOffsets, 0);
}

function hideAppShell() {
  appShell.classList.add('hidden');
}

function openSignInModal(errorMsg) {
  hideAppShell();
  signInModal.classList.remove('hidden');
  if (errorMsg) {
    signInError.textContent = errorMsg;
    signInError.classList.remove('hidden');
  } else {
    signInError.classList.add('hidden');
  }
}

function closeSignInModal() {
  signInModal.classList.add('hidden');
}

signInConfirm.addEventListener('click', async function () {
  const name = brokerNameInput.value.trim();
  const code = brokerCodeInput.value.trim();
  if (!name) {
    signInError.textContent = 'Enter your name';
    signInError.classList.remove('hidden');
    return;
  }
  if (!code) {
    signInError.textContent = 'Enter the access code';
    signInError.classList.remove('hidden');
    return;
  }
  signInConfirm.disabled = true;
  try {
    const res = await fetch(API_URL + '?action=brokerVerify&code=' + encodeURIComponent(code));
    const data = await res.json();
    if (!data.ok) {
      signInError.textContent = data.error || 'Invalid access code';
      signInError.classList.remove('hidden');
      return;
    }
    saveBrokerAuth({ name: name, code: code });
    closeSignInModal();
    revealAppShell();
    renderGreeting();
    loadData();
  } catch (err) {
    signInError.textContent = 'Could not reach the server — check your connection';
    signInError.classList.remove('hidden');
  } finally {
    signInConfirm.disabled = false;
  }
});

signOutBtn.addEventListener('click', function () {
  clearBrokerAuth();
  renderGreeting();
  brokerNameInput.value = '';
  brokerCodeInput.value = '';
  openSignInModal();
});

// ---------- DATA LOAD ----------
async function loadData() {
  const auth = getBrokerAuth();
  if (!auth) {
    openSignInModal();
    return;
  }

  emptyStateEl.textContent = 'Loading…';
  emptyStateEl.classList.remove('hidden');

  try {
    const url = API_URL + '?action=brokerData&code=' + encodeURIComponent(auth.code) +
      '&date=' + encodeURIComponent(state.selectedDate);
    const res = await fetch(url);
    const data = await res.json();

    if (!data.ok) {
      // Access code was likely revoked/changed since sign-in.
      clearBrokerAuth();
      renderGreeting();
      openSignInModal(data.error || 'Your access code is no longer valid — sign in again.');
      return;
    }

    state.loads = data.loads || [];

    // Preserve first-seen order (which already matches LOCATION_TABS
    // order from the backend) rather than alphabetizing.
    const seen = {};
    state.locations = [];
    state.loads.forEach(function (l) {
      if (!seen[l.location]) {
        seen[l.location] = true;
        state.locations.push(l.location);
      }
    });

    renderLocationTabs();
    renderLoadList();
    checkNewMessageNotifications();
    lastUpdatedEl.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (err) {
    emptyStateEl.textContent = 'Could not reach the server. Check your connection and try refreshing.';
    emptyStateEl.classList.remove('hidden');
  }
}

// ---------- RENDER ----------
function renderLoadList() {
  loadListEl.querySelectorAll('.load-card').forEach(function (el) { el.remove(); });

  const visible = state.activeLocation === 'ALL'
    ? state.loads
    : state.loads.filter(function (l) { return l.location === state.activeLocation; });

  if (visible.length === 0) {
    emptyStateEl.textContent = state.activeLocation === 'ALL'
      ? 'No loads for this range.'
      : 'No loads at ' + state.activeLocation + ' for this range.';
    emptyStateEl.classList.remove('hidden');
    return;
  }
  emptyStateEl.classList.add('hidden');

  // Straight chronological order — all the 7am loads, then all the 8am
  // loads, and so on (same as the warehouse team app), regardless of
  // location, delivered/pending, or flagged status. Use the location
  // tabs above to narrow to one warehouse if that's more useful.
  visible
    .slice()
    .sort(function (a, b) {
      const dateCmp = String(a.inboundScheduled).localeCompare(String(b.inboundScheduled));
      if (dateCmp !== 0) return dateCmp;
      return parseTimeToMinutes(a.appointmentTime) - parseTimeToMinutes(b.appointmentTime);
    })
    .forEach(function (load) {
      loadListEl.appendChild(renderLoadCard(load));
    });
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

// ---------- DETAIL SHEET (tap the BOL) ----------
// Same expanded-card info as the warehouse team app, minus anything
// that's purely internal (who on staff marked it arrived).
function openDetailSheet(load) {
  sheetContent.innerHTML =
    '<h2>BOL ' + escapeHtml(String(load.inboundBol)) + '</h2>' +
    '<div class="load-date" style="margin-bottom:10px;">' + escapeHtml(load.location) + '</div>' +
    detailRow('Status', load.arrived ? 'Delivered ' + formatArrivedAt(load.arrivedAt) : 'Pending') +
    detailRow('Scheduled Date', load.inboundScheduled) +
    detailRow('Appointment Time', load.appointmentTime) +
    detailRow('Carrier', load.carrier) +
    detailRow('Pallet Group ID', load.palletGroupId) +
    detailRow('Material', load.material) +
    detailRow('Module Type', load.moduleType) +
    detailRow('Module Class', load.moduleClass) +
    detailRow('Module Qty', load.moduleQty) +
    detailRow('MW', load.mw) +
    detailRow('Pallets', load.pallets) +
    (load.locationRef ? detailRow('Delivery Location Ref', load.locationRef) : '') +
    (load.inboundNotes ? detailRow('Notes', load.inboundNotes) : '') +
    (load.arrivedDock ? detailRow('Dock', load.arrivedDock) : '') +
    (load.change ? detailRow('Status Update', renderChangeDetailPlainText(load.change)) : '');
  detailSheet.classList.remove('hidden');
}

function closeDetailSheet() {
  detailSheet.classList.add('hidden');
}

function detailRow(label, value) {
  return '<div class="detail-row"><span class="label">' + escapeHtml(label) +
    '</span><span class="value">' + escapeHtml(value || '—') + '</span></div>';
}

// Plain-text version of renderChangeDetail() (which returns HTML with an
// emoji + styled wrapper meant for the card) — the detail sheet just
// wants the sentence itself inside a normal detail-row value.
function renderChangeDetailPlainText(change) {
  let text = '';
  if (change.type === 'RESCHEDULED') {
    text = 'New date: ' + (change.newDate || '—') + (change.newTime ? ' at ' + change.newTime : '');
  } else if (change.type === 'DELAYED') {
    text = 'New approx. ETA: ' + (change.newTime || '—');
  } else if (change.type === 'CANCELLED') {
    text = 'Marked cancelled';
  }
  if (change.notes) text += ' — ' + change.notes;
  text += ' (by ' + (change.changedBy || 'broker') + ')';
  return text;
}

function renderLoadCard(load) {
  const card = document.createElement('div');
  card.className = 'load-card' + (load.arrived ? ' arrived' : '');

  const change = load.change;
  const badge = load.arrived
    ? '<span class="status-pill arrived">Delivered ' + escapeHtml(formatArrivedAt(load.arrivedAt)) + '</span>'
    : (change ? renderChangeBadge(change) : '');
  const detail = (!load.arrived && change) ? renderChangeDetail(change) : '';

  const messageChipHtml = '<button class="message-chip" type="button" title="Messages">💬 Message' +
    (load.messageCount > 0 ? ' <span>' + load.messageCount + '</span>' : '') + '</button>';

  card.innerHTML =
    '<div class="load-card-top">' +
      '<div>' +
        '<div class="load-time">' + escapeHtml(load.appointmentTime || '—') + '</div>' +
        '<div class="load-date">' + escapeHtml(load.location) + ' · ' + escapeHtml(load.inboundScheduled || '') + '</div>' +
      '</div>' +
      '<div class="load-card-top-right">' +
        (badge || '<span class="status-pill pending">Pending</span>') +
        messageChipHtml +
      '</div>' +
    '</div>' +
    '<div class="load-bol">BOL ' + escapeHtml(String(load.inboundBol)) +
      (load.locationRef ? ' <span class="location-ref-chip">' + escapeHtml(load.locationRef) + '</span>' : '') +
    '</div>' +
    '<div class="load-meta"><span><b>' + escapeHtml(load.carrier || '—') + '</b></span>' +
      (load.material ? '<span>' + escapeHtml(load.material) + '</span>' : '') +
    '</div>' +
    detail;

  const messageChipBtn = card.querySelector('.message-chip');
  messageChipBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    openMessagesSheet(load);
  });

  const bolEl = card.querySelector('.load-bol');
  bolEl.addEventListener('click', function () { openDetailSheet(load); });

  // Delivered loads are informational only — nothing left for the
  // broker to flag on a load that's already checked in.
  if (load.arrived) {
    return card;
  }

  const actions = document.createElement('div');
  actions.className = 'load-actions broker-actions';

  if (change) {
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-clear';
    clearBtn.textContent = 'Clear flag';
    clearBtn.addEventListener('click', function () { runBrokerAction('clear', load); });
    actions.appendChild(clearBtn);
  } else {
    const rescheduleBtn = document.createElement('button');
    rescheduleBtn.className = 'btn btn-reschedule';
    rescheduleBtn.textContent = 'Reschedule';
    rescheduleBtn.addEventListener('click', function () { openActionModal('reschedule', load); });

    const delayBtn = document.createElement('button');
    delayBtn.className = 'btn btn-delay';
    delayBtn.textContent = 'Delay';
    delayBtn.addEventListener('click', function () { openActionModal('delay', load); });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function () { openActionModal('cancel', load); });

    actions.appendChild(rescheduleBtn);
    actions.appendChild(delayBtn);
    actions.appendChild(cancelBtn);
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

function renderChangeBadge(change) {
  const labels = { RESCHEDULED: 'Rescheduled', DELAYED: 'Delayed', CANCELLED: 'Cancelled' };
  const cls = change.type.toLowerCase();
  return '<span class="change-badge ' + cls + '">' + (labels[change.type] || change.type) + '</span>';
}

function renderChangeDetail(change) {
  let text = '';
  if (change.type === 'RESCHEDULED') {
    text = '📅 New date: ' + escapeHtml(change.newDate || '—') + (change.newTime ? ' at ' + escapeHtml(change.newTime) : '');
  } else if (change.type === 'DELAYED') {
    text = '⏰ New approx. ETA: ' + escapeHtml(change.newTime || '—');
  } else if (change.type === 'CANCELLED') {
    text = '🚫 Marked cancelled';
  }
  if (change.notes) text += ' — ' + escapeHtml(change.notes);
  text += ' (by ' + escapeHtml(change.changedBy || 'broker') + ')';
  const cls = 'change-detail' + (change.type === 'CANCELLED' ? ' cancelled' : '');
  return '<div class="' + cls + '">' + text + '</div>';
}

// ---------- ACTION MODAL ----------
function openActionModal(mode, load) {
  state.actionMode = mode;
  state.actionLoad = load;
  actionModalError.classList.add('hidden');
  actionNotesInput.value = '';
  actionDateInput.value = '';
  actionTimeInput.value = '';

  if (mode === 'reschedule') {
    actionModalTitle.textContent = 'Reschedule Load';
    actionModalSubtitle.textContent = 'BOL ' + load.inboundBol + ' — ' + load.location;
    actionDateField.classList.remove('hidden');
    actionTimeField.classList.remove('hidden');
    actionTimeLabel.textContent = 'New time (optional)';
    actionConfirmBtn.textContent = 'Save';
  } else if (mode === 'delay') {
    actionModalTitle.textContent = 'Delay Load';
    actionModalSubtitle.textContent = 'BOL ' + load.inboundBol + ' — ' + load.location;
    actionDateField.classList.add('hidden');
    actionTimeField.classList.remove('hidden');
    actionTimeLabel.textContent = 'Approx. new ETA';
    actionConfirmBtn.textContent = 'Save';
  } else if (mode === 'cancel') {
    actionModalTitle.textContent = 'Cancel Load';
    actionModalSubtitle.textContent = 'BOL ' + load.inboundBol + ' — ' + load.location;
    actionDateField.classList.add('hidden');
    actionTimeField.classList.add('hidden');
    actionConfirmBtn.textContent = 'Confirm Cancel';
  }

  actionModal.classList.remove('hidden');
}

function closeActionModal() {
  actionModal.classList.add('hidden');
  state.actionMode = null;
  state.actionLoad = null;
}

actionCancelBtn.addEventListener('click', closeActionModal);

actionConfirmBtn.addEventListener('click', function () {
  const mode = state.actionMode;
  const load = state.actionLoad;
  if (!mode || !load) return;

  if (mode === 'reschedule' && !actionDateInput.value) {
    actionModalError.textContent = 'Pick a new date';
    actionModalError.classList.remove('hidden');
    return;
  }
  if (mode === 'delay' && !actionTimeInput.value) {
    actionModalError.textContent = 'Enter the approximate new time';
    actionModalError.classList.remove('hidden');
    return;
  }

  runBrokerAction(mode, load, {
    newDate: actionDateInput.value ? formatDateInputToApi(actionDateInput.value) : '',
    newTime: actionTimeInput.value ? formatTimeInputToApi(actionTimeInput.value) : '',
    notes: actionNotesInput.value.trim()
  });
  closeActionModal();
});

function formatDateInputToApi(value) {
  // <input type=date> gives 'YYYY-MM-DD' — convert to the sheet's
  // 'MM/dd/yyyy' so it matches everywhere else in the app.
  const parts = value.split('-');
  return parts[1] + '/' + parts[2] + '/' + parts[0];
}

function formatTimeInputToApi(value) {
  // <input type=time> gives 24h 'HH:MM' — convert to a friendly 'h:mm AM/PM'.
  const [hStr, mStr] = value.split(':');
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return h + ':' + mStr + ' ' + period;
}

// ---------- SUBMIT ACTION ----------
async function runBrokerAction(mode, load, extra) {
  const auth = getBrokerAuth();
  if (!auth) {
    openSignInModal();
    return;
  }

  const actionName = { reschedule: 'brokerReschedule', delay: 'brokerDelay', cancel: 'brokerCancel', clear: 'brokerClear' }[mode];
  const payload = Object.assign({
    action: actionName,
    brokerCode: auth.code,
    brokerName: auth.name,
    location: load.location,
    bol: load.inboundBol
  }, extra || {});

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids a CORS preflight against Apps Script
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) {
      showToast(data.error || 'That did not go through — try again.');
      return;
    }
    showToast(mode === 'clear' ? 'Flag cleared' : 'Warehouse notified');
    loadData();
  } catch (err) {
    showToast('Could not reach the server — check your connection and try again.');
  }
}

// ---------- MESSAGES (quick notes with the warehouse) ----------
async function openMessagesSheet(load) {
  state.activeMessageLoad = load;
  messagesTitle.textContent = 'BOL ' + load.inboundBol;
  messagesSubtitle.textContent = load.location + ' · ' + (load.carrier || '—');
  messageInput.value = '';
  messagesList.innerHTML = '<div class="search-empty">Loading…</div>';
  messagesSheet.classList.remove('hidden');
  await loadMessagesThread();
  setTimeout(function () { messageInput.focus(); }, 100);
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
    const data = await res.json();
    renderMessagesList(data.ok ? data.messages : []);
  } catch (err) {
    messagesList.innerHTML = '<div class="search-empty">Could not reach the server.</div>';
  }
}

function renderMessagesList(messages) {
  if (!messages || messages.length === 0) {
    messagesList.innerHTML = '<div class="search-empty">No messages yet on this load.</div>';
    return;
  }
  messagesList.innerHTML = messages.map(function (m) {
    return '<div class="message-bubble ' + (m.senderType === 'broker' ? 'from-broker' : 'from-staff') + '">' +
      '<div class="message-meta">' + escapeHtml(m.sender || (m.senderType === 'broker' ? 'Broker' : 'Staff')) + ' · ' + formatArrivedAtFull(m.timestamp) + '</div>' +
      '<div class="message-text">' + linkifyMessage(m.message) + '</div>' +
    '</div>';
  }).join('');
  messagesList.scrollTop = messagesList.scrollHeight;
}

async function sendMessageFromInput() {
  const load = state.activeMessageLoad;
  const text = messageInput.value.trim();
  if (!load || !text) return;

  const auth = getBrokerAuth();
  if (!auth) {
    openSignInModal();
    return;
  }

  messageSendBtn.disabled = true;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'brokerSendMessage',
        brokerCode: auth.code,
        brokerName: auth.name,
        location: load.location,
        bol: load.inboundBol,
        message: text
      })
    });
    const data = await res.json();
    if (!data.ok) {
      showToast(data.error || 'Message did not send — try again.');
      return;
    }
    messageInput.value = '';
    load.messageCount = (load.messageCount || 0) + 1;
    await loadMessagesThread();
    renderLoadList();
  } catch (err) {
    showToast('Could not reach the server — check your connection.');
  } finally {
    messageSendBtn.disabled = false;
  }
}

// ---------- SEARCH ----------
// Looks up any BOL/carrier across every location and every day —
// including already-delivered loads — same as the warehouse team app's
// search, since the broker isn't restricted to just what's pending today.
function openSearchSheet() {
  searchInput.value = '';
  searchResultsEl.innerHTML = '<div class="search-empty">Type a BOL number or carrier name.</div>';
  searchSheet.classList.remove('hidden');
  setTimeout(function () { searchInput.focus(); }, 100);
}

function closeSearchSheet() {
  searchSheet.classList.add('hidden');
}

async function runSearch() {
  const auth = getBrokerAuth();
  const q = searchInput.value.trim();
  if (!q) {
    searchResultsEl.innerHTML = '<div class="search-empty">Type a BOL number or carrier name.</div>';
    return;
  }
  if (!auth) return;

  searchResultsEl.innerHTML = '<div class="search-empty">Searching…</div>';

  try {
    const url = API_URL + '?action=brokerSearch&code=' + encodeURIComponent(auth.code) +
      '&q=' + encodeURIComponent(q);
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) {
      searchResultsEl.innerHTML = '<div class="search-empty">' + escapeHtml(data.error || 'Search failed') + '</div>';
      return;
    }
    renderSearchResults(data.results);
  } catch (err) {
    searchResultsEl.innerHTML = '<div class="search-empty">Could not reach the server.</div>';
  }
}

function renderSearchResults(results) {
  if (!results || results.length === 0) {
    searchResultsEl.innerHTML = '<div class="search-empty">No matching loads found.</div>';
    return;
  }

  searchResultsEl.innerHTML = '';
  results.forEach(function (r) {
    const item = document.createElement('div');
    item.className = 'search-result';

    let statusText;
    if (r.arrived) {
      statusText = 'Delivered ' + formatArrivedAt(r.arrivedAt) + (r.arrivedDock ? ' · Dock ' + r.arrivedDock : '');
    } else if (r.change && r.change.type) {
      const labels = { RESCHEDULED: 'Rescheduled', DELAYED: 'Delayed', CANCELLED: 'Cancelled' };
      statusText = labels[r.change.type] || r.change.type;
    } else {
      statusText = 'Not yet arrived';
    }

    item.innerHTML =
      '<div class="search-result-top">' +
        '<span>BOL ' + escapeHtml(r.inboundBol) + '</span>' +
        '<span>' + escapeHtml(r.location) + '</span>' +
      '</div>' +
      '<div class="search-result-meta">' + escapeHtml(r.carrier || 'Carrier TBD') + ' · Scheduled ' +
        escapeHtml(r.inboundScheduled || '—') + ' ' + escapeHtml(r.appointmentTime || '') + '</div>' +
      '<div class="search-result-status ' + (r.arrived ? 'arrived' : 'pending') + '">' + escapeHtml(statusText) + '</div>';

    searchResultsEl.appendChild(item);
  });
}

function debounce(fn, ms) {
  let timer = null;
  return function () {
    const args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function () { fn.apply(null, args); }, ms);
  };
}

// ---------- MISC ----------
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function () { toastEl.classList.add('hidden'); }, 3200);
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Turns a pasted link (e.g. a Google Drive photo link) into a tappable
// link instead of dead text — the message itself stays plain text/HTML-
// escaped, only recognized URLs get wrapped in an anchor.
function linkifyMessage(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, function (url) {
    const clean = url.replace(/[),.]+$/, '');
    const trailing = url.slice(clean.length);
    return '<a href="' + clean + '" target="_blank" rel="noopener">' + clean + '</a>' + trailing;
  });
}

refreshBtn.addEventListener('click', loadData);
receiptsBtn.addEventListener('click', function () { window.open(RECEIPTS_FOLDER_URL, '_blank', 'noopener'); });
exportBtn.addEventListener('click', exportCsv);
notifyChipEl.addEventListener('click', toggleNotifications);
datePickerEl.addEventListener('change', onDatePicked);
searchBtn.addEventListener('click', openSearchSheet);
searchCloseBtn.addEventListener('click', closeSearchSheet);
searchSheet.addEventListener('click', function (e) { if (e.target === searchSheet) closeSearchSheet(); });
searchInput.addEventListener('input', debounce(runSearch, 350));

sheetCloseBtn.addEventListener('click', closeDetailSheet);
detailSheet.addEventListener('click', function (e) { if (e.target === detailSheet) closeDetailSheet(); });

messagesCloseBtn.addEventListener('click', closeMessagesSheet);
messagesSheet.addEventListener('click', function (e) { if (e.target === messagesSheet) closeMessagesSheet(); });
messageSendBtn.addEventListener('click', sendMessageFromInput);
messageInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendMessageFromInput(); });

// ---------- INIT ----------
buildDateChips();
renderLocationTabs();
renderGreeting();
renderNotifyChip();
updateStickyOffsets();
window.addEventListener('resize', updateStickyOffsets);
if (getBrokerAuth()) {
  revealAppShell();
  loadData();
} else {
  openSignInModal();
}
setInterval(function () {
  if (getBrokerAuth() && signInModal.classList.contains('hidden') && actionModal.classList.contains('hidden')) {
    loadData();
  }
}, AUTO_REFRESH_MS);
