'use strict';

/* ============ 1. Config & State ============ */
const AUTH_KEY = 'labtrack_auth_token';
let authToken = localStorage.getItem(AUTH_KEY) || null;
let currentUser = null;
let profileName = null;
let profileRole = 'student';
let currentTab = 'dashboard';
let tagCounter = 1;
let socket = null;

const KEYS = {
  equipment: 'lab:equipment',
  checkouts: 'lab:checkouts',
  maintenance: 'lab:maintenance',
  tagCounter: 'lab:tagCounter',
  notices: 'lab:notices',
  clientVersion: 'lab:client_version',
  approvedUsersMap: 'lab:approved_users_map'
};
const CURRENT_BUILD_VERSION = 'v4.0.0-premium';

/* ============ 2. API / Storage Helpers ============ */
function authHeaders(extra={}) {
  const h = {...extra};
  if(authToken) h['Authorization'] = 'Bearer ' + authToken;
  return h;
}
async function apiFetch(path, opts={}) {
  const res = await fetch(path, {...opts, headers: authHeaders(opts.headers||{})});
  if(res.status === 401){ doLogout(false); throw new Error('Session expired'); }
  return res;
}
async function storageGet(key, shared=false) {
  try {
    const res = await apiFetch(`/api/storage/${encodeURIComponent(key)}?shared=${shared}`);
    if(!res.ok) return null;
    const data = await res.json();
    return data.value ?? null;
  } catch(e) { return null; }
}
async function storageSet(key, value, shared=false) {
  try {
    const res = await apiFetch(`/api/storage/${encodeURIComponent(key)}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({value, shared})
    });
    return res.ok;
  } catch(e) { return false; }
}
async function loadList(key, shared=false) {
  const v = await storageGet(key, shared);
  if(!v) return [];
  try { return JSON.parse(v); } catch(e) { return []; }
}
async function saveList(key, arr, shared=false) { return storageSet(key, JSON.stringify(arr), shared); }

/* ============ 3. Utilities ============ */
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function fmtTime(ts) { return new Date(ts).toLocaleString(); }
function fmtDate(ts) { return new Date(ts).toLocaleDateString(); }
function esc(s) { return (s||'').toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function hoursBetween(a,b) { return Math.max(0,(b-a)/3600000); }

/* ============ 4. Theme ============ */
function initThemeToggle() {
  const theme = localStorage.getItem('labtrack_theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('labtrack_theme', next);
}

/* ============ 5. Toast ============ */
function showToast(message, type='info', duration=4000) {
  const container = document.getElementById('toastContainer');
  if(!container) return;
  const icons = { success:'✓', error:'✕', warn:'⚠', info:'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type]||'ℹ'}</span>
    <div class="toast-content"><div class="toast-msg">${esc(message)}</div></div>
    <button class="toast-close" aria-label="Dismiss">&times;</button>
  `;
  container.appendChild(toast);
  const remove = () => { toast.classList.add('hiding'); setTimeout(()=>toast.remove(),300); };
  toast.querySelector('.toast-close').onclick = remove;
  if(duration > 0) setTimeout(remove, duration);
}

/* ============ 6. Modal ============ */
function showModal({ title, body, footer, onClose }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-header">
        <h2 class="modal-title" id="modal-title">${title}</h2>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => { backdrop.remove(); if(onClose) onClose(); };
  backdrop.querySelector('.modal-close').onclick = close;
  backdrop.onclick = (e) => { if(e.target === backdrop) close(); };
  return close;
}

/* ============ 7. Socket.IO ============ */
function initSocket() {
  if(!authToken) return;
  if(typeof io !== 'undefined') {
    socket = io({ query: { token: authToken } });
    socket.on('equipment:update', ({ tag, status, collegeCode }) => {
      if(!currentUser || collegeCode !== currentUser.collegeCode) return;
      if(currentTab === 'inventory' || currentTab === 'checkout' || currentTab === 'dashboard') switchTab(currentTab);
      showToast(`Equipment status updated: ${status}`, 'info', 2000);
    });
    socket.on('storage:update', ({ key, collegeCode }) => {
      if(!currentUser || collegeCode !== currentUser.collegeCode) return;
      switchTab(currentTab);
    });
    socket.on('connect_error', () => { console.warn('[LabTrack] Real-time sync unavailable'); });
  }
}
function disconnectSocket() { if(socket) { socket.disconnect(); socket = null; } }

/* ============ 8. Auth Screens ============ */
function renderAuthScreen(mode, errorMsg) {
  const overlay = document.getElementById('authOverlay');
  overlay.style.display = 'flex';
  const card = document.getElementById('authCard');

  if(mode === 'login') {
    card.innerHTML = `
      <h1 class="auth-title" style="margin-top:0;">Welcome back</h1>
      <p class="auth-subtitle">Sign in to your LabTrack account</p>
      ${errorMsg ? `<div class="auth-error">⚠ ${esc(errorMsg)}</div>` : ''}
      <form id="loginForm" novalidate style="display:flex;flex-direction:column;gap:15px;">
        <div class="form-group">
          <label class="form-label">College Code</label>
          <input class="input" id="loCollegeCode" placeholder="e.g. GECX2026" autocomplete="organization" required />
        </div>
        <div class="form-group">
          <label class="form-label">Username</label>
          <input class="input" id="loUsername" autocomplete="username" required />
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <div class="input-wrapper">
            <input class="input" id="loPassword" type="password" autocomplete="current-password" required />
            <button type="button" class="input-action" id="toggleLoginPwd">👁</button>
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-full" id="loSubmit">Sign In</button>
      </form>
      <div class="auth-switch">New to LabTrack? <a id="toRegister" href="#">Create an account</a></div>
    `;
    document.getElementById('toggleLoginPwd').onclick = () => {
      const inp = document.getElementById('loPassword');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    };
    document.getElementById('toRegister').onclick = (e) => { e.preventDefault(); renderAuthScreen('register'); };
    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loSubmit');
      btn.disabled = true; btn.textContent = 'Signing in...';
      try {
        const res = await fetch('/api/auth/login', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            collegeCode: document.getElementById('loCollegeCode').value,
            username: document.getElementById('loUsername').value,
            password: document.getElementById('loPassword').value
          })
        });
        const data = await res.json();
        if(res.ok) { authToken = data.token; localStorage.setItem(AUTH_KEY, authToken); boot(); }
        else renderAuthScreen('login', data.error || 'Login failed');
      } catch(err) { renderAuthScreen('login', err.message); }
    };
  } else {
    card.innerHTML = `
      <h1 class="auth-title" style="margin-top:0;">Create Account</h1>
      <p class="auth-subtitle">Register your lab with LabTrack</p>
      ${errorMsg ? `<div class="auth-error">⚠ ${esc(errorMsg)}</div>` : ''}
      <form id="regForm" novalidate style="display:flex;flex-direction:column;gap:15px;">
        <div class="form-group">
          <label class="form-label">College Code</label>
          <input class="input" id="regCollegeCode" placeholder="e.g. GECX2026" required />
        </div>
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input class="input" id="regFullName" required />
        </div>
        <div class="form-group">
          <label class="form-label">Username</label>
          <input class="input" id="regUsername" required />
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input class="input" id="regPassword" type="password" required />
        </div>
        <button type="submit" class="btn btn-primary btn-full" id="regSubmit">Register</button>
      </form>
      <div class="auth-switch">Already have an account? <a id="toLogin" href="#">Sign in</a></div>
    `;
    document.getElementById('toLogin').onclick = (e) => { e.preventDefault(); renderAuthScreen('login'); };
    document.getElementById('regForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('regSubmit');
      btn.disabled = true; btn.textContent = 'Registering...';
      try {
        const res = await fetch('/api/auth/register', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            collegeCode: document.getElementById('regCollegeCode').value,
            fullName: document.getElementById('regFullName').value,
            username: document.getElementById('regUsername').value,
            password: document.getElementById('regPassword').value
          })
        });
        const data = await res.json();
        if(res.ok) renderAuthScreen('login', 'Registration successful! Please sign in.');
        else renderAuthScreen('register', data.error || 'Registration failed');
      } catch(err) { renderAuthScreen('register', err.message); }
    };
  }
}

