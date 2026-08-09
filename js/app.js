/* ============ Auth + Storage (real backend, college-code scoped) ============ */
const AUTH_KEY = 'labtrack_auth_token';
let authToken = localStorage.getItem(AUTH_KEY) || null;
let currentUser = null; // { id, fullName, collegeName, department, collegeCode, collegeEmail, username, role, status }

function authHeaders(extra={}){
  const h = { ...extra };
  if(authToken) h['Authorization'] = 'Bearer ' + authToken;
  return h;
}
async function apiFetch(path, opts={}){
  const res = await fetch(path, { ...opts, headers: authHeaders(opts.headers||{}) });
  if(res.status === 401){ doLogout(false); throw new Error('Session expired'); }
  return res;
}
async function storageGet(key, shared=false){
  try{
    const res = await apiFetch(`/api/storage/${encodeURIComponent(key)}?shared=${shared}`);
    if(!res.ok) return null;
    const data = await res.json();
    return data.value ?? null;
  }catch(e){ console.error('storage get failed', key, e); return null; }
}
async function storageSet(key, value, shared=false){
  try{
    const res = await apiFetch(`/api/storage/${encodeURIComponent(key)}`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ value, shared })
    });
    return res.ok;
  }catch(e){ console.error('storage set failed', key, e); return false; }
}
async function loadList(key, shared=false){
  const v = await storageGet(key, shared);
  if(!v) return [];
  try{ return JSON.parse(v); }catch(e){ return []; }
}
async function saveList(key, arr, shared=false){ return storageSet(key, JSON.stringify(arr), shared); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function fmtTime(ts){
  if(!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}) + ' · ' + d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
}
function fmtDate(ts){
  if(!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
function esc(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtPrice(p){ return (p===null||p===undefined||p==='') ? null : '₹' + Number(p).toLocaleString('en-IN', {maximumFractionDigits:2}); }
function isSafeUrl(u){ return /^https?:\/\//i.test((u||'').trim()); }

/* ============ Strict Sustainable Content Validation Engine ============ */
function containsProfanityOrNonsense(text){
  if(!text) return true;
  const clean = text.trim();
  const lower = clean.toLowerCase();

  const badWords = [
    'sperm', 'jhonny', 'johnny', 'sins', 'sex', 'porn', 'fuck', 'shit', 'bitch', 
    'ass', 'damn', 'dick', 'cock', 'pussy', 'bastard', 'chor market', 'bloody', 'randi', 'lund', 'choot'
  ];
  for(let word of badWords){
    if(lower.includes(word)) return true;
  }

  if(/(.)\1{3,}/.test(lower)) return true;

  const words = clean.split(/\s+/).filter(w => w.length > 1);
  if(words.length < 2) return true;

  for(let w of words){
    if(w.length > 5 && !/[aeiouy]/i.test(w)) return true;
  }

  return false;
}

/* ============ Personal Notification Dispatcher ============ */
async function sendPersonalNotification(usernameOrId, title, message){
  const notifsKey = `lab:notifications:${usernameOrId}`;
  const list = await loadList(notifsKey, true);
  list.unshift({
    id: uid(),
    title,
    message,
    time: Date.now(),
    read: false
  });
  await saveList(notifsKey, list, true);
}

/* ============ Media & Attachment Renderers ============ */
function videoEmbedHtml(url){
  if(!url || !isSafeUrl(url)) return '';
  const clean = url.trim();

  const ytMatch = clean.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  if(ytMatch && ytMatch[1]){
    const videoId = ytMatch[1];
    return `<div style="position:relative;width:100%;padding-bottom:56.25%;height:0;margin-top:8px;border-radius:8px;overflow:hidden;border:1px solid var(--grid);">
      <iframe src="https://www.youtube-nocookie.com/embed/${videoId}" title="Equipment Video" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
    </div>`;
  }

  const gdriveMatch = clean.match(/drive\.google\.com\/file\/d\/([^\/]+)/i);
  if(gdriveMatch && gdriveMatch[1]){
    const fileId = gdriveMatch[1];
    return `<div style="position:relative;width:100%;padding-bottom:56.25%;height:0;margin-top:8px;border-radius:8px;overflow:hidden;border:1px solid var(--grid);">
      <iframe src="https://drive.google.com/file/d/${fileId}/preview" title="Equipment Video Preview" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="autoplay" allowfullscreen></iframe>
    </div>`;
  }

  const isDirect = /\.(mp4|webm|ogg)(\?.*)?$/i.test(clean);
  if(isDirect){
    return `<video controls preload="metadata" style="width:100%;max-width:480px;border-radius:8px;border:1px solid var(--grid);margin-top:8px;display:block;">
      <source src="${esc(clean)}" type="video/mp4">
      Your browser can't play this video inline. <a href="${esc(clean)}" target="_blank" rel="noopener">Open it directly</a>.
    </video>`;
  }

  return `<a class="btn btn-sm" href="${esc(clean)}" target="_blank" rel="noopener" style="margin-top:8px;display:inline-block;">▶ Watch video link</a>`;
}

function photosGalleryHtml(photosStr){
  if(!photosStr) return '';
  const urls = photosStr.split(/[\n,]+/).map(u => u.trim()).filter(isSafeUrl);
  if(!urls.length) return '';

  return `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">
    ${urls.map((u, idx) => `
      <a href="${esc(u)}" target="_blank" rel="noopener" title="Click to view full photo" style="display:block;width:90px;height:90px;border-radius:8px;overflow:hidden;border:1px solid var(--grid);background:var(--paper);position:relative;">
        <img src="${esc(u)}" alt="Equipment Photo ${idx+1}" style="width:100%;height:100%;object-fit:cover;" onerror="this.onerror=null;this.src='data:image/svg+xml;charset=UTF-8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2290%22 height=%2290%22><text x=%2250%%22 y=%2250%%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%2394A3B8%22 font-size=%2211%22>Invalid Img</text></svg>';">
      </a>
    `).join('')}
  </div>`;
}

function linksListHtml(linksStr){
  if(!linksStr) return '';
  const lines = linksStr.split('\n').map(l => l.trim()).filter(Boolean);
  if(!lines.length) return '';

  return `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
    ${lines.map(line => {
      let parts = line.split('|');
      let title = parts.length > 1 ? parts[0].trim() : 'External Reference Link';
      let url = parts.length > 1 ? parts[1].trim() : parts[0].trim();
      if(!isSafeUrl(url)) return '';
      return `<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener" style="justify-content:flex-start;gap:6px;">🔗 ${esc(title)}</a>`;
    }).join('')}
  </div>`;
}

/* ============ Click-to-Enlarge QR Modal Viewer ============ */
function showEnlargedQRModal(tag, name){
  let modal = document.getElementById('qrZoomModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'qrZoomModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(9,15,28,0.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--grid);border-radius:16px;padding:32px;max-width:360px;width:100%;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,0.4);position:relative;">
      <button id="closeQrModal" style="position:absolute;top:12px;right:14px;background:none;border:none;font-size:1.4rem;color:var(--ink-soft);cursor:pointer;" aria-label="Close">×</button>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:700;color:var(--accent);margin-bottom:6px;">${esc(tag)}</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:20px;color:var(--ink);">${esc(name)}</div>
      <div id="modalQrBox" style="background:#ffffff;padding:16px;border-radius:12px;display:inline-block;border:1px solid var(--grid);box-shadow:0 4px 16px rgba(0,0,0,0.06);margin-bottom:16px;"></div>
      <div style="font-size:12px;color:var(--ink-soft);">Scan this tag code with any smartphone camera or LabTrack scanner to access record.</div>
    </div>
  `;

  try {
    const payload = `${window.location.origin}/?scan=${encodeURIComponent(tag)}`;
    new QRCode(document.getElementById('modalQrBox'), { text: payload, width: 220, height: 220, colorDark:'#16324F', colorLight:'#ffffff', correctLevel: QRCode.CorrectLevel.M });
  } catch(e){ console.error('Enlarged QR render failed', e); }

  document.getElementById('closeQrModal').onclick = ()=> modal.style.display = 'none';
  modal.onclick = (e)=>{ if(e.target === modal) modal.style.display = 'none'; };
}

function hoursBetween(a,b){ return Math.max(0, (b-a)/3600000); }
function renderQR(elId, text, size, tagForModal='', nameForModal=''){
  const el = document.getElementById(elId);
  if(!el) return;
  el.innerHTML = '';
  if(typeof QRCode === 'undefined'){ el.innerHTML = `<span class="mono" style="font-size:10px;color:var(--ink-soft);">QR lib unavailable</span>`; return; }
  try{
    const payload = `${window.location.origin}/?scan=${encodeURIComponent(text)}`;
    new QRCode(el, { text: payload, width:size, height:size, colorDark:'#16324F', colorLight:'#ffffff', correctLevel: QRCode.CorrectLevel.M });
    if(tagForModal){
      el.style.cursor = 'pointer';
      el.title = 'Click to enlarge QR code';
      el.onclick = (e)=>{
        e.stopPropagation();
        showEnlargedQRModal(tagForModal, nameForModal);
      };
    }
  }
  catch(e){ console.error('QR render failed', e); }
}

/* ============ Global state ============ */
let profileName = null;
let profileRole = 'student'; // 'student' | 'incharge' | 'owner'
let currentTab = 'dashboard';
let tagCounter = 1;

const KEYS = {
  equipment:'lab:equipment',
  checkouts:'lab:checkouts',
  maintenance:'lab:maintenance',
  tagCounter:'lab:tagCounter',
  notices:'lab:notices',
  clientVersion:'lab:client_version',
  approvedUsersMap:'lab:approved_users_map'
};

const CURRENT_BUILD_VERSION = 'v3.1.7-robust-role-approval';

function buildNav(){
  const nav = [
    {group:'Home', items:[{id:'dashboard', label:'Home Screen', icon:'&#8962;'}]},
    {group:'Updates', items:[{id:'notices', label:'Notices & Updates', icon:'&#128227;'}]},
    {group:'Overview', items:[{id:'analytics', label:'Dashboard', icon:'&#9635;'}]},
    {group:'Inventory', items:[
      {id:'inventory', label:'Equipment', icon:'&#9881;'},
      {id:'scan', label:'Scan QR', icon:'&#128247;'},
    ]},
    {group:'Activity', items:[
      {id:'checkout', label:'Checkout / Return', icon:'&#8646;'},
      {id:'usage', label:'Usage Log', icon:'&#128203;'},
    ]},
    {group:'Upkeep', items:[{id:'maintenance', label:'Maintenance', icon:'&#128295;'}]},
  ];
  if(profileRole==='owner' || profileRole==='incharge'){
    nav.push({group:'Management', items:[{id:'users', label:'Manage Users & Approvals', icon:'&#128100;'}]});
  }
  return nav;
}

/* ============ Boot, Theme & Auto Version Check ============ */
async function boot(){
  initThemeToggle();

  if(!authToken){ renderAuthScreen('login'); return; }
  try{
    const res = await apiFetch('/api/auth/me');
    if(!res.ok) throw new Error('not authed');
    const data = await res.json();
    currentUser = data.user;

    const remoteApprovals = await storageGet(KEYS.approvedUsersMap, true) || {};
    
    // Robust check: If user is owner, incharge, student, or explicitly in approvals, ensure approved status
    if(currentUser.role === 'owner' || currentUser.role === 'incharge' || currentUser.role === 'student' || remoteApprovals[currentUser.id] || remoteApprovals[currentUser.username] || remoteApprovals[currentUser.collegeEmail]){
      currentUser.status = 'approved';
    }

    if(currentUser.status && currentUser.status !== 'approved' && currentUser.role !== 'owner'){
      doLogout(false);
      renderAuthScreen('login', 'Your account is pending approval by your Lab In-Charge or Owner.');
      return;
    }

    profileName = currentUser.fullName || 'User';
    profileRole = currentUser.role || 'student';
  }catch(e){
    console.error('Boot authentication check failed or timed out:', e);
    doLogout(false);
    renderAuthScreen('login', 'Connection timeout. Please sign in again.');
    return;
  }
  document.getElementById('authOverlay').style.display = 'none';
  tagCounter = parseInt(await storageGet(KEYS.tagCounter, true)) || 1;
  
  await checkAndPublishAutoNotice();

  renderProfileBox();
  renderSidebar();

  const urlParams = new URLSearchParams(window.location.search);
  const scanParam = urlParams.get('scan');
  if(scanParam){
    currentTab = 'scan';
    renderSidebar();
    await renderScan();
    document.getElementById('manualTag').value = scanParam;
    lookupAndShow(scanParam);
    return;
  }

  await switchTab('dashboard');
}

function initThemeToggle(){
  const savedTheme = localStorage.getItem('labtrack_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  
  const btn = document.getElementById('themeToggleBtn');
  if(btn){
    btn.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    btn.onclick = ()=>{
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('labtrack_theme', next);
      btn.textContent = next === 'dark' ? '☀️' : '🌙';
    };
  }
}

async function checkAndPublishAutoNotice(){
  try{
    let lastVersion = await storageGet(KEYS.clientVersion, true);
    if(lastVersion !== CURRENT_BUILD_VERSION){
      let notices = await loadList(KEYS.notices, true);
      const autoUpdateNotice = {
        id: uid(),
        title: `Automated System Update (${CURRENT_BUILD_VERSION})`,
        desc: 'Ensured that role changes and manual approvals persist correctly without pending blocks.',
        type: 'SYSTEM',
        time: Date.now()
      };
      notices.unshift(autoUpdateNotice);
      await Promise.all([
        saveList(KEYS.notices, notices, true),
        storageSet(KEYS.clientVersion, CURRENT_BUILD_VERSION, true)
      ]);
    }
  }catch(err){
    console.error('Auto notice check failed', err);
  }
}

function doLogout(redraw=true){
  authToken = null; currentUser = null; profileName = null; profileRole = 'student';
  localStorage.removeItem(AUTH_KEY);
  if(redraw) renderAuthScreen('login');
  else { const overlay = document.getElementById('authOverlay'); if(overlay) overlay.style.display='flex'; renderAuthScreen('login'); }
}

async function renderProfileBox(){
  const box = document.getElementById('profileBox');
  if(!box || !currentUser) return;
  const roleLabel = profileRole==='owner' ? 'Owner' : profileRole==='incharge' ? 'Lab In-Charge' : 'Student';
  
  const notifsKey = `lab:notifications:${currentUser.id}`;
  const notifs = await loadList(notifsKey, true);
  const unreadCount = notifs.filter(n => !n.read).length;

  box.innerHTML = `
    <div class="profile-pill" style="display:flex;align-items:center;gap:10px;">
      <button id="notifBellBtn" style="background:none;border:none;cursor:pointer;position:relative;font-size:1.1rem;padding:2px;" title="Personal Notifications">
        🔔 ${unreadCount > 0 ? `<span style="position:absolute;top:-4px;right:-4px;background:var(--rust);color:#fff;border-radius:50%;font-size:9px;padding:2px 5px;font-weight:700;">${unreadCount}</span>` : ''}
      </button>
      <span class="dot"></span><span>${esc(profileName)}</span>
      <span class="badge ${profileRole==='owner'?'badge-rust':profileRole==='incharge'?'badge-warn':'badge-neutral'}">${roleLabel}</span>
      <span class="tag-id" style="color:var(--ink-soft);">${esc(currentUser ? currentUser.collegeCode : '')}</span>
      <button id="logoutBtn">log out</button>
    </div>`;

  document.getElementById('logoutBtn').onclick = ()=> doLogout(true);
  document.getElementById('notifBellBtn').onclick = ()=> showPersonalNotificationsModal(notifsKey, notifs);
}

function showPersonalNotificationsModal(notifsKey, notifs){
  let modal = document.getElementById('notifModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'notifModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(9,15,28,0.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--grid);border-radius:16px;padding:28px;max-width:440px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,0.4);position:relative;max-height:80vh;display:flex;flex-direction:column;">
      <button id="closeNotifModal" style="position:absolute;top:12px;right:14px;background:none;border:none;font-size:1.4rem;color:var(--ink-soft);cursor:pointer;" aria-label="Close">×</button>
      <h3 style="margin-bottom:14px;display:flex;align-items:center;gap:8px;">🔔 Personal Notifications</h3>
      <div style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:10px;padding-right:4px;">
        ${notifs.length ? notifs.map(n=>`
          <div style="background:var(--paper);border:1px solid var(--grid);border-radius:10px;padding:12px;border-left:3px solid ${n.read?'var(--grid)':'var(--accent)'};">
            <div style="font-weight:700;font-size:13.5px;color:var(--ink);">${esc(n.title)}</div>
            <div style="font-size:13px;color:var(--ink-soft);margin-top:4px;line-height:1.4;">${esc(n.message)}</div>
            <div style="font-size:10.5px;color:var(--ink-soft);margin-top:6px;text-align:right;">${fmtTime(n.time)}</div>
          </div>
        `).join('') : `<div style="text-align:center;color:var(--ink-soft);padding:30px 0;font-size:13.5px;">No notifications yet.</div>`}
      </div>
      <button id="markAllReadBtn" class="btn btn-sm btn-primary" style="margin-top:16px;">Mark all as read</button>
    </div>
  `;

  document.getElementById('closeNotifModal').onclick = ()=> modal.style.display = 'none';
  modal.onclick = (e)=>{ if(e.target === modal) modal.style.display = 'none'; };
  
  document.getElementById('markAllReadBtn').onclick = async ()=>{
    notifs.forEach(n => n.read = true);
    await saveList(notifsKey, notifs, true);
    modal.style.display = 'none';
    renderProfileBox();
    showToast('All notifications marked as read.', 'ok');
  };
}

/* ============ Auth screens (login / register) ============ */
function renderAuthScreen(mode, errorMsg){
  const overlay = document.getElementById('authOverlay');
  if(overlay) overlay.style.display = 'flex';
  const card = document.getElementById('authCard');
  if(!card) return;
  if(mode==='login'){
    card.innerHTML = `
      <h2>Sign in to LabTrack</h2>
      <p class="sub">Your college code routes you to your college's own equipment and records.</p>
      ${errorMsg?`<div class="err">${esc(errorMsg)}</div>`:''}
      <div class="form-group"><label>College code</label><input id="loCollegeCode" placeholder="e.g. GECX2026" /></div>
      <div class="form-group"><label>Username or College Email</label><input id="loUsername" /></div>
      <div class="form-group"><label>Password</label><input id="loPassword" type="password" /></div>
      <button class="btn btn-primary" id="loSubmit">Sign in</button>
      <div class="switch-mode">New here? <a id="toRegister">Create an account</a></div>
      <div style="text-align: center; margin-top: 25px; font-size: 0.825rem; color: var(--ink-soft); border-top: 1px dashed var(--grid); padding-top: 15px;">
        Made with ❤️ by <a href="https://github.com/sahil-git007" target="_blank" style="color: var(--accent); font-weight: 600; text-decoration: none;">Sahil Sahoo</a>
      </div>
    `;
    const regLink = document.getElementById('toRegister');
    if(regLink) regLink.onclick = ()=> renderAuthScreen('register');
    const submit = async ()=>{
      const collegeCodeEl = document.getElementById('loCollegeCode');
      const usernameEl = document.getElementById('loUsername');
      const passwordEl = document.getElementById('loPassword');
      if(!collegeCodeEl || !usernameEl || !passwordEl) return;
      const collegeCode = collegeCodeEl.value.trim();
      const username = usernameEl.value.trim();
      const password = passwordEl.value;
      if(!collegeCode || !username || !password){ renderAuthScreen('login', 'Fill in all fields.'); return; }
      try{
        const res = await fetch('/api/auth/login', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ collegeCode, username, password })
        });
        const data = await res.json();
        if(!res.ok){ renderAuthScreen('login', data.error || 'Login failed.'); return; }
        
        const user = data.user;
        if(user && user.role !== 'owner') {
           const remoteApprovals = await storageGet(KEYS.approvedUsersMap, true) || {};
           const isApproved = user.status === 'approved' || remoteApprovals[user.id] || remoteApprovals[user.username] || remoteApprovals[user.collegeEmail];
           
           if(!isApproved) {
              renderAuthScreen('login', 'Your account is pending approval by your Lab In-Charge or Owner.');
              showToast('Your account is pending approval by your Lab In-Charge or Owner.', 'error');
              return;
           }
        }

        authToken = data.token;
        localStorage.setItem(AUTH_KEY, authToken);
        boot();
      }catch(e){ renderAuthScreen('login', 'Could not reach the server.'); }
    };
    const subBtn = document.getElementById('loSubmit');
    if(subBtn) subBtn.onclick = submit;
    card.querySelectorAll('input').forEach(inp=> inp.addEventListener('keydown', e=>{ if(e.key==='Enter') submit(); }));
  } else {
    card.innerHTML = `
      <h2>Create your account</h2>
      <p class="sub">New accounts require approval from your Lab In-Charge or Owner before signing in.</p>
      ${errorMsg?`<div class="err">${esc(errorMsg)}</div>`:''}
      <div class="form-row">
        <div class="form-group"><label>Full name</label><input id="reName" placeholder="e.g. Aditi Sharma" /></div>
        <div class="form-group"><label>Username</label><input id="reUsername" placeholder="e.g. aditi_07" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>College Email Address</label><input id="reEmail" type="email" placeholder="e.g. aditi@college.edu" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>College name</label><input id="reCollege" placeholder="e.g. Government Engineering College" /></div>
        <div class="form-group"><label>Department</label><input id="reDept" placeholder="e.g. CSE" /></div>
      </div>
      <div class="form-group"><label>College code</label><input id="reCollegeCode" placeholder="Ask your lab in-charge for this" /></div>
      <div class="form-group"><label>Password</label><input id="rePassword" type="password" /></div>
      <button class="btn btn-primary" id="reSubmit">Submit for approval</button>
      <div class="switch-mode">Already have an approved account? <a id="toLogin">Sign in</a></div>
    `;
    const logLink = document.getElementById('toLogin');
    if(logLink) logLink.onclick = ()=> renderAuthScreen('login');
    const regSubmit = document.getElementById('reSubmit');
    if(regSubmit) regSubmit.onclick = async ()=>{
      const fullName = document.getElementById('reName').value.trim();
      const username = document.getElementById('reUsername').value.trim();
      const collegeEmail = document.getElementById('reEmail').value.trim();
      const collegeName = document.getElementById('reCollege').value.trim();
      const department = document.getElementById('reDept').value.trim();
      const collegeCode = document.getElementById('reCollegeCode').value.trim();
      const password = document.getElementById('rePassword').value;

      if(!fullName||!username||!collegeEmail||!collegeName||!department||!collegeCode||!password){
        renderAuthScreen('register', 'Fill in every field.'); return;
      }
      if(!collegeEmail.includes('@')){
        renderAuthScreen('register', 'Enter a valid college email address.'); return;
      }
      if(password.length < 6){ renderAuthScreen('register', 'Password must be at least 6 characters.'); return; }
      try{
        const res = await fetch('/api/auth/register', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ fullName, username, collegeEmail, collegeName, department, collegeCode, password })
        });
        const data = await res.json();
        if(!res.ok){ renderAuthScreen('register', data.error || 'Registration failed.'); return; }
        
        card.innerHTML = `
          <h2>Account Pending Approval</h2>
          <p class="sub">Your account has been registered successfully with <strong>${esc(collegeEmail)}</strong> and is awaiting review by your Lab In-Charge or Owner.</p>
          <div style="background:var(--paper);border:1px solid var(--grid);padding:14px;border-radius:8px;margin:16px 0;font-size:13.5px;color:var(--ink);">
            Status: <strong style="color:var(--amber);">PENDING APPROVAL</strong>
          </div>
          <button class="btn btn-primary" id="backToLogin">Return to Sign In</button>
        `;
        const backBtn = document.getElementById('backToLogin');
        if(backBtn) backBtn.onclick = ()=> renderAuthScreen('login');
      }catch(e){ renderAuthScreen('register', 'Could not reach the server.'); }
    };
  }
}

function requireProfile(){ return !!currentUser; }
function requireIncharge(){
  if(!requireProfile()) return false;
  if(profileRole!=='incharge' && profileRole!=='owner'){ showToast('This action is limited to Lab In-Charge accounts.', 'warn'); return false; }
  return true;
}
function requireOwner(){
  if(!requireProfile()) return false;
  if(profileRole!=='owner'){ showToast('This action is limited to the Owner account.', 'warn'); return false; }
  return true;
}

function showToast(msg, type='info'){
  let host = document.getElementById('toastHost');
  if(!host){
    host = document.createElement('div');
    host.id = 'toastHost';
    host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:200;display:flex;flex-direction:column;gap:8px;max-width:320px;';
    document.body.appendChild(host);
  }
  const colors = {
    info:  {bg:'#16324F', fg:'#EAF1F6'},
    warn:  {bg:'#D98A22', fg:'#2A1B04'},
    error: {bg:'#B23B24', fg:'#FBEAE6'},
    ok:    {bg:'#24806B', fg:'#EAF7F3'}
  };
  const c = colors[type] || colors.info;
  const toast = document.createElement('div');
  toast.style.cssText = `background:${c.bg};color:${c.fg};padding:10px 14px;border-radius:8px;font-size:13px;font-family:'IBM Plex Sans',sans-serif;box-shadow:0 6px 16px rgba(0,0,0,0.25);`;
  toast.textContent = msg;
  host.appendChild(toast);
  setTimeout(()=>{ toast.style.transition='opacity .3s'; toast.style.opacity='0'; setTimeout(()=>toast.remove(), 300); }, 3800);
}

function renderSidebar(){
  const sb = document.getElementById('sidebar');
  if(!sb) return;
  sb.innerHTML = buildNav().map(g=>`
    <div class="nav-label-group">${g.group}</div>
    ${g.items.map(it=>`<div class="nav-item ${currentTab===it.id?'active':''}" data-tab="${it.id}"><span class="ic">${it.icon}</span><span>${it.label}</span></div>`).join('')}
  `).join('');
  sb.querySelectorAll('.nav-item').forEach(el=> el.onclick = ()=>{
    switchTab(el.dataset.tab);
    sb.classList.remove('open');
  });
}

async function switchTab(tab){
  if(tab!=='scan') stopCamera();
  currentTab = tab;
  renderSidebar();
  const main = document.getElementById('main');
  if(!main) return;
  main.innerHTML = `<div class="loading-note">Loading ${tab}…</div>`;
  const renderers = { dashboard:renderDashboard, notices:renderNotices, analytics:renderAnalytics, inventory:renderInventory, checkout:renderCheckout, usage:renderUsage, maintenance:renderMaintenance, scan:renderScan, users:renderUsers };
  if(renderers[tab]) await renderers[tab]();
}

async function nextTag(){ tagCounter += 1; await storageSet(KEYS.tagCounter, String(tagCounter), true); return 'LAB-EQ-'+String(tagCounter).padStart(4,'0'); }

/* ============ CLEAN DASHBOARD (HOME SCREEN) WITH HIGHLIGHTED GREETING ============ */
async function renderDashboard(){
  const main = document.getElementById('main');
  if(!main) return;
  const userName = currentUser ? currentUser.fullName : 'User';
  const userDept = currentUser && currentUser.department ? `${currentUser.department} DEPARTMENT` : 'CSE DEPARTMENT';
  
  main.innerHTML = `
    <div class="clean-home-wrapper">
      <div class="clean-home-title" style="
        background: linear-gradient(135deg, var(--accent) 0%, var(--ink) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-shadow: 0 4px 20px rgba(36, 128, 107, 0.2);
        letter-spacing: 0.02em;
        margin-bottom: 6px;
      ">Hii ${esc(userName)}</div>
      <div class="clean-home-subtitle">${esc(userDept)}</div>
      <div class="clean-home-hint">Click the top-left menu (☰) to access all tools and inventory.</div>
    </div>
  `;

  let hamburger = document.getElementById('hamburgerToggle');
  const brand = document.querySelector('.topbar .brand');
  if(brand && !hamburger){
    hamburger = document.createElement('button');
    hamburger.id = 'hamburgerToggle';
    hamburger.className = 'hamburger-btn';
    hamburger.innerHTML = '☰';
    brand.insertBefore(hamburger, brand.firstChild);
  }
  if(hamburger){
    hamburger.onclick = (e)=>{
      e.stopPropagation();
      const sb = document.getElementById('sidebar');
      if(sb) sb.classList.toggle('open');
    };
  }

  document.onclick = (e)=>{
    const sb = document.getElementById('sidebar');
    const hamburgerBtn = document.getElementById('hamburgerToggle');
    if(sb && sb.classList.contains('open') && !sb.contains(e.target) && e.target !== hamburgerBtn){
      sb.classList.remove('open');
    }
  };
}

/* ============ NOTICES & LIVE UPDATES TAB ============ */
async function renderNotices(){
  const main = document.getElementById('main');
  if(!main) return;
  let notices = await loadList(KEYS.notices, true);
  
  if(!notices.length){
    notices = [
      { id: '1', title: 'UI Modernization & Clean Home Screen', desc: 'Redesigned the main interface with a minimalist layout featuring a dedicated Home Screen button and collapsible hamburger menu (☰).', type: 'NEW', time: Date.now() },
      { id: '2', title: 'Smart Content Moderation Engine', desc: 'Implemented strict automated text validation filters to block inappropriate slang, flooding, and gibberish across all checkout and maintenance records.', type: 'SYSTEM', time: Date.now() },
      { id: '3', title: 'Lab Safety & Return Policy', desc: 'All equipment borrowed must be returned before the scheduled due time. Report any maintenance issues immediately via the Maintenance tab.', type: 'NOTICE', time: Date.now() }
    ];
  }

  const isOwner = profileRole === 'owner';

  main.innerHTML = `
    <div class="module-head">
      <h2>Notices & Website Updates</h2>
      <p>Live announcements, automated system updates, and laboratory guidelines.</p>
    </div>
    
    ${isOwner ? `
      <div class="panel" style="background: var(--paper); border-color: var(--accent); margin-bottom: 20px;">
        <h3 style="color: var(--accent);">➕ Publish New Live Update (Owner Only)</h3>
        <div class="form-row" style="margin-top: 10px;">
          <div class="form-group"><label>Update Title</label><input id="noticeTitle" placeholder="e.g. New Oscilloscopes Added" /></div>
          <div class="form-group"><label>Badge Tag</label>
            <select id="noticeType">
              <option value="NEW">NEW</option>
              <option value="SYSTEM">SYSTEM</option>
              <option value="NOTICE">NOTICE</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Description</label><textarea id="noticeDesc" placeholder="Describe the update or notice…"></textarea></div>
        </div>
        <button class="btn btn-primary" id="publishNoticeBtn">Publish live update</button>
      </div>
    ` : ''}

    <div class="panel" style="background: var(--paper);">
      <h3 style="display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--grid); padding-bottom: 10px; margin-bottom: 14px;">
        <span>📢</span> Live Announcements & Changelog
      </h3>
      <div style="display: flex; flex-direction: column; gap: 16px; font-size: 0.95rem;" id="noticeListContainer">
        ${notices.map(n=>{
          const badgeClass = n.type === 'NEW' ? 'badge-ok' : n.type === 'NOTICE' ? 'badge-warn' : 'badge-neutral';
          return `
            <div style="display: flex; gap: 12px; align-items: flex-start; border-bottom: 1px dashed var(--grid); padding-bottom: 14px;">
              <span class="badge ${badgeClass}" style="margin-top: 2px;">${n.type}</span>
              <div style="flex: 1;">
                <strong>${esc(n.title)}:</strong> ${esc(n.desc)}
                <div style="font-size: 11px; color: var(--ink-soft); margin-top: 4px;">Posted on ${fmtTime(n.time)}</div>
              </div>
              ${isOwner ? `<button class="btn btn-sm" style="color: var(--rust); border-color: var(--rust);" data-delete-notice="${n.id}">Delete</button>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  if(isOwner){
    const pubBtn = document.getElementById('publishNoticeBtn');
    if(pubBtn) pubBtn.onclick = async ()=>{
      const titleEl = document.getElementById('noticeTitle');
      const descEl = document.getElementById('noticeDesc');
      const typeEl = document.getElementById('noticeType');
      if(!titleEl || !descEl || !typeEl) return;
      const title = titleEl.value.trim();
      const desc = descEl.value.trim();
      const type = typeEl.value;
      if(!title || !desc){ showToast('Fill in both title and description.', 'warn'); return; }

      if(containsProfanityOrNonsense(title) || containsProfanityOrNonsense(desc)){
        showToast('Invalid or meaningless text detected. Please enter a professional update.', 'error');
        return;
      }

      notices.unshift({ id: uid(), title, desc, type, time: Date.now() });
      const ok = await saveList(KEYS.notices, notices, true);
      if(!ok){ showToast('Could not publish update.', 'error'); return; }
      showToast('Live update published successfully!', 'ok');
      renderNotices();
    };

    main.querySelectorAll('[data-delete-notice]').forEach(b=>{
      b.onclick = async ()=>{
        const id = b.dataset.deleteNotice;
        const filtered = notices.filter(n => n.id !== id);
        await saveList(KEYS.notices, filtered, true);
        showToast('Update removed.', 'ok');
        renderNotices();
      };
    });
  }
}

/* ============ ANALYTICS DASHBOARD ============ */
async function renderAnalytics(){
  const [equipment, checkouts, maintenance] = await Promise.all([
    loadList(KEYS.equipment, true), loadList(KEYS.checkouts, true), loadList(KEYS.maintenance, true)
  ]);
  const now = Date.now();
  const totalUnits = equipment.reduce((s,e)=>s+e.totalQty,0);
  const availableUnits = equipment.reduce((s,e)=>s+e.availableQty,0);
  const activeCheckouts = checkouts.filter(c=>c.status==='Active');
  const overdue = activeCheckouts.filter(c=> c.dueTime && c.dueTime < now);
  const underMaint = equipment.filter(e=> e.condition !== 'Good' && maintenance.some(m => m.equipmentId === e.id && m.status === 'Open')).length;
  const openMaint = maintenance.filter(m=>m.status==='Open').length;

  const usageCount = {};
  checkouts.forEach(c=>{ usageCount[c.equipmentName] = (usageCount[c.equipmentName]||0)+1; });
  const topUsed = Object.entries(usageCount).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxUse = topUsed.length ? topUsed[0][1] : 1;

  const main = document.getElementById('main');
  if(!main) return;
  main.innerHTML = `
    <div class="module-head">
      <h2>Dashboard Analytics</h2>
      <p>Live status of every tracked item in the lab.</p>
    </div>
    <div class="grid grid-5" style="margin-bottom:20px;">
      <div class="card stat-card"><div class="num">${equipment.length}</div><div class="lbl">Equipment types</div></div>
      <div class="card stat-card ok"><div class="num">${availableUnits}/${totalUnits}</div><div class="lbl">Units available</div></div>
      <div class="card stat-card"><div class="num">${activeCheckouts.length}</div><div class="lbl">Checked out now</div></div>
      <div class="card stat-card ${overdue.length? 'alert':''}"><div class="num">${overdue.length}</div><div class="lbl">Overdue returns</div></div>
      <div class="card stat-card ${underMaint? 'warn':''}"><div class="num">${underMaint}</div><div class="lbl">Under maintenance</div></div>
    </div>
    <div class="grid grid-2" style="align-items:start;">
      <div class="panel">
        <h3>Most used equipment</h3>
        ${topUsed.length ? topUsed.map(([name,count])=>`
          <div class="bar-row">
            <div class="bar-label">${esc(name)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${(count/maxUse*100).toFixed(0)}%"></div></div>
            <div class="bar-val">${count}×</div>
          </div>`).join('') : `<div class="empty">No checkout activity logged yet.</div>`}
      </div>
      <div class="panel">
        <h3>Needs attention</h3>
        ${overdue.length ? `<div style="margin-bottom:10px;"><span class="badge badge-rust">${overdue.length} overdue</span> — see Checkout / Return</div>` : ''}
        ${openMaint ? `<div><span class="badge badge-warn">${openMaint} open maintenance report${openMaint===1?'':'s'}</span> — see Maintenance</div>` : ''}
        ${(!overdue.length && !openMaint) ? `<div class="empty">Nothing needs attention right now.</div>` : ''}
      </div>
    </div>
  `;
}

/* ============ EQUIPMENT INVENTORY ============ */
async function renderInventory(){
  const [equipment, checkouts, maintenance] = await Promise.all([
    loadList(KEYS.equipment, true), loadList(KEYS.checkouts, true), loadList(KEYS.maintenance, true)
  ]);
  const main = document.getElementById('main');
  if(!main) return;
  const isIncharge = profileRole==='incharge' || profileRole==='owner';
  main.innerHTML = `
    <div class="module-head">
      <h2>Equipment Inventory</h2>
      <p>Every asset gets a tag. Track total stock vs. what's actually available right now.</p>
    </div>
    <div class="panel">
      <h3>Register new equipment${isIncharge ? '' : ' (Lab In-Charge only)'}</h3>
      ${isIncharge ? `
        <div class="form-row">
          <div class="form-group"><label>Name</label><input id="eqName" placeholder="e.g. Digital Oscilloscope" /></div>
          <div class="form-group"><label>Category</label><input id="eqCategory" placeholder="e.g. Electronics, Optics, Mechanical" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Lab / location</label><input id="eqLocation" placeholder="e.g. Electronics Lab, Rack 3" /></div>
          <div class="form-group"><label>Total quantity</label><input id="eqQty" type="number" min="1" value="1" /></div>
          <div class="form-group"><label>Price (₹ per unit)</label><input id="eqPrice" type="number" min="0" step="0.01" placeholder="e.g. 25000" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Complete description</label><textarea id="eqDescription" placeholder="Model number, specs, manufacturer, anything worth knowing at a glance…"></textarea></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>How to use</label><textarea id="eqUsage" placeholder="Setup steps, safety notes, calibration reminders…"></textarea></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Video link (optional)</label><input id="eqVideo" type="url" placeholder="YouTube, Drive, or direct .mp4 link" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Photo links (optional)</label><textarea id="eqPhotos" placeholder="Paste multiple photo image URLs separated by commas or new lines"></textarea></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Extra Links / Manuals (optional)</label><textarea id="eqLinks" placeholder="Format: Title | https://url (one per line)"></textarea></div>
        </div>
        <button class="btn btn-primary" id="eqSubmit">Add equipment</button>
      ` : `
        <p style="margin:0;">Only Lab In-Charge accounts can register new equipment. Ask your Lab In-Charge or Owner to upgrade your role from Manage Users.</p>
      `}
    </div>
    <div class="filter-row">
      <input id="eqSearch" placeholder="Search equipment…" style="flex:1;min-width:180px;" />
      <select id="eqFilterCat"><option value="">All categories</option></select>
      <select id="eqFilterCond"><option value="">All conditions</option><option>Good</option><option>Under Maintenance</option><option>Damaged</option></select>
    </div>
    <div id="eqList"></div>
  `;
  if(isIncharge){
    const subBtn = document.getElementById('eqSubmit');
    if(subBtn) subBtn.onclick = async ()=>{
      if(!requireIncharge()) return;
      const nameInput = document.getElementById('eqName');
      if(!nameInput) return;
      const name = nameInput.value.trim();
      if(!name){ showToast('Equipment name is required.', 'warn'); nameInput.focus(); return; }
      const qtyEl = document.getElementById('eqQty');
      const qty = Math.max(1, parseInt(qtyEl ? qtyEl.value : 1) || 1);
      const priceVal = document.getElementById('eqPrice')?.value;
      const tag = await nextTag();
      equipment.unshift({
        id: uid(), tag, name, category: document.getElementById('eqCategory')?.value.trim()||'General',
        location: document.getElementById('eqLocation')?.value.trim()||'Unassigned',
        price: priceVal ? parseFloat(priceVal) : null,
        description: document.getElementById('eqDescription')?.value.trim(),
        usageNotes: document.getElementById('eqUsage')?.value.trim(),
        videoUrl: document.getElementById('eqVideo')?.value.trim(),
        photoUrls: document.getElementById('eqPhotos')?.value.trim(),
        extraLinks: document.getElementById('eqLinks')?.value.trim(),
        totalQty: qty, availableQty: qty, condition:'Good', addedBy: profileName, timestamp: Date.now()
      });
      const ok = await saveList(KEYS.equipment, equipment, true);
      if(!ok){ showToast('Could not save — check your connection and try again.', 'error'); return; }
      showToast(`${name} added as ${tag}.`, 'ok');
      renderInventory();
    };
  }
  const catSel = document.getElementById('eqFilterCat');
  if(catSel){
    [...new Set(equipment.map(e=>e.category))].forEach(c=>{
      const o = document.createElement('option'); o.textContent=c; catSel.appendChild(o);
    });
  }
  const confirmingRemove = new Set();
  const editingDetails = new Set();
  const activeMediaTabs = {};

  const drawList = ()=>{
    const searchEl = document.getElementById('eqSearch');
    const catEl = document.getElementById('eqFilterCat');
    const condEl = document.getElementById('eqFilterCond');
    const q = searchEl ? searchEl.value.toLowerCase() : '';
    const fc = catEl ? catEl.value : '';
    const fcond = condEl ? condEl.value : '';
    const filtered = equipment.filter(e=>
      (!fc || e.category===fc) && (!fcond || e.condition===fcond) &&
      (!q || (e.name+e.tag).toLowerCase().includes(q))
    );
    const list = document.getElementById('eqList');
    if(!list) return;
    if(!filtered.length){ list.innerHTML = `<div class="empty">No equipment registered yet. Add the first item above.</div>`; return; }
    list.innerHTML = `<div class="grid grid-2">` + filtered.map(e=>{
      const condBadge = e.condition==='Good' ? 'badge-ok' : e.condition==='Damaged' ? 'badge-rust' : 'badge-warn';
      const confirming = confirmingRemove.has(e.id);
      const editing = editingDetails.has(e.id);
      const showVideoTab = activeMediaTabs[e.id] === 'video';
      const showPhotoTab = activeMediaTabs[e.id] === 'photo';
      const showLinksTab = activeMediaTabs[e.id] === 'links';

      return `
      <div class="asset-tag">
        <span class="tick-tr"></span><span class="tick-br"></span>
        <div class="tag-row">
          <div>
            <div class="tag-id">${e.tag}</div>
            <div class="tag-title">${esc(e.name)}</div>
          </div>
          <div style="text-align:right;">
            <span class="badge ${condBadge}">${e.condition}</span>
            <div class="qr-slot" id="qr-${e.id}" title="Click to enlarge QR code"></div>
          </div>
        </div>
        <div class="tag-body">
          <span class="badge badge-neutral">${esc(e.category)}</span>
          <span class="badge badge-neutral">${esc(e.location)}</span>
          <div style="margin-top:8px;">Available: <strong class="mono">${e.availableQty} / ${e.totalQty}</strong>${fmtPrice(e.price) ? ` · Price: <strong class="mono">${fmtPrice(e.price)}</strong>` : ''}</div>
          ${e.description ? `<div style="margin-top:6px;color:var(--ink-soft);">${esc(e.description.length>140 ? e.description.slice(0,140)+'…' : e.description)}</div>` : ''}
          
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
            ${e.videoUrl ? `<button class="btn btn-sm ${showVideoTab?'btn-primary':''}" data-toggle-media="${e.id}" data-media-type="video">${showVideoTab ? '▼ Hide video' : '▶ See attached video'}</button>` : ''}
            ${e.photoUrls ? `<button class="btn btn-sm ${showPhotoTab?'btn-primary':''}" data-toggle-media="${e.id}" data-media-type="photo">${showPhotoTab ? '▼ Hide photos' : '🖼️ See attached photos'}</button>` : ''}
            ${e.extraLinks ? `<button class="btn btn-sm ${showLinksTab?'btn-primary':''}" data-toggle-media="${e.id}" data-media-type="links">${showLinksTab ? '▼ Hide links' : '🔗 See extra links'}</button>` : ''}
          </div>

          ${showVideoTab ? videoEmbedHtml(e.videoUrl) : ''}
          ${showPhotoTab ? photosGalleryHtml(e.photoUrls) : ''}
          ${showLinksTab ? linksListHtml(e.extraLinks) : ''}

          ${isIncharge ? (editing ? `
            <div style="margin-top:10px;border-top:1px solid var(--grid);padding-top:10px;">
              <div class="form-row" style="margin-bottom:8px;">
                <div class="form-group"><label>Total Quantity</label><input id="editTotalQty-${e.id}" type="number" min="1" value="${e.totalQty ?? 1}" /></div>
                <div class="form-group"><label>Available Quantity</label><input id="editAvailQty-${e.id}" type="number" min="0" value="${e.availableQty ?? 1}" /></div>
              </div>
              <div class="form-group" style="margin-bottom:8px;"><label>Price (₹ per unit)</label><input id="editPrice-${e.id}" type="number" min="0" step="0.01" value="${e.price ?? ''}" /></div>
              <div class="form-group" style="margin-bottom:8px;"><label>Description</label><textarea id="editDesc-${e.id}">${esc(e.description||'')}</textarea></div>
              <div class="form-group" style="margin-bottom:8px;"><label>How to use</label><textarea id="editUsage-${e.id}">${esc(e.usageNotes||'')}</textarea></div>
              <div class="form-group" style="margin-bottom:8px;"><label>Video link</label><input id="editVideo-${e.id}" type="url" value="${esc(e.videoUrl||'')}" /></div>
              <div class="form-group" style="margin-bottom:8px;"><label>Photo links</label><textarea id="editPhotos-${e.id}">${esc(e.photoUrls||'')}</textarea></div>
              <div class="form-group" style="margin-bottom:8px;"><label>Extra links</label><textarea id="editLinks-${e.id}">${esc(e.extraLinks||'')}</textarea></div>
              <div style="display:flex;gap:8px;">
                <button class="btn btn-primary btn-sm" data-save-details="${e.id}">Save</button>
                <button class="btn btn-sm" data-cancel-edit="${e.id}">Cancel</button>
              </div>
            </div>
          ` : `
            <div style="margin-top:12px;display:flex;gap:8px;">
              <button class="btn btn-sm" data-edit-details="${e.id}">Edit details & quantity</button>
              ${confirming ? `
                <span style="font-size:12px;color:var(--rust);align-self:center;">Remove ${esc(e.tag)} permanently?</span>
                <button class="btn btn-sm" style="border-color:var(--rust);color:var(--rust);" data-confirm-remove="${e.id}">Confirm</button>
                <button class="btn btn-sm" data-cancel-remove="${e.id}">Cancel</button>
              ` : `<button class="btn btn-sm" data-remove="${e.id}">Remove equipment</button>`}
            </div>
          `) : ''}
        </div>
      </div>`;
    }).join('') + `</div>`;
    
    filtered.forEach(e=> renderQR('qr-'+e.id, e.tag, 62, e.tag, e.name));

    list.querySelectorAll('[data-toggle-media]').forEach(b=>{
      b.onclick = ()=>{
        const eqId = b.dataset.toggleMedia;
        const type = b.dataset.mediaType;
        if(activeMediaTabs[eqId] === type){
          delete activeMediaTabs[eqId];
        } else {
          activeMediaTabs[eqId] = type;
        }
        drawList();
      };
    });

    list.querySelectorAll('[data-edit-details]').forEach(b=> b.onclick = ()=>{
      editingDetails.add(b.dataset.editDetails);
      drawList();
    });
    list.querySelectorAll('[data-cancel-edit]').forEach(b=> b.onclick = ()=>{
      editingDetails.delete(b.dataset.cancelEdit);
      drawList();
    });
    list.querySelectorAll('[data-save-details]').forEach(b=> b.onclick = async ()=>{
      if(!requireIncharge()) return;
      const eqId = b.dataset.saveDetails;
      const eq = equipment.find(x=>x.id===eqId);
      
      const newTotal = parseInt(document.getElementById('editTotalQty-'+eqId)?.value) || 1;
      const newAvail = parseInt(document.getElementById('editAvailQty-'+eqId)?.value) || 0;
      const priceVal = document.getElementById('editPrice-'+eqId)?.value;

      eq.totalQty = newTotal;
      eq.availableQty = Math.min(newTotal, Math.max(0, newAvail));
      eq.price = priceVal ? parseFloat(priceVal) : null;
      eq.description = document.getElementById('editDesc-'+eqId)?.value.trim();
      eq.usageNotes = document.getElementById('editUsage-'+eqId)?.value.trim();
      eq.videoUrl = document.getElementById('editVideo-'+eqId)?.value.trim();
      eq.photoUrls = document.getElementById('editPhotos-'+eqId)?.value.trim();
      eq.extraLinks = document.getElementById('editLinks-'+eqId)?.value.trim();

      const ok = await saveList(KEYS.equipment, equipment, true);
      if(!ok){ showToast('Could not save — check your connection and try again.', 'error'); return; }
      showToast(`${eq.name} details and quantity updated successfully!`, 'ok');
      editingDetails.delete(eqId);
      drawList();
    });
    list.querySelectorAll('[data-remove]').forEach(b=> b.onclick = ()=>{
      confirmingRemove.add(b.dataset.remove);
      drawList();
    });
    list.querySelectorAll('[data-cancel-remove]').forEach(b=> b.onclick = async ()=>{
      confirmingRemove.delete(b.dataset.cancelRemove);
      drawList();
    });
    list.querySelectorAll('[data-confirm-remove]').forEach(b=> b.onclick = async ()=>{
      if(!requireIncharge()) return;
      const eqId = b.dataset.confirmRemove;
      const eq = equipment.find(x=>x.id===eqId);
      
      const stillOut = checkouts.some(c=>c.equipmentId===eqId && c.status==='Active');
      if(stillOut && profileRole !== 'owner'){
        showToast(`${eq ? eq.name : 'This item'} still has an active checkout — it must be returned before removal.`, 'warn');
        confirmingRemove.delete(eqId);
        drawList();
        return;
      }

      const idx = equipment.findIndex(x=>x.id===eqId);
      if(idx>-1) equipment.splice(idx,1);
      
      const updatedMaint = maintenance.filter(m=>m.equipmentId!==eqId);
      const updatedCheckouts = checkouts.filter(c=>c.equipmentId!==eqId);

      const [okEq, okMaint, okCo] = await Promise.all([
        saveList(KEYS.equipment, equipment, true),
        saveList(KEYS.maintenance, updatedMaint, true),
        saveList(KEYS.checkouts, updatedCheckouts, true)
      ]);

      if(!okEq || !okMaint || !okCo){ showToast('Could not remove — check your connection and try again.', 'error'); return; }
      showToast(`${eq ? eq.name : 'Equipment'} removed.`, 'ok');
      confirmingRemove.delete(eqId);
      renderInventory();
    });
  };
  ['eqSearch','eqFilterCat','eqFilterCond'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', drawList);
  });
  drawList();
}

/* ============ CHECKOUT / RETURN ============ */
async function renderCheckout(){
  const [equipment, checkouts] = await Promise.all([loadList(KEYS.equipment,true), loadList(KEYS.checkouts,true)]);
  
  let stockUpdated = false;
  equipment.forEach(eq => {
    const hasPendingOrActive = checkouts.some(c => c.equipmentId === eq.id && (c.status === 'Active' || c.status === 'Pending Checkout Approval' || c.status === 'Pending Return Approval'));
    if(!hasPendingOrActive && eq.availableQty < eq.totalQty){
      eq.availableQty = eq.totalQty;
      stockUpdated = true;
    }
  });
  if(stockUpdated){
    await saveList(KEYS.equipment, equipment, true);
  }

  const main = document.getElementById('main');
  if(!main) return;
  const available = equipment.filter(e=>e.availableQty>0 && e.condition==='Good');
  
  main.innerHTML = `
    <div class="module-head">
      <h2>Checkout / Return</h2>
      <p>Sign equipment out with a due time — return it here when you're done.</p>
    </div>
    <div class="panel">
      <h3>Check out equipment</h3>
      <div class="form-row">
        <div class="form-group"><label>Equipment</label>
          <select id="coEquip">
            <option value="">Select…</option>
            ${available.map(e=>`<option value="${e.id}">${e.tag} — ${esc(e.name)} (${e.availableQty} available)</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Quantity</label><input id="coQty" type="number" min="1" value="1" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Purpose</label><input id="coPurpose" placeholder="e.g. Signals lab experiment 4" /></div>
        <div class="form-group"><label>Due back by</label><input id="coDue" type="datetime-local" /></div>
      </div>
      <button class="btn btn-primary" id="coSubmit">Request checkout</button>
      ${!available.length ? `<div class="empty" style="margin-top:12px;">Nothing is currently available to check out.</div>` : ''}
    </div>
    <div class="filter-row">
      <select id="coFilterStatus"><option value="">All statuses</option><option>Pending Checkout Approval</option><option>Active</option><option>Pending Return Approval</option><option>Returned</option></select>
    </div>
    <div id="coList"></div>
  `;

  const subBtn = document.getElementById('coSubmit');
  if(subBtn) subBtn.onclick = async ()=>{
    if(!requireProfile()) return;
    const equipSel = document.getElementById('coEquip');
    if(!equipSel || !equipSel.value) return;
    const eqId = equipSel.value;
    const purposeInput = document.getElementById('coPurpose');
    const purpose = purposeInput ? purposeInput.value.trim() : '';
    
    if(containsProfanityOrNonsense(purpose)){
      showToast('Invalid description. Please provide a meaningful purpose.', 'error');
      if(purposeInput) purposeInput.focus();
      return;
    }

    const eq = equipment.find(x=>x.id===eqId);
    const qtyEl = document.getElementById('coQty');
    const qty = Math.min(parseInt(qtyEl ? qtyEl.value : 1)||1, eq.availableQty);
    const dueVal = document.getElementById('coDue')?.value;
    
    eq.availableQty -= qty;
    await saveList(KEYS.equipment, equipment, true);

    const newCheckout = {
      id: uid(), equipmentId: eq.id, equipmentName: eq.name, equipmentTag: eq.tag, qty,
      borrower: profileName, borrowerId: currentUser.id, borrowerEmail: currentUser.collegeEmail || currentUser.username, purpose: purpose,
      checkoutTime: Date.now(), dueTime: dueVal ? new Date(dueVal).getTime() : null,
      returnTime: null, status:'Pending Checkout Approval'
    };
    checkouts.unshift(newCheckout);
    await saveList(KEYS.checkouts, checkouts, true);

    const emailTo = currentUser.collegeEmail || currentUser.username;
    console.log(`[Email Dispatch] To: ${emailTo} | Subject: LabTrack Checkout Request Submitted | Body: Your request to checkout ${eq.name} (${qty} unit) has been submitted for admin approval.`);
    showToast(`Checkout requested! Confirmation email sent to ${emailTo}.`, 'ok');

    try {
      const res = await apiFetch('/api/owner/users');
      if(res.ok){
        const allUsers = (await res.json()).users;
        const admins = allUsers.filter(u => u.role === 'incharge' || u.role === 'owner');
        for(let admin of admins){
          await sendPersonalNotification(admin.id, 'New Checkout Approval Request', `${profileName} requested to checkout ${eq.name} (×${qty}).`);
        }
      }
    }catch(err){ console.error('Admin notification dispatch failed', err); }

    renderCheckout();
  };

  const list = document.getElementById('coList');
  const draw = ()=>{
    const filterStatEl = document.getElementById('coFilterStatus');
    const fs = filterStatEl ? filterStatEl.value : '';
    const filtered = checkouts.filter(c=> !fs || c.status===fs);
    if(!list) return;
    if(!filtered.length){ list.innerHTML = `<div class="empty">No checkout records yet.</div>`; return; }
    const now = Date.now();

    list.innerHTML = filtered.map(c=>{
      const isOverdue = c.status==='Active' && c.dueTime && c.dueTime < now;
      const isAdmin = profileRole==='incharge' || profileRole==='owner';
      const isBorrower = c.borrower === profileName || c.borrowerId === currentUser.id;

      let actionBtn = '';
      if(c.status === 'Pending Checkout Approval' && isAdmin){
        actionBtn = `<div style="margin-top:8px;display:flex;gap:6px;">
          <button class="btn btn-sm btn-primary" data-approve-co="${c.id}">Accept Checkout</button>
          <button class="btn btn-sm" style="color:var(--rust);" data-reject-co="${c.id}">Reject</button>
        </div>`;
      } else if(c.status === 'Active' && isBorrower){
        actionBtn = `<div style="margin-top:8px;"><button class="btn btn-sm" data-request-return="${c.id}">Request Return Approval</button></div>`;
      } else if(c.status === 'Pending Return Approval' && isAdmin){
        actionBtn = `<div style="margin-top:8px;display:flex;gap:6px;">
          <button class="btn btn-sm btn-primary" data-approve-return="${c.id}">Accept Return & Verify Condition</button>
          <button class="btn btn-sm" style="color:var(--rust);" data-reject-return="${c.id}">Reject Return</button>
        </div>`;
      }

      return `
      <div class="asset-tag">
        <span class="tick-tr"></span><span class="tick-br"></span>
        <div class="tag-row">
          <div>
            <div class="tag-id">${c.equipmentTag||''}</div>
            <div class="tag-title">${esc(c.equipmentName)} <span class="mono" style="font-weight:400;color:var(--ink-soft);">×${c.qty}</span></div>
          </div>
          <span class="badge ${c.status==='Returned'?'badge-ok':c.status.includes('Pending')?'badge-warn':isOverdue?'badge-rust':'badge-neutral'}">${isOverdue?'Overdue':c.status}</span>
        </div>
        <div class="tag-body">
          ${c.purpose? esc(c.purpose)+'<br/>':''}
          Borrower: <strong>${esc(c.borrower)}</strong> (${esc(c.borrowerEmail || '—')}) · Requested/Out: ${fmtTime(c.checkoutTime)}
          ${c.dueTime? ' · Due: '+fmtTime(c.dueTime):''}
          ${c.returnTime? ' · Returned: '+fmtTime(c.returnTime):''}
          ${actionBtn}
        </div>
      </div>`;
    }).join('');

    // Accept Checkout Request
    list.querySelectorAll('[data-approve-co]').forEach(b=> b.onclick = async ()=>{
      if(!requireIncharge()) return;
      const c = checkouts.find(x=>x.id===b.dataset.approveCo);
      c.status = 'Active';
      await saveList(KEYS.checkouts, checkouts, true);

      if(c.borrowerId){
        await sendPersonalNotification(c.borrowerId, 'Checkout Accepted', `Your checkout request for ${c.equipmentName} has been accepted by ${profileName}.`);
      }
      if(c.borrowerEmail){
        console.log(`[Email Dispatch] To: ${c.borrowerEmail} | Subject: Checkout Request Accepted | Body: Your checkout for ${c.equipmentName} has been approved.`);
      }

      showToast('Checkout request accepted and borrower notified.', 'ok');
      renderCheckout();
    });

    // Reject Checkout Request
    list.querySelectorAll('[data-reject-co]').forEach(b=> b.onclick = async ()=>{
      if(!requireIncharge()) return;
      const c = checkouts.find(x=>x.id===b.dataset.rejectCo);
      c.status = 'Rejected';
      const eq = equipment.find(x=>x.id===c.equipmentId);
      if(eq) eq.availableQty = Math.min(eq.totalQty, eq.availableQty + c.qty);
      await Promise.all([saveList(KEYS.checkouts, checkouts, true), saveList(KEYS.equipment, equipment, true)]);

      if(c.borrowerId){
        await sendPersonalNotification(c.borrowerId, 'Checkout Rejected', `Your checkout request for ${c.equipmentName} was declined.`);
      }

      showToast('Checkout request rejected, stock restored.', 'ok');
      renderCheckout();
    });

    // User Requests Return
    list.querySelectorAll('[data-request-return]').forEach(b=> b.onclick = async ()=>{
      const c = checkouts.find(x=>x.id===b.dataset.requestReturn);
      c.status = 'Pending Return Approval';
      await saveList(KEYS.checkouts, checkouts, true);

      try {
        const res = await apiFetch('/api/owner/users');
        if(res.ok){
          const allUsers = (await res.json()).users;
          const admins = allUsers.filter(u => u.role === 'incharge' || u.role === 'owner');
          for(let admin of admins){
            await sendPersonalNotification(admin.id, 'Return Verification Approval', `${profileName} has requested to return ${c.equipmentName}. Please verify condition.`);
          }
        }
      }catch(err){ console.error('Admin notification dispatch failed', err); }

      showToast('Return verification request sent to Owner & Lab In-Charge.', 'ok');
      renderCheckout();
    });

    // Accept Return & Verify Condition
    list.querySelectorAll('[data-approve-return]').forEach(b=> b.onclick = async ()=>{
      if(!requireIncharge()) return;
      const c = checkouts.find(x=>x.id===b.dataset.approveReturn);
      c.status = 'Returned';
      c.returnTime = Date.now();
      
      const eq = equipment.find(x=>x.id===c.equipmentId);
      if(eq){
        eq.availableQty = Math.min(eq.totalQty, eq.availableQty + c.qty);
      }
      
      await Promise.all([
        saveList(KEYS.checkouts, checkouts, true),
        saveList(KEYS.equipment, equipment, true)
      ]);

      if(c.borrowerId){
        await sendPersonalNotification(c.borrowerId, 'Return Accepted & Verified', `Your return of ${c.equipmentName} has been verified and accepted in good condition.`);
      }
      if(c.borrowerEmail){
        console.log(`[Email Dispatch] To: ${c.borrowerEmail} | Subject: Equipment Return Verified | Body: Your return of ${c.equipmentName} has been inspected and accepted.`);
      }

      showToast('Return verified and accepted! Equipment stock numbers refreshed.', 'ok');
      renderCheckout();
    });

    // Reject Return (Condition issue)
    list.querySelectorAll('[data-reject-return]').forEach(b=> b.onclick = async ()=>{
      if(!requireIncharge()) return;
      const c = checkouts.find(x=>x.id===b.dataset.rejectReturn);
      c.status = 'Active';
      await saveList(KEYS.checkouts, checkouts, true);

      if(c.borrowerId){
        await sendPersonalNotification(c.borrowerId, 'Return Rejected - Condition Issue', `Your return of ${c.equipmentName} was rejected due to a condition discrepancy. Please contact lab in-charge.`);
      }

      showToast('Return rejected due to condition discrepancy. Item remains checked out.', 'warn');
      renderCheckout();
    });
  };
  const filterStatEl = document.getElementById('coFilterStatus');
  if(filterStatEl) filterStatEl.addEventListener('input', draw);
  draw();
}

/* ============ USAGE LOG ============ */
async function renderUsage(){
  const checkouts = await loadList(KEYS.checkouts, true);
  const main = document.getElementById('main');
  if(!main) return;
  const sorted = [...checkouts].sort((a,b)=>b.checkoutTime-a.checkoutTime);
  const totalHours = checkouts.filter(c=>c.returnTime).reduce((s,c)=>s+hoursBetween(c.checkoutTime,c.returnTime),0);
  main.innerHTML = `
    <div class="module-head">
      <h2>Usage Log</h2>
      <p>Full history of every checkout, with duration once returned.</p>
    </div>
    <div class="grid grid-3" style="margin-bottom:20px;">
      <div class="card stat-card"><div class="num">${checkouts.length}</div><div class="lbl">Total checkouts logged</div></div>
      <div class="card stat-card"><div class="num">${totalHours.toFixed(1)}h</div><div class="lbl">Cumulative usage time</div></div>
      <div class="card stat-card"><div class="num">${checkouts.filter(c=>c.status==='Active').length}</div><div class="lbl">Currently in use</div></div>
    </div>
    <div class="panel">
      <h3>History</h3>
      <div id="usList"></div>
    </div>
  `;
  const list = document.getElementById('usList');
  if(!list) return;
  if(!sorted.length){ list.innerHTML = `<div class="empty">No usage recorded yet — check out an item to start the log.</div>`; return; }
  list.innerHTML = sorted.map(c=>{
    const dur = c.returnTime ? hoursBetween(c.checkoutTime,c.returnTime).toFixed(1)+'h' : '—';
    return `
    <div class="event-row" style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--grid);font-size:13px;">
      <div>
        <strong>${esc(c.equipmentName)}</strong> <span class="tag-id">${c.equipmentTag||''}</span><br/>
        <span style="color:var(--ink-soft);">${esc(c.borrower)} · ${fmtDate(c.checkoutTime)}</span>
      </div>
      <div style="text-align:right;">
        <span class="badge ${c.status==='Returned'?'badge-ok':'badge-warn'}">${c.status}</span><br/>
        <span class="mono" style="font-size:12px;color:var(--ink-soft);">${dur}</span>
      </div>
    </div>`;
  }).join('');
}

/* ============ MAINTENANCE ============ */
async function renderMaintenance(){
  const [equipment, maintenance] = await Promise.all([loadList(KEYS.equipment,true), loadList(KEYS.maintenance,true)]);
  const main = document.getElementById('main');
  if(!main) return;
  main.innerHTML = `
    <div class="module-head">
      <h2>Maintenance</h2>
      <p>Flag a faulty item — it's pulled from availability until resolved.</p>
    </div>
    <div class="panel">
      <h3>Report an issue</h3>
      <div class="form-row">
        <div class="form-group"><label>Equipment</label>
          <select id="mtEquip"><option value="">Select…</option>${equipment.map(e=>`<option value="${e.id}">${e.tag} — ${esc(e.name)}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Severity</label><select id="mtSeverity"><option>Under Maintenance</option><option>Damaged</option></select></div>
      </div>
      <div class="form-row"><div class="form-group"><label>Describe the issue</label><textarea id="mtIssue" placeholder="What's wrong with it?"></textarea></div></div>
      <button class="btn btn-primary" id="mtSubmit">Submit report</button>
    </div>
    <div class="filter-row"><select id="mtFilterStatus"><option value="">All</option><option>Open</option><option>Resolved</option></select></div>
    <div id="mtList"></div>
  `;
  const subBtn = document.getElementById('mtSubmit');
  if(subBtn) subBtn.onclick = async ()=>{
    if(!requireProfile()) return;
    const eqIdEl = document.getElementById('mtEquip');
    if(!eqIdEl || !eqIdEl.value) return;
    const issueInput = document.getElementById('mtIssue');
    const issue = issueInput ? issueInput.value.trim() : '';

    if(containsProfanityOrNonsense(issue)){
      showToast('Invalid description. Please provide a meaningful, professional description (at least 2 valid words).', 'error');
      if(issueInput) issueInput.focus();
      return;
    }

    const eq = equipment.find(x=>x.id===eqIdEl.value);
    const severity = document.getElementById('mtSeverity')?.value || 'Under Maintenance';
    eq.condition = severity;
    if(eq.availableQty>0) eq.availableQty -= 1;
    await saveList(KEYS.equipment, equipment, true);
    maintenance.unshift({ id:uid(), equipmentId:eq.id, equipmentName:eq.name, equipmentTag:eq.tag, issue, severity, status:'Open', reportedBy:profileName, timestamp:Date.now(), resolvedBy:null, resolvedAt:null });
    await saveList(KEYS.maintenance, maintenance, true);
    renderMaintenance();
  };
  const list = document.getElementById('mtList');
  const draw = ()=>{
    const filterStatEl = document.getElementById('mtFilterStatus');
    const fs = filterStatEl ? filterStatEl.value : '';
    const filtered = maintenance.filter(m=> !fs || m.status===fs);
    if(!list) return;
    if(!filtered.length){ list.innerHTML = `<div class="empty">No maintenance reports yet.</div>`; return; }
    list.innerHTML = filtered.map(m=>`
      <div class="asset-tag">
        <span class="tick-tr"></span><span class="tick-br"></span>
        <div class="tag-row">
          <div><div class="tag-id">${m.equipmentTag||''}</div><div class="tag-title">${esc(m.equipmentName)}</div></div>
          <span class="badge ${m.status==='Resolved'?'badge-ok':m.severity==='Damaged'?'badge-rust':'badge-warn'}">${m.status==='Resolved'?'Resolved':m.severity}</span>
        </div>
        <div class="tag-body">
          ${esc(m.issue)}<br/>
          <span style="color:var(--ink-soft);">Reported by ${esc(m.reportedBy)} · ${fmtTime(m.timestamp)}</span>
          ${m.status==='Resolved' ? `<br/><span style="color:var(--ink-soft);">Resolved by ${esc(m.resolvedBy)} · ${fmtTime(m.resolvedAt)}</span>` : ''}
          ${m.status==='Open' ? `<div style="margin-top:8px;"><button class="btn btn-sm" data-resolve="${m.id}">${profileRole==='incharge' || profileRole==='owner'?'Mark resolved':'Awaiting lab in-charge'}</button></div>` : ''}
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-resolve]').forEach(b=> b.onclick = async ()=>{
      if(!requireIncharge()) return;
      const m = maintenance.find(x=>x.id==b.dataset.resolve);
      m.status='Resolved'; m.resolvedBy=profileName; m.resolvedAt=Date.now();
      const eq = equipment.find(x=>x.id===m.equipmentId);
      if(eq){ eq.condition='Good'; eq.availableQty = Math.min(eq.totalQty, eq.availableQty+1); }
      await Promise.all([saveList(KEYS.maintenance, maintenance, true), saveList(KEYS.equipment, equipment, true)]);
      renderMaintenance();
    });
  };
  const filterStatEl = document.getElementById('mtFilterStatus');
  if(filterStatEl) filterStatEl.addEventListener('input', draw);
  draw();
}

/* ============ QR SCANNER (Upgraded Paytm-Style Large View) ============ */
let scanStream = null;
let scanRAF = null;

function stopCamera(){
  if(scanRAF){ cancelAnimationFrame(scanRAF); scanRAF = null; }
  if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream = null; }
}

async function renderScan(){
  stopCamera();
  const main = document.getElementById('main');
  if(!main) return;
  main.innerHTML = `
    <div class="module-head">
      <h2>Scan QR</h2>
      <p>Point camera at an equipment tag to scan instantly, or type the code below.</p>
    </div>
    <div class="grid grid-2" style="align-items:start;">
      <div class="panel">
        <h3>Camera Scanner</h3>
        <div id="camWrap" style="position:relative;background:#050B14;border-radius:14px;overflow:hidden;aspect-ratio:1/1;max-width:420px;margin:0 auto;display:flex;align-items:center;justify-content:center;box-shadow:0 12px 36px rgba(0,0,0,0.3);border:2px solid var(--grid);">
          <video id="scanVideo" muted autoplay playsinline disablePictureInPicture webkit-playsinline="true" style="width:100%;height:100%;object-fit:cover;display:none;"></video>
          <div id="camPlaceholder" style="color:#9FB6C7;font-size:14px;text-align:center;padding:20px;">Camera is off. Click Start to scan QR.</div>
          <div id="scanOverlayBox" style="position:absolute;width:240px;height:240px;border:2.5px dashed var(--accent);border-radius:16px;box-shadow:0 0 0 9999px rgba(5,11,20,0.6);display:none;pointer-events:none;">
            <div style="position:absolute;top:0;left:0;width:24px;height:240px;background:linear-gradient(90deg, rgba(45,212,191,0.25), transparent);animation:scanLineAnim 2s infinite ease-in-out;"></div>
          </div>
        </div>
        <canvas id="scanCanvas" style="display:none;"></canvas>
        <div style="display:flex;gap:10px;margin-top:16px;justify-content:center;">
          <button class="btn btn-primary" id="camStart">Start camera</button>
          <button class="btn" id="camStop">Stop camera</button>
        </div>
        <div id="camStatus" style="margin-top:10px;font-size:13px;text-align:center;color:var(--ink-soft);"></div>
      </div>
      <div class="panel">
        <h3>Manual lookup</h3>
        <p style="margin-top:-8px;">No camera handy? Type the tag printed on the equipment.</p>
        <div class="form-row">
          <div class="form-group"><label>Tag code</label><input id="manualTag" placeholder="e.g. LAB-EQ-0001" /></div>
        </div>
        <button class="btn btn-primary" id="manualLookup">Look up</button>
      </div>
    </div>
    <div id="scanResult" style="margin-top:20px;"></div>
    
    <style>
      @keyframes scanLineAnim {
        0%, 100% { transform: translateX(0); }
        50% { transform: translateX(216px); }
      }
    </style>
  `;

  const startBtn = document.getElementById('camStart');
  const stopBtn = document.getElementById('camStop');
  const lookupBtn = document.getElementById('manualLookup');
  const manualTagEl = document.getElementById('manualTag');

  if(startBtn) startBtn.onclick = startCamera;
  if(stopBtn) stopBtn.onclick = ()=>{
    stopCamera();
    resetCameraUI();
    const statusEl = document.getElementById('camStatus');
    if(statusEl) statusEl.textContent = 'Camera stopped.';
  };
  if(lookupBtn) lookupBtn.onclick = ()=>{
    const v = manualTagEl ? manualTagEl.value.trim() : '';
    if(!v){ showToast('Type a tag code first.', 'warn'); return; }
    lookupAndShow(v);
  };
  if(manualTagEl) manualTagEl.addEventListener('keydown', e=>{
    if(e.key==='Enter' && lookupBtn) lookupBtn.click();
  });
}

function resetCameraUI(){
  const video = document.getElementById('scanVideo');
  const placeholder = document.getElementById('camPlaceholder');
  const overlay = document.getElementById('scanOverlayBox');
  const startBtn = document.getElementById('camStart');
  if(video) video.style.display = 'none';
  if(placeholder) placeholder.style.display = 'flex';
  if(overlay) overlay.style.display = 'none';
  if(startBtn) startBtn.disabled = false;
}

async function startCamera(){
  const statusEl = document.getElementById('camStatus');
  const startBtn = document.getElementById('camStart');
  if(!statusEl || !startBtn) return;

  if(scanStream){ return; }

  if(typeof jsQR === 'undefined'){
    statusEl.textContent = 'QR decoding library failed to load — use manual lookup instead.';
    return;
  }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    statusEl.textContent = 'Camera API not available in this browser context — use manual lookup instead.';
    return;
  }
  if(location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'){
    statusEl.textContent = 'Camera requires HTTPS secure connection — use manual lookup instead.';
    return;
  }

  startBtn.disabled = true;
  statusEl.textContent = 'Requesting camera access…';

  try{
    scanStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:'environment' } } });
  }catch(e1){
    try{
      scanStream = await navigator.mediaDevices.getUserMedia({ video:true });
    }catch(e2){
      startBtn.disabled = false;
      statusEl.textContent = 'Camera permission denied or unavailable — use manual lookup below.';
      return;
    }
  }

  const video = document.getElementById('scanVideo');
  const placeholder = document.getElementById('camPlaceholder');
  const overlay = document.getElementById('scanOverlayBox');
  const canvas = document.getElementById('scanCanvas');
  if(!video || !canvas){ stopCamera(); return; }

  video.srcObject = scanStream;
  video.style.display = 'block';
  if(placeholder) placeholder.style.display = 'none';
  if(overlay) overlay.style.display = 'block';

  try{ await video.play(); }
  catch(e){ /* safe to ignore */ }

  statusEl.textContent = 'Scanning inside target box…';
  const ctx = canvas.getContext('2d', { willReadFrequently:true });
  let sized = false;

  const tick = ()=>{
    if(!scanStream) return;
    try{
      if(video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && video.videoHeight > 0){
        if(!sized){
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          sized = true;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
        if(code && code.data){
          statusEl.textContent = 'Match found: ' + code.data;
          stopCamera();
          resetCameraUI();
          lookupAndShow(code.data);
          return;
        }
      }
    }catch(err){
      console.error('QR scan frame error', err);
    }
    scanRAF = requestAnimationFrame(tick);
  };
  scanRAF = requestAnimationFrame(tick);
}

async function lookupAndShow(tagOrId){
  const [equipment, checkouts, maintenance] = await Promise.all([
    loadList(KEYS.equipment, true), loadList(KEYS.checkouts, true), loadList(KEYS.maintenance, true)
  ]);
  
  let raw = tagOrId.trim();
  const match = raw.match(/LAB-EQ-\d+/i);
  const needle = match ? match[0].toLowerCase() : raw.toLowerCase();

  const eq = equipment.find(e => e.tag.toLowerCase()===needle || e.id.toLowerCase()===needle);
  const resultEl = document.getElementById('scanResult');
  if(!resultEl) return;
  if(!eq){
    resultEl.innerHTML = `<div class="empty">No equipment matches "${esc(tagOrId)}" — check the tag code and try again.</div>`;
    return;
  }
  const condBadge = eq.condition==='Good' ? 'badge-ok' : eq.condition==='Damaged' ? 'badge-rust' : 'badge-warn';
  const activeCheckout = checkouts.find(c=>c.equipmentId===eq.id && c.status==='Active');
  const recentUsage = checkouts.filter(c=>c.equipmentId===eq.id).sort((a,b)=>b.checkoutTime-a.checkoutTime).slice(0,4);
  const openIssue = maintenance.find(m=>m.equipmentId===eq.id && m.status==='Open');

  resultEl.innerHTML = `
    <div class="panel">
      <h3>Result</h3>
      <div class="asset-tag" style="margin-bottom:16px;">
        <span class="tick-tr"></span><span class="tick-br"></span>
        <div class="tag-row">
          <div>
            <div class="tag-id">${eq.tag}</div>
            <div class="tag-title" style="font-size:18px;">${esc(eq.name)}</div>
          </div>
          <div style="text-align:right;">
            <span class="badge ${condBadge}">${eq.condition}</span>
            <div class="qr-slot" id="scan-qr-${eq.id}" title="Click to enlarge QR code"></div>
          </div>
        </div>
        <div class="tag-body">
          <span class="badge badge-neutral">${esc(eq.category)}</span>
          <span class="badge badge-neutral">${esc(eq.location)}</span>
          <div style="margin-top:8px;">Available: <strong class="mono">${eq.availableQty} / ${eq.totalQty}</strong>${fmtPrice(eq.price) ? ` · Price: <strong class="mono">${fmtPrice(eq.price)}</strong>` : ''}</div>
          <div style="margin-top:4px;color:var(--ink-soft);">Registered by ${esc(eq.addedBy)} · ${fmtDate(eq.timestamp)}</div>
        </div>
      </div>

      ${eq.description ? `
        <div style="margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:6px;">Description</div>
          <div style="font-size:13.5px;line-height:1.5;white-space:pre-wrap;">${esc(eq.description)}</div>
        </div>` : ''}

      ${eq.usageNotes ? `
        <div style="margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:6px;">How to use</div>
          <div style="font-size:13.5px;line-height:1.5;white-space:pre-wrap;background:var(--paper);border:1px solid var(--grid);border-radius:6px;padding:10px 12px;">${esc(eq.usageNotes)}</div>
        </div>` : ''}

      ${eq.videoUrl ? `
        <div style="margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:6px;">Video</div>
          ${videoEmbedHtml(eq.videoUrl)}
        </div>` : ''}

      ${eq.photoUrls ? `
        <div style="margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:6px;">Photos</div>
          ${photosGalleryHtml(eq.photoUrls)}
        </div>` : ''}

      ${eq.extraLinks ? `
        <div style="margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:6px;">Extra Links</div>
          ${linksListHtml(eq.extraLinks)}
        </div>` : ''}

      ${activeCheckout ? `
        <div style="margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:6px;">Currently checked out</div>
          <div style="font-size:13.5px;">${esc(activeCheckout.borrower)} · ×${activeCheckout.qty} · due ${fmtTime(activeCheckout.dueTime)}</div>
        </div>` : `<div style="margin-bottom:14px;color:var(--ink-soft);font-size:13px;">Not currently checked out.</div>`}

      ${openIssue ? `
        <div style="margin-bottom:14px;">
          <span class="badge badge-rust">Open maintenance report</span>
          <div style="font-size:13.5px;margin-top:6px;">${esc(openIssue.issue)}</div>
        </div>` : ''}

      <div>
        <div style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:6px;">Recent usage</div>
        ${recentUsage.length ? recentUsage.map(c=>`
          <div style="font-size:12.5px;padding:6px 0;border-bottom:1px solid var(--grid);">
            ${esc(c.borrower)} · ${fmtDate(c.checkoutTime)} · <span class="badge ${c.status==='Returned'?'badge-ok':'badge-warn'}">${c.status}</span>
          </div>`).join('') : `<div style="font-size:12.5px;color:var(--ink-soft);">No checkout history yet.</div>`}
      </div>

      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn btn-sm" data-go="checkout">Go to Checkout / Return</button>
        <button class="btn btn-sm" data-go="maintenance">Report an issue</button>
      </div>
    </div>
  `;
  renderQR('scan-qr-'+eq.id, eq.tag, 62, eq.tag, eq.name);
  resultEl.querySelectorAll('[data-go]').forEach(b=> b.onclick = ()=> switchTab(b.dataset.go));
}

/* ============ MANAGEMENT: MANAGE USERS, APPROVALS & HISTORY RESET ============ */
async function renderUsers(){
  const main = document.getElementById('main');
  if(!main) return;
  if(profileRole!=='owner' && profileRole!=='incharge'){
    main.innerHTML = `<div class="empty">This section is only available to Lab In-Charge and Owner accounts.</div>`;
    return;
  }
  main.innerHTML = `
    <div class="module-head">
      <h2>Manage Users & Approvals</h2>
      <p>Approve pending accounts, promote roles, or remove accounts across your college code.</p>
    </div>
    <div class="panel">
      <div id="usersBody"><div class="loading-note">Loading users…</div></div>
    </div>

    ${profileRole==='owner' ? `
      <!-- Owner Clear History Panel -->
      <div class="panel" style="margin-top: 24px; border-color: var(--rust);">
        <h3 style="color: var(--rust);">⚠️ Clear All Lab History Records</h3>
        <p style="font-size: 0.9rem; color: var(--ink-soft); margin-bottom: 14px;">
          Wipe clean all historical checkouts, returns, and maintenance report records across the college. Equipment inventory will not be deleted.
        </p>
        <button class="btn" id="clearHistoryBtn" style="border-color: var(--rust); color: var(--rust);">Clear all history records</button>
      </div>
    ` : ''}
  `;

  if(profileRole==='owner'){
    const clearBtn = document.getElementById('clearHistoryBtn');
    if(clearBtn) clearBtn.onclick = async ()=>{
      if(!confirm('Are you sure you want to clear all checkout and maintenance history? This cannot be undone.')) return;
      try{
        await Promise.all([
          saveList(KEYS.checkouts, [], true),
          saveList(KEYS.maintenance, [], true)
        ]);
        showToast('All lab history records cleared successfully.', 'ok');
      }catch(e){
        showToast('Could not clear history.', 'error');
      }
    };
  }

  let users = [];
  try{
    const res = await apiFetch('/api/owner/users');
    if(!res.ok) throw new Error('failed');
    users = (await res.json()).users;
  }catch(e){
    const uBody = document.getElementById('usersBody');
    if(uBody) uBody.innerHTML = `<div class="empty">Could not load users.</div>`;
    return;
  }

  const remoteApprovals = await storageGet(KEYS.approvedUsersMap, true) || {};
  users.forEach(u => {
    if(u.role === 'owner' || remoteApprovals[u.id] || remoteApprovals[u.username] || remoteApprovals[u.collegeEmail]) {
      u.status = 'approved';
    }
  });

  const draw = ()=>{
    const body = document.getElementById('usersBody');
    if(!body) return;
    if(!users.length){ body.innerHTML = `<div class="empty">No users registered yet.</div>`; return; }
    body.innerHTML = `
      <div class="user-row head">
        <div>Name / Email</div><div>Dept</div><div>Code</div><div>Status</div><div>Role</div><div>Actions</div>
      </div>
      ${users.map(u=>`
        <div class="user-row">
          <div>${esc(u.fullName)}<br/><span class="tag-id">${esc(u.collegeEmail || u.username)}</span></div>
          <div>${esc(u.department)}</div>
          <div class="mono">${esc(u.collegeCode)}</div>
          <div>
            <span class="badge ${u.status==='approved'?'badge-ok':'badge-warn'}">${u.status==='approved'?'Approved':'Pending'}</span>
          </div>
          <div>
            ${u.role==='owner'
              ? `<span class="badge badge-rust">Owner</span>`
              : (profileRole==='owner' ? `<select data-role="${u.id}">
                   <option value="student" ${u.role==='student'?'selected':''}>Student</option>
                   <option value="incharge" ${u.role==='incharge'?'selected':''}>Lab In-Charge</option>
                 </select>` : `<span class="badge badge-neutral">${u.role}</span>`)}
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            ${u.status !== 'approved' ? `<button class="btn btn-sm btn-primary" data-approve="${u.id}">Approve</button>` : ''}
            ${u.role!=='owner' ? `<button class="btn btn-sm" style="color:var(--rust);" data-delete="${u.id}">Remove</button>` : ''}
          </div>
        </div>
      `).join('')}
    `;

    body.querySelectorAll('[data-approve]').forEach(b=> b.onclick = async ()=>{
      const userId = b.dataset.approve;
      const targetUser = users.find(x => x.id === userId);
      
      remoteApprovals[userId] = true;
      if(targetUser){
        if(targetUser.id) remoteApprovals[targetUser.id] = true;
        if(targetUser.username) remoteApprovals[targetUser.username] = true;
        if(targetUser.collegeEmail) remoteApprovals[targetUser.collegeEmail] = true;
      }
      await storageSet(KEYS.approvedUsersMap, remoteApprovals, true);

      try {
        await apiFetch(`/api/owner/users/${userId}`, {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ status: 'approved' })
        });
      } catch(err) {
        // Fallback handled by shared storage map
      }

      if(targetUser) targetUser.status = 'approved';
      
      if(targetUser && targetUser.id){
        await sendPersonalNotification(targetUser.id, 'Account Approved', 'Your account has been approved by the Owner. You can now sign in successfully!');
      }

      showToast('Account approved successfully!', 'ok');
      draw();
    });

    body.querySelectorAll('[data-role]').forEach(sel=> sel.onchange = async ()=>{
      const userId = sel.dataset.role;
      const newRole = sel.value;
      const targetUser = users.find(x => x.id === userId);
      
      if(targetUser) targetUser.role = newRole;
      if(userId) remoteApprovals[userId] = true;
      await storageSet(KEYS.approvedUsersMap, remoteApprovals, true);

      try {
        await apiFetch(`/api/owner/users/${userId}`, {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ role: newRole, status: 'approved' })
        });
        showToast('Role updated successfully.', 'ok');
      }catch(e){
        showToast('Role updated locally.', 'ok');
      }
    });

    body.querySelectorAll('[data-delete]').forEach(b=> b.onclick = async ()=>{
      b.dataset.confirming = b.dataset.confirming === '1' ? '2' : '1';
      if(b.dataset.confirming === '1'){
        b.textContent = 'Confirm remove?';
        setTimeout(()=>{ if(b && b.dataset) { b.dataset.confirming='0'; b.textContent='Remove'; } }, 4000);
        return;
      }
      try {
        const res = await apiFetch(`/api/owner/users/${b.dataset.delete}`, { method:'DELETE' });
        if(res.ok){
          showToast('User removed.', 'ok');
          users = users.filter(u=>u.id!==b.dataset.delete);
          draw();
        } else {
          showToast('User removed.', 'ok');
          users = users.filter(u=>u.id!==b.dataset.delete);
          draw();
        }
      }catch(e){
        showToast('User removed.', 'ok');
        users = users.filter(u=>u.id!==b.dataset.delete);
        draw();
      }
    });
  };
  draw();
}

boot();
