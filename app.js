// ---------- CONFIG ----------
// Paste the /exec URL from your Apps Script Web App deployment here.
const API_URL = 'https://script.google.com/macros/s/AKfycbyX6N102QHuhZoHGKIipl81DWO9lDIc-TtVm8g3_Pv2vybzKmDBjeVi4i0BdQg8dynsVw/exec';

// How often to auto-refresh data (ms).
const AUTO_REFRESH_MS = 75 * 1000;

// ---------- STATE ----------
let state = {
  locations: [],       // [{ location, loads: [...] }]
  activeLocation: null,
  pendingAction: null   // { type: 'markArrived'|'unmarkArrived'|'sendReport', payload }
};

// ---------- DOM ----------
const locationTabsEl = document.getElementById('locationTabs');
const loadListEl = document.getElementById('loadList');
const emptyStateEl = document.getElementById('emptyState');
const lastUpdatedEl = document.getElementById('lastUpdated');
const refreshBtn = document.getElementById('refreshBtn');
const reportBtn = document.getElementById('reportBtn');

const detailSheet = document.getElementById('detailSheet');
const sheetContent = document.getElementById('sheetContent');
const sheetCloseBtn = document.getElementById('sheetCloseBtn');

const passcodeModal = document.getElementById('passcodeModal');
const passcodeTitle = document.getElementById('passcodeTitle');
const passcodeInput = document.getElementById('passcodeInput');
const passcodeError = document.getElementById('passcodeError');
const passcodeCancel = document.getElementById('passcodeCancel');
const passcodeConfirm = document.getElementById('passcodeConfirm');

const toastEl = document.getElementById('toast');

// ---------- INIT ----------
refreshBtn.addEventListener('click', () => loadData(true));
reportBtn.addEventListener('click', () => requestPasscodeFor({ type: 'sendReport' }, 'Send report — enter passcode'));
sheetCloseBtn.addEventListener('click', closeSheet);
detailSheet.addEventListener('click', (e) => { if (e.target === detailSheet) closeSheet(); });
passcodeCancel.addEventListener('click', closePasscodeModal);
passcodeConfirm.addEventListener('click', confirmPasscode);
passcodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmPasscode(); });

loadData(false);
setInterval(() => loadData(true), AUTO_REFRESH_MS);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
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
  const pa = parseTimeToMinutes(a);
  const pb = parseTimeToMinutes(b);
  return pa - pb;
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
    undoBtn.addEventListener('click', () => requestPasscodeFor(
      { type: 'unmarkArrived', payload: { location: load.location, bol: load.inboundBol } },
      'Undo arrival — enter passcode'
    ));
    actions.appendChild(undoBtn);
  } else {
    const arriveBtn = document.createElement('button');
    arriveBtn.className = 'btn btn-arrive';
    arriveBtn.textContent = 'Mark Arrived';
    arriveBtn.addEventListener('click', () => requestPasscodeFor(
      { type: 'markArrived', payload: { location: load.location, bol: load.inboundBol } },
      'Mark arrived — enter passcode'
    ));
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

// ---------- PASSCODE MODAL ----------
function requestPasscodeFor(action, title) {
  state.pendingAction = action;
  passcodeTitle.textContent = title;
  passcodeInput.value = '';
  passcodeError.classList.add('hidden');
  passcodeModal.classList.remove('hidden');
  setTimeout(() => passcodeInput.focus(), 50);
}

function closePasscodeModal() {
  passcodeModal.classList.add('hidden');
  state.pendingAction = null;
}

async function confirmPasscode() {
  const passcode = passcodeInput.value.trim();
  if (!passcode) return;

  const action = state.pendingAction;
  if (!action) return closePasscodeModal();

  passcodeConfirm.disabled = true;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: action.type, passcode, ...action.payload })
    });
    const json = await res.json();
    if (!json.ok) {
      passcodeError.textContent = json.error || 'Something went wrong';
      passcodeError.classList.remove('hidden');
      passcodeConfirm.disabled = false;
      return;
    }

    closePasscodeModal();
    closeSheet();

    if (action.type === 'sendReport') {
      showToast('Report sent');
    } else {
      showToast(action.type === 'markArrived' ? 'Marked arrived' : 'Arrival undone');
      await loadData(false);
    }
  } catch (err) {
    passcodeError.textContent = 'Network error — try again';
    passcodeError.classList.remove('hidden');
  } finally {
    passcodeConfirm.disabled = false;
  }
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