/* ============ 9. App Shell ============ */
function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  if(!sidebar) return;
  const items = [
    { id:'dashboard', icon:'📊', label:'Dashboard', roles:['student','incharge','owner'] },
    { id:'inventory', icon:'📦', label:'Equipment', roles:['student','incharge','owner'] },
    { id:'scan', icon:'📱', label:'Scan QR', roles:['student','incharge','owner'] },
    { id:'checkout', icon:'🔄', label:'Checkout', roles:['student','incharge','owner'] },
    { id:'maintenance', icon:'🔧', label:'Maintenance', roles:['student','incharge','owner'] },
    { id:'usage', icon:'📝', label:'Usage Log', roles:['incharge','owner'] },
    { id:'notices', icon:'📢', label:'Notices', roles:['student','incharge','owner'] },
    { id:'users', icon:'👥', label:'Users', roles:['incharge','owner'] },
    { id:'analytics', icon:'📈', label:'Analytics', roles:['student','incharge','owner'] }
  ];
  let html = '<ul style="list-style:none;padding:0;margin:0;">';
  items.forEach(item => {
    if(item.roles.includes(profileRole)) {
      const active = currentTab === item.id ? 'background:var(--paper-subtle);color:var(--accent);font-weight:600;border-left:3px solid var(--accent);' : 'color:var(--ink-soft);border-left:3px solid transparent;';
      html += `<li><a href="#" onclick="switchTab('${item.id}');return false;" style="display:flex;align-items:center;padding:11px 20px;text-decoration:none;gap:12px;font-size:0.9rem;transition:all 0.2s;${active}">
        <span>${item.icon}</span><span>${item.label}</span></a></li>`;
    }
  });
  html += '</ul>';
  sidebar.innerHTML = html;
}

function renderTopbarActions() {
  const box = document.getElementById('topbarActions');
  if(!box) return;
  const currentTheme = localStorage.getItem('labtrack_theme') || 'light';
  box.innerHTML = `
    <button class="icon-btn" id="themeToggleBtn" title="Toggle theme">${currentTheme === 'dark' ? '☀️' : '🌙'}</button>
    <button class="icon-btn" id="notifBellBtn" title="Notifications" style="position:relative;">
      🔔<span id="notifBadge" style="display:none;position:absolute;top:-2px;right:-2px;background:var(--rust);color:white;border-radius:50%;font-size:9px;padding:1px 4px;font-weight:700;"></span>
    </button>
    <div style="display:flex;align-items:center;gap:8px;padding:0 8px;">
      <span class="dot"></span>
      <span class="fw-600 text-sm">${esc(profileName)}</span>
      <span class="badge ${profileRole==='owner'?'badge-owner':profileRole==='incharge'?'badge-incharge':'badge-student'}">${esc(profileRole)}</span>
    </div>
    <button class="btn btn-secondary btn-sm" id="logoutBtn">Log out</button>
  `;
  document.getElementById('themeToggleBtn').onclick = () => {
    toggleTheme();
    document.getElementById('themeToggleBtn').textContent = localStorage.getItem('labtrack_theme')==='dark' ? '☀️' : '🌙';
  };
  document.getElementById('logoutBtn').onclick = () => doLogout(true);
  document.getElementById('notifBellBtn').onclick = async () => {
    const notifs = await loadList(`lab:notifications:${currentUser.id}`, true);
    showModal({
      title: '🔔 Notifications',
      body: notifs.length ? notifs.map(n => `
        <div style="padding:10px;border:1px solid var(--grid);border-radius:8px;margin-bottom:8px;border-left:3px solid ${n.read?'var(--grid)':'var(--accent)'};">
          <div class="fw-600 text-sm">${esc(n.title)}</div>
          <div class="text-sm text-soft">${esc(n.message)}</div>
          <div style="font-size:0.75rem;color:var(--ink-soft);margin-top:4px;">${fmtTime(n.time)}</div>
        </div>`).join('') : '<div class="empty-state"><div class="empty-state-icon">🔔</div><div class="empty-state-title">No notifications</div></div>'
    });
    notifs.forEach(n => n.read = true);
    await saveList(`lab:notifications:${currentUser.id}`, notifs, true);
    const badge = document.getElementById('notifBadge');
    if(badge) badge.style.display = 'none';
  };
  loadList(`lab:notifications:${currentUser.id}`, true).then(notifs => {
    const unread = notifs.filter(n => !n.read).length;
    const badge = document.getElementById('notifBadge');
    if(badge && unread > 0) { badge.textContent = unread; badge.style.display = 'block'; }
  });
}

