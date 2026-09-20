// ---------- CONFIG ----------
// Same deployed Web App as the main app — keep these two files in sync
// if you ever redeploy to a new /exec URL.
const API_URL = 'https://script.google.com/macros/s/AKfycbyX6N102QHuhZoHGKIipl81DWO9lDIc-TtVm8g3_Pv2vybzKmDBjeVi4i0BdQg8dynsVw/exec';

const AUTO_REFRESH_MS = 60 * 1000;
const BROKER_AUTH_KEY = 'inboundTrackerBrokerAuth'; // { name, code }

// ---------- STATE ----------
let state = {
  loads: [],
  locations: [],  // unique location names seen in the last load, in order
  activeLocation: 'ALL', // 'ALL' or one location name
  selectedDate: toApiDateString(new Date()), // 'MM/dd/yyyy' or 'ALL'
  actionMode: null,     // 'reschedule' | 'delay' | 'cancel'
  actionLoad: null       // the load object the open action modal targets
};

// ---------- DOM ----------
const locationTabsEl = document.getElementById('locationTabs');
const dateChipsEl = document.getElementById('dateChips');
const loadListEl = document.getElementById('loadList');
const emptyStateEl = document.getElementById('emptyState');
const lastUpdatedEl = document.getElementById('lastUpdated');
const brokerGreetingEl = document.getElementById('brokerGreeting');

const refreshBtn = document.getElementById('refreshBtn');
const signOutBtn = document.getElementById('signOutBtn');

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

  updateStickyOffsets();
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

function openSignInModal(errorMsg) {
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

  // Group by location, pending loads first (by appointment time), then
  // delivered ones at the bottom of each location (most recently
  // arrived first) — so what still needs attention stays up top.
  visible
    .slice()
    .sort(function (a, b) {
      if (a.location !== b.location) return a.location.localeCompare(b.location);
      if (a.arrived !== b.arrived) return a.arrived ? 1 : -1;
      if (a.arrived && b.arrived) return new Date(b.arrivedAt) - new Date(a.arrivedAt);
      return String(a.appointmentTime).localeCompare(String(b.appointmentTime));
    })
    .forEach(function (load) {
      loadListEl.appendChild(renderLoadCard(load));
    });
}

function renderLoadCard(load) {
  const card = document.createElement('div');
  card.className = 'load-card' + (load.arrived ? ' arrived' : '');

  const change = load.change;
  const badge = load.arrived
    ? '<span class="status-pill arrived">Delivered ' + escapeHtml(formatArrivedAt(load.arrivedAt)) + '</span>'
    : (change ? renderChangeBadge(change) : '');
  const detail = (!load.arrived && change) ? renderChangeDetail(change) : '';

  card.innerHTML =
    '<div class="load-card-top">' +
      '<div>' +
        '<div class="load-time">' + escapeHtml(load.appointmentTime || '—') + '</div>' +
        '<div class="load-date">' + escapeHtml(load.location) + ' · ' + escapeHtml(load.inboundScheduled || '') + '</div>' +
      '</div>' +
      (badge || '<span class="status-pill pending">Pending</span>') +
    '</div>' +
    '<div class="load-bol">BOL ' + escapeHtml(String(load.inboundBol)) + '</div>' +
    '<div class="load-meta"><span><b>' + escapeHtml(load.carrier || '—') + '</b></span></div>' +
    detail;

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

function renderChangeBadge(change) {
  const labels = { RESCHEDULED: 'Rescheduled', DELAYED: 'Delayed', CANCELLED: 'Cancelled' };
  const cls = change.type.toLowerCase();
  return '<span class="change-badge ' + cls + '">' + (labels[change.type] || change.type) + '</span>';
}

function renderChangeDetail(change) {
  let text = '';
  if (change.type === 'RESCHEDULED') {
    text = 'New date: ' + escapeHtml(change.newDate || '—') + (change.newTime ? ' at ' + escapeHtml(change.newTime) : '');
  } else if (change.type === 'DELAYED') {
    text = 'New approx. ETA: ' + escapeHtml(change.newTime || '—');
  } else if (change.type === 'CANCELLED') {
    text = 'Marked cancelled';
  }
  if (change.notes) text += ' — ' + escapeHtml(change.notes);
  text += ' (by ' + escapeHtml(change.changedBy || 'broker') + ')';
  return '<div class="change-detail">' + text + '</div>';
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

// ---------- SEARCH ----------
// Looks up any BOL/carrier across every location and every day —
// including already-delivered loads — same as the gate crew app's
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

refreshBtn.addEventListener('click', loadData);
searchBtn.addEventListener('click', openSearchSheet);
searchCloseBtn.addEventListener('click', closeSearchSheet);
searchSheet.addEventListener('click', function (e) { if (e.target === searchSheet) closeSearchSheet(); });
searchInput.addEventListener('input', debounce(runSearch, 350));

// ---------- INIT ----------
buildDateChips();
renderLocationTabs();
renderGreeting();
updateStickyOffsets();
window.addEventListener('resize', updateStickyOffsets);
if (getBrokerAuth()) {
  loadData();
} else {
  openSignInModal();
}
setInterval(function () {
  if (getBrokerAuth() && signInModal.classList.contains('hidden') && actionModal.classList.contains('hidden')) {
    loadData();
  }
}, AUTO_REFRESH_MS);
