// ---------- CONFIG ----------
const API_URL = 'https://script.google.com/macros/s/AKfycbyX6N102QHuhZoHGKIipl81DWO9lDIc-TtVm8g3_Pv2vybzKmDBjeVi4i0BdQg8dynsVw/exec';

const AUTO_REFRESH_MS = 75 * 1000;
const WEATHER_REFRESH_MS = 15 * 60 * 1000; // weather changes slowly — 15 min is plenty
const AUTH_STORAGE_KEY = 'inboundTrackerAuth'; // { name, passcode }

// ---------- STATE ----------
let state = {
  locations: [],
  activeLocation: null,
  pendingAction: null // action to run automatically once sign-in succeeds
};

// ---------- DOM ----------
const locationTabsEl = document.getElementById('locationTabs');
const loadListEl = document.getElementById('loadList');
const emptyStateEl = document.getElementById('emptyState');
const lastUpdatedEl = document.getElementById('lastUpdated');
const userGreetingEl = document.getElementById('userGreeting');
const weatherPillEl = document.getElementById('weatherPill');

const refreshBtn = document.getElementById('refreshBtn');
const reportBtn = document.getElementById('reportBtn');
const userBtn = document.getElementById('userBtn');
const searchBtn = document.getElementById('searchBtn');

const detailSheet = document.getElementById('detailSheet');
const sheetContent = document.getElementById('sheetContent');
const sheetCloseBtn = document.getElementById('sheetCloseBtn');

const searchSheet = document.getElementById('searchSheet');
const searchInput = document.getElementById('searchInput');
const searchResultsEl = document.getElementById('searchResults');
const searchCloseBtn = document.getElementById('searchCloseBtn');

const signInModal = document.getElementById('signInModal');
const signInTitle = document.getElementById('signInTitle');
const nameInput = document.getElementById('nameInput');
const signInPasscodeInput = document.getElementById('signInPasscodeInput');
const signInError = document.getElementById('signInError');
const signInCancel = document.getElementById('signInCancel');
const signInConfirm = document.getElementById('signInConfirm');

const toastEl = document.getElementById('toast');

// ---------- INIT ----------
refreshBtn.addEventListener('click', () => loadData(true));
reportBtn.addEventListener('click', () => runGatedAction({ type: 'sendReport' }));
userBtn.addEventListener('click', () => openSignInModal({ type: 'noop' }, true));
searchBtn.addEventListener('click', openSearchSheet);

sheetCloseBtn.addEventListener('click', closeSheet);
detailSheet.addEventListener('click', (e) => { if (e.target === detailSheet) closeSheet(); });

searchCloseBtn.addEventListener('click', closeSearchSheet);
searchSheet.addEventListener('click', (e) => { if (e.target === searchSheet) closeSearchSheet(); });
searchInput.addEventListener('input', debounce(runSearch, 300));

signInCancel.addEventListener('click', closeSignInModal);
signInConfirm.addEventListener('click', confirmSignIn);
signInPasscodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmSignIn(); });

renderGreeting();
loadData(false);
loadWeather();
setInterval(() => loadData(true), AUTO_REFRESH_MS);
setInterval(loadWeather, WEATHER_REFRESH_MS);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// ---------- AUTH (sign in once per device) ----------
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
}

/**
 * Runs a passcode-gated action (mark arrived, undo, send report).
 * If this device already has saved credentials, it fires immediately —
 * no modal, no typing, so it doesn't slow anyone down. Only asks for
 * name + passcode the first time, or again if the server ever rejects
 * a saved passcode (e.g. it was changed).
 */
async function runGatedAction(action) {
  const auth = getAuth();
  if (!auth) {
    openSignInModal(action, false);
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
        passcode: auth.passcode,
        markedBy: auth.name,
        ...action.payload
      })
    });
    const json = await res.json();

    if (!json.ok) {
      // Saved passcode no longer valid — clear it and ask again.
      clearAuth();
      renderGreeting();
      showToast('Passcode no longer valid — please sign in again');
      openSignInModal(action, false);
      return;
    }

    closeSheet();
    if (action.type === 'sendReport') {
      showToast('Report sent');
    } else {
      showToast(action.type === 'markArrived' ? 'Marked arrived' : 'Arrival undone');
      await loadData(false);
    }
  } catch (err) {
    showToast('Network error — try again');
  }
}

function openSignInModal(action, isEditingProfile) {
  state.pendingAction = action;
  const auth = getAuth();
  signInTitle.textContent = isEditingProfile ? 'Your name' : 'Sign in once — we\'ll remember this device';
  nameInput.value = (auth && auth.name) || '';
  signInPasscodeInput.value = isEditingProfile && auth ? auth.passcode : '';
  signInError.classList.add('hidden');
  signInModal.classList.remove('hidden');
  setTimeout(() => (nameInput.value ? signInPasscodeInput : nameInput).focus(), 50);
}

function closeSignInModal() {
  signInModal.classList.add('hidden');
  state.pendingAction = null;
}

async function confirmSignIn() {
  const name = nameInput.value.trim();
  const passcode = signInPasscodeInput.value.trim();

  if (!name) {
    signInError.textContent = 'Enter your name';
    signInError.classList.remove('hidden');
    return;
  }
  if (!passcode) {
    signInError.textContent = 'Enter the passcode';
    signInError.classList.remove('hidden');
    return;
  }

  signInConfirm.disabled = true;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'verifyPasscode', passcode })
    });
    const json = await res.json();

    if (!json.ok) {
      signInError.textContent = 'Incorrect passcode';
      signInError.classList.remove('hidden');
      signInConfirm.disabled = false;
      return;
    }

    const auth = { name, passcode };
    saveAuth(auth);
    renderGreeting();

    const action = state.pendingAction;
    closeSignInModal();

    if (action && action.type !== 'noop') {
      await performAction(action, auth);
    } else {
      showToast('Saved');
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
  } catch (err) {
    // Weather is a nice-to-have — fail silently.
  }
}

// ---------- DATA LOADING ----------
async function loadData(isManualRefresh) {
  try {
    const res = await fetch(API_URL + '?action=data', { cache: 'no-store' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Failed to load data');

    state.locations = json.locations;
    if (!state.activeLocation && state.locations.length > 0) {
      state.activeLocation = state.locations[0].location;
    }

    renderTabs();
    renderLoadList();
    lastUpdatedEl.textContent = 'Updated ' + formatNow();
    if (isManualRefresh) showToast('Refreshed');
  } catch (err) {
    if (isManualRefresh) showToast('Refresh failed — check connection');
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
}

// ---------- RENDER: LOAD LIST ----------
function renderLoadList() {
  const active = state.locations.find((l) => l.location === state.activeLocation);
  loadListEl.innerHTML = '';

  if (!active || active.loads.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No inbound loads for this location.';
    loadListEl.appendChild(empty);
    return;
  }

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
  pill.className = 'status-pill ' + (load.arrived ? 'arrived' : 'pending');
  pill.textContent = load.arrived ? 'Arrived' : 'Pending';

  top.appendChild(timeBlock);
  top.appendChild(pill);

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
    arriveBtn.addEventListener('click', () => runGatedAction({
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
        inboundNotes: load.inboundNotes
      }
    }));
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
  `;
  detailSheet.classList.remove('hidden');
}

function detailRow(label, value) {
  return `<div class="detail-row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value || '—')}</span></div>`;
}

function closeSheet() {
  detailSheet.classList.add('hidden');
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
      ? 'Arrived ' + formatArrivedAtFull(r.arrivedAt) + (r.markedBy ? ' by ' + r.markedBy : '')
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

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------- TOAST ----------
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2200);
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