/* ============ 10. Dashboard ============ */
async function renderDashboard() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Dashboard</h1><p class="page-subtitle">Welcome back, ${esc(profileName)}</p></div>
      ${profileRole !== 'student' ? '<div class="page-actions"><button class="btn btn-primary" id="dashAddBtn">+ Add Equipment</button></div>' : ''}
    </div>
    <div class="dashboard-grid" id="statsGrid">
      ${[1,2,3,4].map(()=>'<div class="skeleton skeleton-card"></div>').join('')}
    </div>
    <div class="content-grid">
      <div class="card"><div class="card-header"><span class="card-title">Active Checkouts</span></div><div id="activeCheckouts">Loading...</div></div>
      <div class="card"><div class="card-header"><span class="card-title">Recent Activity</span></div><div id="recentActivity">Loading...</div></div>
    </div>
  `;
  document.getElementById('dashAddBtn')?.addEventListener('click', () => switchTab('inventory'));
  const [equipment, checkouts] = await Promise.all([loadList(KEYS.equipment,true), loadList(KEYS.checkouts,true)]);
  const total = equipment.length;
  const available = equipment.filter(e=>e.status==='available').length;
  const checkedOut = equipment.filter(e=>e.status==='checked-out').length;
  const maintenance = equipment.filter(e=>e.status==='maintenance').length;
  document.getElementById('statsGrid').innerHTML = `
    ${statCard('📦','Total Equipment',total,'stat-icon-blue')}
    ${statCard('✅','Available',available,'stat-icon-green')}
    ${statCard('🔄','Checked Out',checkedOut,'stat-icon-amber')}
    ${statCard('🔧','Maintenance',maintenance,'stat-icon-red')}
  `;
  const active = checkouts.filter(c=>c.status==='active');
  document.getElementById('activeCheckouts').innerHTML = active.length
    ? active.slice(0,5).map(c=>`<div style="padding:8px 0;border-bottom:1px solid var(--grid);"><strong>${esc(c.equipmentName||c.tag)}</strong><br><span class="text-sm text-soft">${esc(c.userName)} · ${fmtDate(c.checkedOutAt||c.createdAt)}</span></div>`).join('')
    : '<div class="empty-state" style="padding:20px;"><div class="empty-state-icon">📋</div><div class="empty-state-title">No active checkouts</div></div>';
  document.getElementById('recentActivity').innerHTML = checkouts.length
    ? checkouts.slice(0,5).map(c=>`<div style="padding:8px 0;border-bottom:1px solid var(--grid);">${esc(c.userName)} ${c.status==='active'?'checked out':'returned'} <strong>${esc(c.equipmentName||c.tag)}</strong></div>`).join('')
    : '<div class="empty-state" style="padding:20px;"><div class="empty-state-icon">📝</div><div class="empty-state-title">No activity yet</div></div>';
}

/* ============ 11. Equipment Inventory ============ */
async function renderInventory() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Equipment Inventory</h1></div>
      ${profileRole !== 'student' ? '<div class="page-actions"><button class="btn btn-primary" id="addEquipBtn">+ Add Equipment</button></div>' : ''}
    </div>
    <div class="search-bar">
      <div class="search-input-wrapper"><span class="search-icon">🔍</span><input class="input" id="invSearch" placeholder="Search equipment..." /></div>
    </div>
    <div id="inventoryContent"></div>
  `;
  document.getElementById('addEquipBtn')?.addEventListener('click', () => {
    const closeModal = showModal({
      title: 'Add Equipment',
      body: `
        <div class="form-group"><label class="form-label">Name</label><input class="input" id="eqName" placeholder="Equipment name" /></div>
        <div class="form-group"><label class="form-label">Category</label><input class="input" id="eqCategory" placeholder="e.g. Microscope" /></div>
        <div class="form-group"><label class="form-label">Department</label><input class="input" id="eqDept" placeholder="e.g. Biology" /></div>
      `,
      footer: '<button class="btn btn-secondary" id="cancelEq">Cancel</button><button class="btn btn-primary" id="saveEq">Add Equipment</button>'
    });
    document.getElementById('cancelEq')?.addEventListener('click', closeModal);
    document.getElementById('saveEq')?.addEventListener('click', async () => {
      const name = document.getElementById('eqName')?.value.trim();
      const cat = document.getElementById('eqCategory')?.value.trim();
      const dept = document.getElementById('eqDept')?.value.trim();
      if(!name) { showToast('Enter equipment name','warn'); return; }
      const eq = await loadList(KEYS.equipment, true);
      const tag = `LT-${String(tagCounter++).padStart(4,'0')}`;
      await storageSet(KEYS.tagCounter, tagCounter, true);
      eq.push({ id:uid(), tag, name, category:cat||'General', department:dept||'', status:'available', collegeCode:currentUser.collegeCode, createdAt:Date.now() });
      await saveList(KEYS.equipment, eq, true);
      showToast('Equipment added!', 'success');
      closeModal();
      renderInventory();
    });
  });

  const renderList = async () => {
    const items = await loadList(KEYS.equipment, true);
    const q = (document.getElementById('invSearch')?.value||'').toLowerCase();
    const filtered = q ? items.filter(e=>(e.name||'').toLowerCase().includes(q)||(e.tag||'').toLowerCase().includes(q)||(e.category||'').toLowerCase().includes(q)) : items;
    const el = document.getElementById('inventoryContent');
    if(!filtered.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-title">No equipment found</div><div class="empty-state-desc">Add equipment using the button above.</div></div>';
      return;
    }
    el.innerHTML = `<div class="table-wrapper"><table class="data-table"><thead><tr><th>Tag</th><th>Name</th><th>Category</th><th>Status</th><th>Holder</th><th>Actions</th></tr></thead><tbody>
      ${filtered.map(e=>`<tr>
        <td class="mono text-accent">${esc(e.tag)}</td>
        <td class="fw-600">${esc(e.name)}</td>
        <td class="text-soft">${esc(e.category||'')}</td>
        <td>${statusBadge(e.status)}</td>
        <td class="text-sm text-soft">${e.currentHolder?esc(e.currentHolder.name||e.currentHolder.username):'—'}</td>
        <td style="display:flex;gap:6px;">
          ${e.status==='available'?`<button class="btn btn-sm btn-primary" onclick="doCheckout('${esc(e.tag)}','${esc(e.name)}')">Checkout</button>`:''}
          ${e.status==='checked-out'?`<button class="btn btn-sm btn-secondary" onclick="doReturn('${esc(e.tag)}',null,'${esc(e.name)}')">Return</button>`:''}
        </td>
      </tr>`).join('')}
    </tbody></table></div>`;
  };
  await renderList();
  let t; document.getElementById('invSearch')?.addEventListener('input', ()=>{clearTimeout(t);t=setTimeout(renderList,300);});
}

function statusBadge(status) {
  const map = { 'available':'badge-available', 'checked-out':'badge-checked-out', 'maintenance':'badge-maintenance' };
  return `<span class="badge ${map[status]||'badge-neutral'}">${esc(status||'unknown')}</span>`;
}

/* ============ 12. QR Scanner ============ */
async function renderScan() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Scan QR Code</h1><p class="page-subtitle">Point camera at equipment QR code or enter tag manually</p></div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;">
      <div class="card">
        <div class="card-header"><span class="card-title">Camera Scanner</span></div>
        <div style="padding:16px;">
          <div style="position:relative;width:100%;max-width:340px;margin:0 auto;border-radius:12px;overflow:hidden;background:#000;">
            <video id="scanVideo" style="width:100%;display:block;" autoplay playsinline muted></video>
            <canvas id="scanCanvas" style="display:none;"></canvas>
            <div style="position:absolute;inset:0;border:3px solid rgba(36,128,107,0.6);border-radius:12px;pointer-events:none;"></div>
          </div>
          <p class="text-sm text-soft" style="text-align:center;margin-top:12px;" id="scanStatus">Starting camera…</p>
          <button class="btn btn-secondary btn-full" id="stopCameraBtn" style="margin-top:8px;display:none;">Stop Camera</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Manual Lookup</span></div>
        <div style="padding:16px;">
          <div class="form-group"><label class="form-label">Equipment Tag</label><input class="input" id="manualTag" placeholder="e.g. LT-0001" /></div>
          <button class="btn btn-primary btn-full" id="manualLookupBtn">Look Up</button>
        </div>
        <div id="scanResult" style="padding:0 16px 16px;"></div>
      </div>
    </div>`;

  let videoStream = null, scanning = false;

  async function showEquipmentResult(eq) {
    const result = document.getElementById('scanResult');
    if(!eq) { result.innerHTML = '<div class="auth-error">⚠ Equipment not found</div>'; return; }
    result.innerHTML = `
      <div class="card" style="border:2px solid var(--accent);">
        <div style="padding:16px;">
          <div class="fw-700" style="font-size:1.1rem;">${esc(eq.name||'Unknown')}</div>
          <div class="mono text-accent text-sm" style="margin:4px 0;">${esc(eq.tag||eq.qrTag||'')}</div>
          <div style="margin:8px 0;">${statusBadge(eq.status)}</div>
          <div class="text-sm text-soft">Category: ${esc(eq.category||'—')}</div>
          ${eq.currentHolder?`<div class="text-sm text-soft">Holder: <strong>${esc(eq.currentHolder.name||eq.currentHolder.username||'')}</strong></div>`:''}
          <div style="margin-top:12px;display:flex;gap:8px;">
            ${eq.status==='available'?`<button class="btn btn-primary" onclick="doCheckout('${esc(eq.tag||eq.qrTag||'')}','${esc(eq.name||'')}')">Checkout</button>`:''}
            ${eq.status==='checked-out'&&eq.currentHolder&&eq.currentHolder.id===currentUser?.id?`<button class="btn btn-secondary" onclick="doReturn('${esc(eq.tag||eq.qrTag||'')}',null,'${esc(eq.name||'')}')">Return</button>`:''}
          </div>
        </div>
      </div>`;
  }

  async function lookupByTag(tag) {
    const equipment = await loadList(KEYS.equipment, true);
    const eq = equipment.find(e=>(e.tag||e.qrTag||'').toLowerCase()===tag.toLowerCase());
    await showEquipmentResult(eq||null);
  }

  document.getElementById('manualLookupBtn')?.addEventListener('click', () => {
    const tag = document.getElementById('manualTag')?.value.trim();
    if(!tag) { showToast('Enter a tag','warn'); return; }
    lookupByTag(tag);
  });
  document.getElementById('manualTag')?.addEventListener('keydown', (e) => {
    if(e.key==='Enter') { const tag=e.target.value.trim(); if(tag) lookupByTag(tag); }
  });

  const video = document.getElementById('scanVideo');
  const canvas = document.getElementById('scanCanvas');
  const ctx = canvas?.getContext('2d');
  const statusEl = document.getElementById('scanStatus');

  async function startCamera() {
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment' } });
      if(!video) return;
      video.srcObject = videoStream; video.play();
      document.getElementById('stopCameraBtn').style.display = 'block';
      statusEl.textContent = 'Camera active — point at a QR code';
      scanning = true; scanFrame();
    } catch(err) {
      if(statusEl) statusEl.textContent = 'Camera unavailable. Use manual lookup.';
    }
  }

  function scanFrame() {
    if(!scanning||!video||!canvas||!ctx) return;
    if(video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if(typeof jsQR !== 'undefined') {
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts:'dontInvert' });
        if(code && code.data) {
          scanning = false;
          if(statusEl) statusEl.textContent = `✓ Scanned: ${code.data}`;
          const tag = code.data.replace(/^LABTRACK:/i,'').trim();
          document.getElementById('manualTag').value = tag;
          lookupByTag(tag);
          setTimeout(()=>{ scanning=true; scanFrame(); if(statusEl) statusEl.textContent='Camera active — point at a QR code'; }, 4000);
          return;
        }
      }
    }
    requestAnimationFrame(scanFrame);
  }

  function stopCamera() {
    scanning = false;
    if(videoStream) { videoStream.getTracks().forEach(t=>t.stop()); videoStream = null; }
    if(video) video.srcObject = null;
    document.getElementById('stopCameraBtn').style.display = 'none';
    if(statusEl) statusEl.textContent = 'Camera stopped.';
  }

  document.getElementById('stopCameraBtn')?.addEventListener('click', stopCamera);
  window._scanCleanup = stopCamera;
  startCamera();
}

/* ============ 13. Checkout / Return ============ */
async function doCheckout(tag, equipmentName) {
  const ok = window.confirm(`Checkout "${equipmentName}" (${tag})?\n\nYou are responsible for returning this equipment.`);
  if(!ok) return;
  try {
    const res = await apiFetch(`/api/equipment/${encodeURIComponent(tag)}/checkout`, { method:'POST', headers:{'Content-Type':'application/json'} });
    if(res.ok) {
      showToast(`Checked out: ${equipmentName}`, 'success');
      const chkList = await loadList(KEYS.checkouts, true);
      chkList.unshift({ id:uid(), tag, equipmentTag:tag, equipmentName, userId:currentUser.id, userName:currentUser.fullName||currentUser.username, status:'active', checkedOutAt:Date.now() });
      await saveList(KEYS.checkouts, chkList, true);
      if(currentTab==='inventory') renderInventory();
      else if(currentTab==='checkout') renderCheckout();
      else if(currentTab==='dashboard') renderDashboard();
    } else {
      const err = await res.json().catch(()=>({}));
      showToast(err.error||'Checkout failed.','error');
    }
  } catch(e) { showToast('Checkout failed: '+e.message,'error'); }
}

async function doReturn(tag, checkoutId, equipmentName) {
  const ok = window.confirm(`Return "${equipmentName||tag}"?`);
  if(!ok) return;
  try {
    const res = await apiFetch(`/api/equipment/${encodeURIComponent(tag)}/return`, { method:'POST', headers:{'Content-Type':'application/json'} });
    if(res.ok) {
      showToast(`Returned: ${equipmentName||tag}`, 'success');
      const chkList = await loadList(KEYS.checkouts, true);
      const chk = chkList.find(c=>(c.tag===tag||c.equipmentTag===tag)&&c.status==='active');
      if(chk) { chk.status='returned'; chk.returnedAt=Date.now(); await saveList(KEYS.checkouts, chkList, true); }
      if(currentTab==='inventory') renderInventory();
      else if(currentTab==='checkout') renderCheckout();
      else if(currentTab==='dashboard') renderDashboard();
    } else {
      const err = await res.json().catch(()=>({}));
      showToast(err.error||'Return failed.','error');
    }
  } catch(e) { showToast('Return failed: '+e.message,'error'); }
}

/* ============ 14. Maintenance ============ */
async function renderMaintenance() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Maintenance</h1><p class="page-subtitle">Track and resolve equipment issues</p></div>
      <div class="page-actions">
        <button class="btn btn-primary" id="reportMaintBtn">+ Report Issue</button>
        ${profileRole!=='student'?'<button class="btn btn-secondary" id="showResolvedBtn">Show Resolved</button>':''}
      </div>
    </div>
    <div class="search-bar"><div class="search-input-wrapper"><span class="search-icon">🔍</span><input class="input" id="maintSearch" placeholder="Search issues..." /></div></div>
    <div id="maintList"></div>
  `;
  let showResolved = false;
  const renderList = async () => {
    const listEl = document.getElementById('maintList');
    const all = await loadList(KEYS.maintenance, true);
    let filtered = all.filter(m=>showResolved ? m.status==='resolved' : m.status!=='resolved');
    const q = (document.getElementById('maintSearch')?.value||'').toLowerCase();
    if(q) filtered = filtered.filter(m=>(m.equipmentName||'').toLowerCase().includes(q)||(m.description||'').toLowerCase().includes(q));
    if(!filtered.length) { listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔧</div><div class="empty-state-title">No issues found</div></div>'; return; }
    const pMap = { critical:'badge-critical', high:'badge-high', medium:'badge-medium', low:'badge-low' };
    const sMap = { open:'badge-checked-out', 'in-progress':'badge-maintenance', resolved:'badge-available' };
    listEl.innerHTML = `<div class="table-wrapper"><table class="data-table"><thead><tr><th>Equipment</th><th>Issue</th><th>Priority</th><th>Status</th><th>Reported</th><th>By</th>${profileRole!=='student'?'<th>Action</th>':''}</tr></thead><tbody>
      ${filtered.map(m=>`<tr>
        <td class="fw-600">${esc(m.equipmentName||m.equipmentTag||'Unknown')}</td>
        <td style="max-width:200px;" class="truncate">${esc(m.description||'')}</td>
        <td><span class="badge ${pMap[m.priority]||'badge-neutral'}">${esc(m.priority||'')}</span></td>
        <td><span class="badge ${sMap[m.status]||'badge-neutral'}">${esc(m.status||'')}</span></td>
        <td class="text-sm text-soft">${fmtDate(m.reportedAt||m.createdAt)}</td>
        <td class="text-sm">${esc(m.reportedByName||'')}</td>
        ${profileRole!=='student'?`<td>${m.status!=='resolved'?`<button class="btn btn-sm btn-primary" onclick="resolveMaintenance('${esc(m.id)}')">Resolve</button>`:'<span class="text-soft text-sm">Done</span>'}</td>`:''}</tr>`).join('')}
    </tbody></table></div>`;
  };
  await renderList();
  let t; document.getElementById('maintSearch')?.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(renderList,300);});
  document.getElementById('showResolvedBtn')?.addEventListener('click', async()=>{
    showResolved=!showResolved;
    document.getElementById('showResolvedBtn').textContent=showResolved?'Show Open':'Show Resolved';
    await renderList();
  });
  document.getElementById('reportMaintBtn')?.addEventListener('click', showReportMaintenanceModal);
}

async function resolveMaintenance(id) {
  const all = await loadList(KEYS.maintenance, true);
  const m = all.find(x=>x.id===id); if(!m) return;
  m.status='resolved'; m.resolvedAt=Date.now(); m.resolvedBy=currentUser.fullName||currentUser.username;
  await saveList(KEYS.maintenance, all, true);
  const eqList = await loadList(KEYS.equipment, true);
  const eq = eqList.find(e=>(e.tag||e.qrTag)===(m.equipmentTag||m.tag));
  if(eq && eq.status==='maintenance') { eq.status='available'; await saveList(KEYS.equipment, eqList, true); }
  showToast('Issue resolved!','success'); renderMaintenance();
}

function showReportMaintenanceModal() {
  const closeModal = showModal({
    title: 'Report Maintenance Issue',
    body: `
      <div class="form-group"><label class="form-label">Equipment Tag</label><input class="input" id="mEquipTag" placeholder="e.g. LT-0001" /></div>
      <div class="form-group"><label class="form-label">Equipment Name</label><input class="input" id="mEquipName" placeholder="Equipment name" /></div>
      <div class="form-group"><label class="form-label">Issue Description</label><textarea class="input" id="mDesc" rows="3" placeholder="Describe the issue..." style="height:auto;padding:8px;resize:vertical;"></textarea></div>
      <div class="form-group"><label class="form-label">Priority</label>
        <select class="input" id="mPriority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select>
      </div>`,
    footer: '<button class="btn btn-secondary" id="cancelMaint">Cancel</button><button class="btn btn-primary" id="submitMaint">Report Issue</button>'
  });
  document.getElementById('cancelMaint')?.addEventListener('click', closeModal);
  document.getElementById('submitMaint')?.addEventListener('click', async()=>{
    const tag=document.getElementById('mEquipTag')?.value.trim();
    const name=document.getElementById('mEquipName')?.value.trim();
    const desc=document.getElementById('mDesc')?.value.trim();
    const priority=document.getElementById('mPriority')?.value;
    if(!desc) { showToast('Enter a description','warn'); return; }
    const all = await loadList(KEYS.maintenance, true);
    all.unshift({ id:uid(), equipmentTag:tag, equipmentName:name||tag, description:desc, priority, status:'open', reportedBy:currentUser.id, reportedByName:currentUser.fullName||currentUser.username, reportedAt:Date.now(), collegeCode:currentUser.collegeCode });
    await saveList(KEYS.maintenance, all, true);
    if(tag) { const eqList=await loadList(KEYS.equipment,true); const eq=eqList.find(e=>(e.tag||e.qrTag)===tag); if(eq){eq.status='maintenance';await saveList(KEYS.equipment,eqList,true);} }
    showToast('Issue reported!','success'); closeModal(); renderMaintenance();
  });
}

/* ============ 15. Usage Log ============ */
async function renderUsage() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Usage Log</h1><p class="page-subtitle">Complete equipment activity history</p></div></div>
    <div class="search-bar"><div class="search-input-wrapper"><span class="search-icon">🔍</span><input class="input" id="usageSearch" placeholder="Search by equipment or user..." /></div></div>
    <div id="usageList"></div>`;
  const renderList = async () => {
    const listEl = document.getElementById('usageList');
    const checkouts = await loadList(KEYS.checkouts, true);
    const q = (document.getElementById('usageSearch')?.value||'').toLowerCase();
    const filtered = q ? checkouts.filter(c=>(c.equipmentName||c.tag||'').toLowerCase().includes(q)||(c.userName||'').toLowerCase().includes(q)) : checkouts;
    if(!filtered.length) { listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div><div class="empty-state-title">No activity yet</div></div>'; return; }
    listEl.innerHTML = `<div class="table-wrapper"><table class="data-table"><thead><tr><th>Equipment</th><th>User</th><th>Action</th><th>Date</th><th>Duration</th><th>Status</th></tr></thead><tbody>
      ${filtered.slice().reverse().map(c=>`<tr>
        <td class="fw-600">${esc(c.equipmentName||c.tag||'')}</td>
        <td>${esc(c.userName||'')}</td>
        <td>${c.returnedAt?'↩ Return':'↗ Checkout'}</td>
        <td class="text-sm text-soft">${fmtTime(c.checkedOutAt||c.createdAt)}</td>
        <td class="text-sm">${c.returnedAt?(hoursBetween(c.checkedOutAt,c.returnedAt).toFixed(1)+'h'):(c.status==='active'?'Active':'—')}</td>
        <td><span class="badge ${c.status==='active'?'badge-checked-out':'badge-available'}">${esc(c.status||'')}</span></td>
      </tr>`).join('')}
    </tbody></table></div>`;
  };
  await renderList();
  let t; document.getElementById('usageSearch')?.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(renderList,300);});
}

/* ============ 16. Notices ============ */
async function renderNotices() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Notices & Updates</h1><p class="page-subtitle">Important announcements from lab management</p></div>
      ${profileRole!=='student'?'<div class="page-actions"><button class="btn btn-primary" id="postNoticeBtn">+ Post Notice</button></div>':''}
    </div>
    <div id="noticesList"></div>`;
  const renderList = async () => {
    const listEl = document.getElementById('noticesList');
    const notices = await loadList(KEYS.notices, true);
    if(!notices.length) { listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📢</div><div class="empty-state-title">No notices yet</div></div>'; return; }
    listEl.innerHTML = notices.map(n=>`
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="fw-700">${esc(n.title||'Notice')}</span><span class="text-sm text-soft">${fmtDate(n.time||n.createdAt)}</span></div>
        <p style="color:var(--ink-soft);font-size:0.9rem;line-height:1.6;margin:0;">${esc(n.desc||n.message||'')}</p>
        ${n.type==='SYSTEM'?'<span class="badge badge-neutral" style="margin-top:8px;display:inline-block;">System</span>':''}
      </div>`).join('');
  };
  await renderList();
  if(profileRole!=='student') {
    document.getElementById('postNoticeBtn')?.addEventListener('click', ()=>{
      const closeModal = showModal({
        title: 'Post a Notice',
        body: `
          <div class="form-group"><label class="form-label">Title</label><input class="input" id="nTitle" placeholder="Notice title" /></div>
          <div class="form-group"><label class="form-label">Message</label><textarea class="input" id="nDesc" rows="4" placeholder="Notice content..." style="height:auto;padding:8px;resize:vertical;"></textarea></div>`,
        footer: '<button class="btn btn-secondary" id="cancelNotice">Cancel</button><button class="btn btn-primary" id="submitNotice">Post</button>'
      });
      document.getElementById('cancelNotice')?.addEventListener('click', closeModal);
      document.getElementById('submitNotice')?.addEventListener('click', async()=>{
        const title=document.getElementById('nTitle')?.value.trim();
        const desc=document.getElementById('nDesc')?.value.trim();
        if(!title||!desc) { showToast('Fill in all fields','warn'); return; }
        const notices=await loadList(KEYS.notices,true);
        notices.unshift({id:uid(),title,desc,type:'NORMAL',time:Date.now(),author:currentUser.fullName||currentUser.username});
        await saveList(KEYS.notices,notices,true);
        showToast('Notice posted!','success'); closeModal(); renderNotices();
      });
    });
  }
}

/* ============ 17. Users ============ */
async function renderUsers() {
  if(profileRole!=='incharge'&&profileRole!=='owner') {
    document.getElementById('main').innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔒</div><div class="empty-state-title">Access Denied</div></div>';
    return;
  }
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">User Management</h1><p class="page-subtitle">Manage users in your college</p></div></div>
    <div class="search-bar"><div class="search-input-wrapper"><span class="search-icon">🔍</span><input class="input" id="userSearch" placeholder="Search users..." /></div></div>
    <div id="usersList"></div>`;
  const renderList = async () => {
    const listEl = document.getElementById('usersList');
    const res = await apiFetch('/api/auth/users').catch(()=>null);
    let users = [];
    if(res&&res.ok) { const d=await res.json(); users=d.users||[]; }
    const q=(document.getElementById('userSearch')?.value||'').toLowerCase();
    const filtered = q ? users.filter(u=>(u.fullName||'').toLowerCase().includes(q)||(u.username||'').toLowerCase().includes(q)) : users;
    if(!filtered.length) { listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-title">No users found</div></div>'; return; }
    const rMap={owner:'badge-owner',incharge:'badge-incharge',student:'badge-student'};
    const sMap={approved:'badge-available',pending:'badge-checked-out'};
    listEl.innerHTML = `<div class="table-wrapper"><table class="data-table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Joined</th>${profileRole==='owner'?'<th>Actions</th>':''}</tr></thead><tbody>
      ${filtered.map(u=>`<tr>
        <td class="fw-600">${esc(u.fullName||u.username)}</td>
        <td class="mono text-soft">${esc(u.username)}</td>
        <td><span class="badge ${rMap[u.role]||'badge-neutral'}">${esc(u.role)}</span></td>
        <td><span class="badge ${sMap[u.status]||'badge-neutral'}">${esc(u.status||'pending')}</span></td>
        <td class="text-sm text-soft">${fmtDate(u.createdAt)}</td>
        ${profileRole==='owner'&&u.id!==currentUser.id?`<td style="display:flex;gap:6px;">
          ${u.status==='pending'?`<button class="btn btn-sm btn-primary" onclick="approveUser('${esc(u.id)}')">Approve</button>`:''}
          <select class="input" style="height:30px;padding:2px 6px;font-size:0.8rem;" onchange="changeUserRole('${esc(u.id)}',this.value)">
            <option ${u.role==='student'?'selected':''}>student</option>
            <option ${u.role==='incharge'?'selected':''}>incharge</option>
            <option ${u.role==='owner'?'selected':''}>owner</option>
          </select>
        </td>`:profileRole==='owner'?'<td><span class="text-soft text-xs">You</span></td>':''}
      </tr>`).join('')}
    </tbody></table></div>`;
  };
  await renderList();
  let t; document.getElementById('userSearch')?.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(renderList,300);});
}

async function approveUser(userId) {
  const map = {};
  map[userId] = true;
  await storageSet(KEYS.approvedUsersMap, JSON.stringify(map), true);
  showToast('User approved!','success'); renderUsers();
}
async function changeUserRole(userId, newRole) {
  showToast(`Role change to ${newRole} requires a backend update.`,'info');
}

/* ============ 18. Analytics ============ */
function statCard(icon, label, value, colorClass) {
  return `<div class="stat-card">
    <div class="stat-icon ${colorClass||''}">${icon}</div>
    <div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>
  </div>`;
}

async function renderAnalytics() {
  const main = document.getElementById('main');
  main.innerHTML = `<div class="page-header"><div><h1 class="page-title">Analytics</h1><p class="page-subtitle">Overview of your lab's activity</p></div></div><div id="analyticsBody"><div class="skeleton skeleton-card" style="height:120px;"></div></div>`;
  const [equipment, checkouts, maintenance] = await Promise.all([loadList(KEYS.equipment,true),loadList(KEYS.checkouts,true),loadList(KEYS.maintenance,true)]);
  const available=equipment.filter(e=>e.status==='available').length;
  const checkedOut=equipment.filter(e=>e.status==='checked-out').length;
  const inMaint=equipment.filter(e=>e.status==='maintenance').length;
  const activeChk=checkouts.filter(c=>c.status==='active').length;
  document.getElementById('analyticsBody').innerHTML = `
    <div class="dashboard-grid" style="margin-bottom:24px;">
      ${statCard('📦','Total Equipment',equipment.length,'stat-icon-blue')}
      ${statCard('✅','Available',available,'stat-icon-green')}
      ${statCard('🔄','Checked Out',checkedOut,'stat-icon-amber')}
      ${statCard('🔧','Maintenance',inMaint,'stat-icon-red')}
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Equipment Status Breakdown</span></div>
      <div style="padding:16px;">
        ${equipment.length===0?'<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">No data yet</div></div>':`
          <div style="display:flex;flex-direction:column;gap:16px;">
            ${[['Available',available,'var(--success)'],['Checked Out',checkedOut,'var(--amber)'],['Maintenance',inMaint,'var(--rust)']].map(([s,count,color])=>{
              const pct=equipment.length?Math.round(count/equipment.length*100):0;
              return `<div>
                <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span class="text-sm fw-600">${s}</span><span class="text-sm text-soft">${count} &middot; ${pct}%</span></div>
                <div style="height:8px;background:var(--grid);border-radius:4px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${color};border-radius:4px;"></div></div>
              </div>`;
            }).join('')}
          </div>`}
      </div>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">Summary</span></div>
      <div style="padding:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;">
        <div><div class="text-sm text-soft">Total Checkouts</div><div class="fw-700" style="font-size:1.5rem;">${checkouts.length}</div></div>
        <div><div class="text-sm text-soft">Active Now</div><div class="fw-700" style="font-size:1.5rem;">${activeChk}</div></div>
        <div><div class="text-sm text-soft">Open Issues</div><div class="fw-700" style="font-size:1.5rem;">${maintenance.filter(m=>m.status!=='resolved').length}</div></div>
        <div><div class="text-sm text-soft">Resolved Issues</div><div class="fw-700" style="font-size:1.5rem;">${maintenance.filter(m=>m.status==='resolved').length}</div></div>
      </div>
    </div>`;
}

/* ============ 19. Checkout Tab ============ */
async function renderCheckout() {
  const main = document.getElementById('main');
  main.innerHTML = `<div class="page-header"><div><h1 class="page-title">Checkout</h1><p class="page-subtitle">Your active checkouts and available equipment</p></div></div><div id="checkoutBody"></div>`;
  const [equipment, checkouts] = await Promise.all([loadList(KEYS.equipment,true),loadList(KEYS.checkouts,true)]);
  const myCheckouts = checkouts.filter(c=>c.status==='active'&&(c.userId===currentUser.id||c.userName===currentUser.username));
  const availableEq = equipment.filter(e=>e.status==='available');
  document.getElementById('checkoutBody').innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Your Active Checkouts</span><span class="badge badge-checked-out">${myCheckouts.length}</span></div>
      ${myCheckouts.length===0
        ?'<div class="empty-state" style="padding:24px;"><div class="empty-state-icon">📋</div><div class="empty-state-title">No active checkouts</div></div>'
        :`<div class="table-wrapper"><table class="data-table"><thead><tr><th>Tag</th><th>Name</th><th>Since</th><th>Action</th></tr></thead><tbody>
          ${myCheckouts.map(c=>`<tr>
            <td class="mono fw-600 text-accent">${esc(c.tag||c.equipmentTag||'')}</td>
            <td>${esc(c.equipmentName||'')}</td>
            <td class="text-sm text-soft">${fmtTime(c.checkedOutAt||c.createdAt)}</td>
            <td><button class="btn btn-sm btn-secondary" onclick="doReturn('${esc(c.tag||c.equipmentTag||'')}',null,'${esc(c.equipmentName||'')}')">Return</button></td>
          </tr>`).join('')}
        </tbody></table></div>`}
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Available Equipment</span><span class="badge badge-available">${availableEq.length}</span></div>
      ${availableEq.length===0
        ?'<div class="empty-state" style="padding:24px;"><div class="empty-state-icon">📦</div><div class="empty-state-title">Nothing available right now</div></div>'
        :`<div class="table-wrapper"><table class="data-table"><thead><tr><th>Tag</th><th>Name</th><th>Category</th><th>Action</th></tr></thead><tbody>
          ${availableEq.map(e=>`<tr>
            <td class="mono fw-600 text-accent">${esc(e.tag||e.qrTag||'')}</td>
            <td>${esc(e.name||'')}</td>
            <td class="text-sm text-soft">${esc(e.category||'')}</td>
            <td><button class="btn btn-sm btn-primary" onclick="doCheckout('${esc(e.tag||e.qrTag||'')}','${esc(e.name||'')}')">Checkout</button></td>
          </tr>`).join('')}
        </tbody></table></div>`}
    </div>`;
}

/* ============ 20. Auto Notice ============ */
async function checkAndPublishAutoNotice() {
  try {
    const lastVersion = await storageGet(KEYS.clientVersion, true);
    if(lastVersion !== CURRENT_BUILD_VERSION) {
      const notices = await loadList(KEYS.notices, true);
      notices.unshift({ id:uid(), title:`System Update (${CURRENT_BUILD_VERSION})`, desc:'LabTrack has been updated with a premium UI, real-time sync, atomic checkout, and security improvements.', type:'SYSTEM', time:Date.now() });
      await Promise.all([saveList(KEYS.notices,notices,true), storageSet(KEYS.clientVersion,CURRENT_BUILD_VERSION,true)]);
    }
  } catch(e) {}
}

/* ============ 21. Boot ============ */
async function boot() {
  initThemeToggle();
  if(!authToken) { renderAuthScreen('login'); return; }
  try {
    const res = await apiFetch('/api/auth/me');
    if(!res.ok) throw new Error('not authed');
    const data = await res.json();
    currentUser = data.user;
    if(currentUser.status !== 'approved' && currentUser.role !== 'owner') {
      doLogout(false);
      renderAuthScreen('login', 'Your account is pending approval by your Lab In-Charge or Owner.');
      return;
    }
    profileName = currentUser.fullName || currentUser.username || 'User';
    profileRole = currentUser.role || 'student';
  } catch(e) { doLogout(false); return; }

  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('app').style.flexDirection = 'column';

  const collegeBadge = document.getElementById('collegeBadge');
  if(collegeBadge) collegeBadge.textContent = currentUser.collegeCode || '';

  tagCounter = parseInt(await storageGet(KEYS.tagCounter, true)) || 1;
  await checkAndPublishAutoNotice();
  renderTopbarActions();
  renderSidebar();
  initSocket();
  await switchTab('dashboard');
}

function doLogout(redraw=true) {
  disconnectSocket();
  authToken=null; currentUser=null; profileName=null; profileRole='student';
  localStorage.removeItem(AUTH_KEY);
  const appEl = document.getElementById('app');
  if(appEl) appEl.style.display = 'none';
  document.getElementById('authOverlay').style.display = 'flex';
  if(redraw) renderAuthScreen('login');
}

async function switchTab(tab) {
  if(currentTab==='scan' && tab!=='scan' && typeof window._scanCleanup==='function') {
    window._scanCleanup(); window._scanCleanup = null;
  }
  currentTab = tab;
  renderSidebar();
  const main = document.getElementById('main');
  if(!main) return;
  switch(tab) {
    case 'dashboard':   await renderDashboard();   break;
    case 'inventory':   await renderInventory();   break;
    case 'scan':        await renderScan();         break;
    case 'checkout':    await renderCheckout();    break;
    case 'maintenance': await renderMaintenance(); break;
    case 'usage':       await renderUsage();       break;
    case 'notices':     await renderNotices();     break;
    case 'users':       await renderUsers();       break;
    case 'analytics':   await renderAnalytics();  break;
  }
}

document.addEventListener('DOMContentLoaded', boot);
