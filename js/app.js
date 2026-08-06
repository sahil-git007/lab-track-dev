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

function videoEmbedHtml(url){
  if(!url || !isSafeUrl(url)) return '';
  const clean = url.trim();

  // 1. YouTube links
  const ytMatch = clean.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  if(ytMatch && ytMatch[1]){
    const videoId = ytMatch[1];
    return `<div style="position:relative;width:100%;padding-bottom:56.25%;height:0;margin-top:6px;border-radius:8px;overflow:hidden;border:1px solid var(--grid);">
      <iframe src="https://www.youtube-nocookie.com/embed/${videoId}" title="Equipment Video" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
    </div>`;
  }

  // 2. Google Drive preview links
  const gdriveMatch = clean.match(/drive\.google\.com\/file\/d\/([^\/]+)/i);
  if(gdriveMatch && gdriveMatch[1]){
    const fileId = gdriveMatch[1];
    return `<div style="position:relative;width:100%;padding-bottom:56.25%;height:0;margin-top:6px;border-radius:8px;overflow:hidden;border:1px solid var(--grid);">
      <iframe src="https://drive.google.com/file/d/${fileId}/preview" title="Equipment Video Preview" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="autoplay" allowfullscreen></iframe>
    </div>`;
  }

  // 3. Direct video files (.mp4, .webm, .ogg)
  const isDirect = /\.(mp4|webm|ogg)(\?.*)?$/i.test(clean);
  if(isDirect){
    return `<video controls preload="metadata" style="width:100%;max-width:480px;border-radius:8px;border:1px solid var(--grid);margin-top:6px;display:block;">
      <source src="${esc(clean)}" type="video/mp4">
      Your browser can't play this video inline. <a href="${esc(clean)}" target="_blank" rel="noopener">Open it directly</a>.
    </video>`;
  }

  return `<a class="btn btn-sm" href="${esc(clean)}" target="_blank" rel="noopener" style="margin-top:6px;display:inline-block;">▶ Watch video link</a>`;
}

function hoursBetween(a,b){ return Math.max(0, (b-a)/3600000); }
function renderQR(elId, text, size){
  const el = document.getElementById(elId);
  if(!el) return;
  el.innerHTML = '';
  if(typeof QRCode === 'undefined'){ el.innerHTML = `<span class="mono" style="font-size:10px;color:var(--ink-soft);">QR lib unavailable</span>`; return; }
  try{ new QRCode(el, { text, width:size, height:size, colorDark:'#16324F', colorLight:'#ffffff', correctLevel: QRCode.CorrectLevel.M }); }
  catch(e){ console.error('QR render failed', e); }
}

/* ============ Global state ============ */
let profileName = null;
let profileRole = 'student'; // 'student' | 'incharge' | 'owner'
let currentTab = 'home';
let tagCounter = 1;

const KEYS = {
  equipment:'lab:equipment',
  checkouts:'lab:checkouts',
  maintenance:'lab:maintenance',
  tagCounter:'lab:tagCounter',
  notices:'lab:notices'
};

function buildNav(){
  const nav = [
    {group:'Home',     items:[{id:'home',     label:'Home Screen',       icon:'&#8962;'}]},
    {group:'Updates',  items:[{id:'notices',  label:'Notices & Updates', icon:'&#128276;'}]},
    {group:'Overview', items:[{id:'dashboard',label:'Dashboard',         icon:'&#9635;'}]},
    {group:'Inventory', items:[
      {id:'inventory', label:'Equipment', icon:'&#9881;'},
      {id:'scan',      label:'Scan QR',   icon:'&#128247;'},
    ]},
    {group:'Activity', items:[
      {id:'checkout', label:'Checkout / Return', icon:'&#8646;'},
      {id:'usage',    label:'Usage Log',         icon:'&#128203;'},
    ]},
    {group:'Upkeep', items:[{id:'maintenance', label:'Maintenance', icon:'&#128295;'}]},
  ];
  if(profileRole==='incharge' || profileRole==='owner'){
    nav.push({group:'Management', items:[{id:'users', label:'Manage Users & Approvals', icon:'&#128100;'}]});
  }
  return nav;
}

/* ============ Theme & Mobile Drawer Events ============ */
function initThemeAndNav(){
  const savedTheme = localStorage.getItem('labtrack_theme') || 'light';
  applyTheme(savedTheme);

  const themeBtn = document.getElementById('themeToggleBtn');
  if(themeBtn){
    themeBtn.onclick = ()=>{
      const current = document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem('labtrack_theme', next);
      themeBtn.classList.add('theme-icon-rotating');
      setTimeout(()=> themeBtn.classList.remove('theme-icon-rotating'), 500);
    };
  }

  const burgerBtn = document.getElementById('hamburgerToggle');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  if(burgerBtn && sidebar){
    burgerBtn.onclick = (e)=>{
      e.stopPropagation();
      if(window.innerWidth <= 768){
        sidebar.classList.toggle('sidebar-open');
        if(backdrop) backdrop.classList.toggle('active');
      } else {
        sidebar.classList.toggle('sidebar-collapsed');
      }
    };
  }

  if(backdrop){
    backdrop.onclick = ()=>{
      if(sidebar) sidebar.classList.remove('sidebar-open');
      backdrop.classList.remove('active');
    };
  }
}

function applyTheme(theme){
  document.body.setAttribute('data-theme', theme);
  const moonIcon = document.querySelector('.theme-icon-moon');
  const sunIcon = document.querySelector('.theme-icon-sun');
  if(moonIcon && sunIcon){
    if(theme === 'dark'){
      moonIcon.style.display = 'none';
      sunIcon.style.display = 'block';
    } else {
      moonIcon.style.display = 'block';
      sunIcon.style.display = 'none';
    }
  }
}

function bindPasswordToggles(card){
  card.querySelectorAll('.toggle-password-btn').forEach(btn=>{
    btn.onclick = ()=>{
      const wrap = btn.closest('.password-input-wrap');
      if(!wrap) return;
      const inp = wrap.querySelector('input');
      const openIcon = btn.querySelector('.eye-open');
      const closedIcon = btn.querySelector('.eye-closed');
      if(inp.type === 'password'){
        inp.type = 'text';
        if(openIcon) openIcon.style.display = 'none';
        if(closedIcon) closedIcon.style.display = 'block';
      } else {
        inp.type = 'password';
        if(openIcon) openIcon.style.display = 'block';
        if(closedIcon) closedIcon.style.display = 'none';
      }
    };
  });
}

/* ============ Boot ============ */
async function boot(){
  initThemeAndNav();
  if(!authToken){ renderAuthScreen('login'); return; }
  try{
    const res = await apiFetch('/api/auth/me');
    if(!res.ok) throw new Error('not authed');
    const data = await res.json();
    currentUser = data.user;
    
    const localApprovals = JSON.parse(localStorage.getItem('labtrack_approved_users') || '{}');
    if(localApprovals[currentUser.id]){
       currentUser.status = 'approved';
    }

    if(currentUser.status && currentUser.status !== 'approved' && currentUser.role !== 'owner'){
      doLogout(false);
      renderAuthScreen('login', 'Your account is pending approval by your Lab In-Charge or Owner.');
      return;
    }

    profileName = currentUser.fullName;
    profileRole = currentUser.role;
  }catch(e){
    doLogout(false);
    return;
  }
  document.getElementById('authOverlay').style.display = 'none';
  tagCounter = parseInt(await storageGet(KEYS.tagCounter, true)) || 1;
  renderProfileBox();
  renderSidebar();
  await switchTab('home');
}

function doLogout(redraw=true){
  authToken = null; currentUser = null; profileName = null; profileRole = 'student';
  localStorage.removeItem(AUTH_KEY);
  if(redraw) renderAuthScreen('login');
  else { document.getElementById('authOverlay').style.display='flex'; renderAuthScreen('login'); }
}

function renderProfileBox(){
  const box = document.getElementById('profileBox');
  const roleLabel = profileRole==='owner' ? 'Owner' : profileRole==='incharge' ? 'Lab In-Charge' : 'Student';
  box.innerHTML = `
    <div class="profile-pill">
      <span class="dot"></span><span>${esc(profileName)}</span>
      <span class="badge ${profileRole==='owner'?'badge-rust':profileRole==='incharge'?'badge-warn':'badge-neutral'}">${roleLabel}</span>
      <span class="tag-id" style="color:#9FB6C7;">${esc(currentUser.collegeCode)}</span>
      <button id="logoutBtn">log out</button>
    </div>`;
  document.getElementById('logoutBtn').onclick = ()=> doLogout(true);
}

/* ============ Auth screens (login / register) ============ */
function renderAuthScreen(mode, errorMsg){
  document.getElementById('authOverlay').style.display = 'flex';
  initThemeAndNav();
  const card = document.getElementById('authCard');

  if(mode==='login'){
    card.innerHTML = `
      <h2>Sign in to LabTrack</h2>
      <p class="sub">Your college code routes you to your college's own equipment and records.</p>
      ${errorMsg ? `<div class="err">${esc(errorMsg)}</div>` : ''}

      <div class="form-group">
        <label for="loCollegeCode">College code</label>
        <input id="loCollegeCode" placeholder="e.g. GECX2026" autocomplete="organization" />
        <small class="form-help-text">Matches your institution's registration key</small>
      </div>

      <div class="form-group">
        <label for="loUsername">Username or email</label>
        <input id="loUsername" placeholder="Enter username or email" autocomplete="username" />
        <small class="form-help-text">Institutional email or assigned username</small>
      </div>

      <div class="form-group">
        <label for="loPassword">Password</label>
        <div class="password-input-wrap">
          <input id="loPassword" type="password" placeholder="Enter password" autocomplete="current-password" />
          <button type="button" class="toggle-password-btn" title="Toggle password visibility" aria-label="Toggle password visibility">
            <svg class="eye-open" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <svg class="eye-closed" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
              <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
          </button>
        </div>
        <small class="form-help-text">Min. 6 characters</small>
      </div>

      <button class="btn btn-primary" id="loSubmit" style="width:100%;margin-top:8px;">Sign in</button>

      <div class="security-note-card">
        <div class="sec-shield">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            <path d="M9 12l2 2 4-4"></path>
          </svg>
        </div>
        <div class="sec-body">
          <strong>Protected Institution &amp; Identity Vault</strong>
          Equipment data and student identities are encrypted and logically isolated per college code.
        </div>
      </div>

      <div class="auth-card-footer">
        <div class="auth-cta-box">
          <span class="cta-text">New to LabTrack?</span>
          <button class="btn btn-cta" id="toRegister">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <line x1="20" y1="8" x2="20" y2="14"></line>
              <line x1="23" y1="11" x2="17" y2="11"></line>
            </svg>
            Create an Account
          </button>
        </div>
      </div>
    `;

    bindPasswordToggles(card);
    document.getElementById('toRegister').onclick = ()=> renderAuthScreen('register');

    const submit = async ()=>{
      const collegeCode = document.getElementById('loCollegeCode').value.trim();
      const username = document.getElementById('loUsername').value.trim();
      const password = document.getElementById('loPassword').value;
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
           const localApprovals = JSON.parse(localStorage.getItem('labtrack_approved_users') || '{}');
           const isLocallyApproved = localApprovals[user.id];
           
           if(user.status !== 'approved' && !isLocallyApproved) {
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

    document.getElementById('loSubmit').onclick = submit;
    card.querySelectorAll('input').forEach(inp=> inp.addEventListener('keydown', e=>{ if(e.key==='Enter') submit(); }));
  } else {
    card.innerHTML = `
      <h2>Create your account</h2>
      <p class="sub">Everyone signs up as a Student. Your Lab In-Charge or Owner can upgrade your role afterward.</p>
      ${errorMsg ? `<div class="err">${esc(errorMsg)}</div>` : ''}

      <div class="form-row">
        <div class="form-group">
          <label for="reName">Full name</label>
          <input id="reName" placeholder="e.g. Aditi Sharma" />
          <small class="form-help-text">As registered in college records</small>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="reCollege">College name</label>
          <input id="reCollege" placeholder="e.g. Government Engineering College" />
        </div>
        <div class="form-group">
          <label for="reDept">Department</label>
          <input id="reDept" placeholder="e.g. CSE, ECE, Physics" />
        </div>
      </div>

      <div class="form-group">
        <label for="reCollegeCode">College code</label>
        <input id="reCollegeCode" placeholder="Ask your lab in-charge for code" />
        <small class="form-help-text">Provided by your Department Head or Lab Manager</small>
      </div>

      <div class="form-group">
        <label for="reUsername">Username</label>
        <input id="reUsername" placeholder="e.g. aditi_07" />
      </div>

      <div class="form-group">
        <label for="reEmail">College Email Address</label>
        <input id="reEmail" type="email" placeholder="e.g. aditi@college.edu" />
      </div>

      <div class="form-group">
        <label for="rePassword">Password</label>
        <div class="password-input-wrap">
          <input id="rePassword" type="password" placeholder="Create password (min 6 chars)" />
          <button type="button" class="toggle-password-btn" title="Toggle password visibility" aria-label="Toggle password visibility">
            <svg class="eye-open" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <svg class="eye-closed" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
              <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
          </button>
        </div>
        <small id="pwdValNote" class="form-help-text">At least 6 characters required</small>
      </div>

      <button class="btn btn-primary" id="reSubmit" style="width:100%;margin-top:8px;">Create account</button>

      <div class="security-note-card">
        <div class="sec-shield">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            <path d="M9 12l2 2 4-4"></path>
          </svg>
        </div>
        <div class="sec-body">
          <strong>Privacy &amp; Multi-Tenant Security</strong>
          Accounts require verification by your Lab In-Charge or Owner before full asset access.
        </div>
      </div>

      <div class="auth-card-footer">
        <div class="auth-cta-box">
          <span class="cta-text">Already registered?</span>
          <button class="btn btn-cta-outline" id="toLogin">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
              <polyline points="10 17 15 12 10 7"></polyline>
              <line x1="15" y1="12" x2="3" y2="12"></line>
            </svg>
            Sign In
          </button>
        </div>
      </div>
    `;

    bindPasswordToggles(card);
    const pwdInp = document.getElementById('rePassword');
    const pwdNote = document.getElementById('pwdValNote');
    if(pwdInp && pwdNote){
      pwdInp.oninput = ()=>{
        if(pwdInp.value.length >= 6){
          pwdNote.textContent = '✓ Strong password length';
          pwdNote.style.color = 'var(--teal)';
        } else {
          pwdNote.textContent = 'At least 6 characters required';
          pwdNote.style.color = 'var(--ink-soft)';
        }
      };
    }

    document.getElementById('toLogin').onclick = ()=> renderAuthScreen('login');
    document.getElementById('reSubmit').onclick = async ()=>{
      const fullName = document.getElementById('reName').value.trim();
      const username = document.getElementById('reUsername').value.trim();
      const collegeEmail = document.getElementById('reEmail').value.trim();
      const collegeName = document.getElementById('reCollege').value.trim();
      const department = document.getElementById('reDept').value.trim();
      const collegeCode = document.getElementById('reCollegeCode').value.trim();
      const password = document.getElementById('rePassword').value;

      if(!fullName || !username || !collegeEmail || !collegeName || !department || !collegeCode || !password){
        renderAuthScreen('register', 'All fields are required.'); 
        return;
      }
      if(!collegeEmail.includes('@')){
        renderAuthScreen('register', 'Enter a valid college email address.'); 
        return;
      }
      if(password.length < 6){ 
        renderAuthScreen('register', 'Password must be at least 6 characters.'); 
        return; 
      }
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
        document.getElementById('backToLogin').onclick = ()=> renderAuthScreen('login');
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

/* Toast notifications */
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
  toast.style.cssText = `background:${c.bg};color:${c.fg};padding:10px 14px;border-radius:6px;font-size:13px;font-family:'IBM Plex Sans',sans-serif;box-shadow:0 6px 16px rgba(0,0,0,0.25);`;
  toast.textContent = msg;
  host.appendChild(toast);
  setTimeout(()=>{ toast.style.transition='opacity .3s'; toast.style.opacity='0'; setTimeout(()=>toast.remove(), 300); }, 3800);
}

function renderSidebar(){
  const sb = document.getElementById('sidebar');
  sb.innerHTML = `
    <div class="sidebar-header-row" style="display:flex;justify-content:space-between;align-items:center;padding:0 4px 12px 4px;margin-bottom:8px;border-bottom:1px solid var(--grid);">
      <span class="mono" style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--ink-soft);text-transform:uppercase;">Navigation</span>
      <button id="closeSidebarBtn" class="icon-btn" style="width:28px;height:28px;border:none;background:rgba(0,0,0,0.06);color:var(--ink-soft);" title="Close navigation menu" aria-label="Close navigation menu">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  ` + buildNav().map(g=>`
    <div class="nav-label-group">${g.group}</div>
    ${g.items.map(it=>`<div class="nav-item ${currentTab===it.id?'active':''}" data-tab="${it.id}"><span class="ic">${it.icon}</span><span>${it.label}</span></div>`).join('')}
  `).join('');

  sb.querySelectorAll('.nav-item').forEach(el=> el.onclick = ()=>switchTab(el.dataset.tab));

  const closeBtn = document.getElementById('closeSidebarBtn');
  if(closeBtn){
    closeBtn.onclick = (e)=>{
      e.stopPropagation();
      if(window.innerWidth <= 768){
        sb.classList.remove('sidebar-open');
        const backdrop = document.getElementById('sidebarBackdrop');
        if(backdrop) backdrop.classList.remove('active');
      } else {
        sb.classList.add('sidebar-collapsed');
      }
    };
  }
}

async function switchTab(tab){
  if(tab!=='scan') stopCamera();
  currentTab = tab;

  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if(sidebar && window.innerWidth <= 768) sidebar.classList.remove('sidebar-open');
  if(backdrop) backdrop.classList.remove('active');

  renderSidebar();
  const main = document.getElementById('main');
  main.innerHTML = `<div class="loading-note">Loading ${tab}…</div>`;
  const renderers = {
    home:renderHome,
    notices:renderNotices,
    dashboard:renderDashboard,
    inventory:renderInventory,
    checkout:renderCheckout,
    usage:renderUsage,
    maintenance:renderMaintenance,
    scan:renderScan,
    users:renderUsers
  };
  if(renderers[tab]) await renderers[tab]();
}

async function nextTag(){ tagCounter += 1; await storageSet(KEYS.tagCounter, String(tagCounter), true); return 'LAB-EQ-'+String(tagCounter).padStart(4,'0'); }

/* ============ HOME SCREEN ============ */
async function renderHome(){
  const [equipment, checkouts, maintenance] = await Promise.all([
    loadList(KEYS.equipment, true), loadList(KEYS.checkouts, true), loadList(KEYS.maintenance, true)
  ]);
  const now = Date.now();
  const active = checkouts.filter(c=>c.status==='Active').length;
  const overdue = checkouts.filter(c=>c.status==='Active' && c.dueTime && c.dueTime < now).length;
  const openMaint = maintenance.filter(m=>m.status==='Open').length;
  const totalEq = equipment.length;
  const greeting = ()=>{
    const h = new Date().getHours();
    if(h < 12) return 'Good morning';
    if(h < 17) return 'Good afternoon';
    return 'Good evening';
  };
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="module-head" style="margin-bottom:28px;">
      <h2>${greeting()}, ${esc(profileName ? profileName.split(' ')[0] : 'there')} 👋</h2>
      <p>Here's what's happening in the lab right now.</p>
    </div>
    <div class="grid grid-3" style="margin-bottom:24px;">
      <div class="card stat-card ok" style="cursor:pointer;" onclick="switchTab('inventory')">
        <div class="num">${totalEq}</div>
        <div class="lbl">Equipment types tracked</div>
      </div>
      <div class="card stat-card ${active>0?'warn':''}" style="cursor:pointer;" onclick="switchTab('checkout')">
        <div class="num">${active}</div>
        <div class="lbl">Items checked out</div>
      </div>
      <div class="card stat-card ${overdue>0?'alert':''}" style="cursor:pointer;" onclick="switchTab('checkout')">
        <div class="num">${overdue}</div>
        <div class="lbl">Overdue returns</div>
      </div>
    </div>
    <div class="grid grid-2" style="align-items:start;">
      <div class="panel">
        <h3>Quick actions</h3>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button class="btn btn-primary" onclick="switchTab('checkout')" style="justify-content:flex-start;gap:12px;">
            &#8646; Checkout / Return equipment
          </button>
          <button class="btn" onclick="switchTab('inventory')" style="justify-content:flex-start;gap:12px;">
            &#9881; Browse equipment inventory
          </button>
          <button class="btn" onclick="switchTab('scan')" style="justify-content:flex-start;gap:12px;">
            &#128247; Scan a QR tag
          </button>
          <button class="btn" onclick="switchTab('notices')" style="justify-content:flex-start;gap:12px;">
            &#128276; View notices &amp; updates
          </button>
        </div>
      </div>
      <div class="panel">
        <h3>Lab health</h3>
        ${openMaint > 0
          ? `<div style="margin-bottom:12px;"><span class="badge badge-warn">${openMaint} open maintenance report${openMaint===1?'':'s'}</span><br/><span style="font-size:12.5px;color:var(--ink-soft);margin-top:4px;display:block;">Some equipment may be unavailable.</span></div>`
          : `<div style="margin-bottom:12px;"><span class="badge badge-ok">All equipment healthy</span><br/><span style="font-size:12.5px;color:var(--ink-soft);margin-top:4px;display:block;">No open maintenance reports.</span></div>`}
        ${overdue > 0
          ? `<div><span class="badge badge-rust">${overdue} overdue return${overdue===1?'':'s'}</span><br/><span style="font-size:12.5px;color:var(--ink-soft);margin-top:4px;display:block;">Follow up with borrowers.</span></div>`
          : `<div><span class="badge badge-ok">No overdue returns</span></div>`}
      </div>
    </div>
  `;
}

/* ============ NOTICES & UPDATES ============ */
async function renderNotices(){
  const isIncharge = profileRole==='incharge' || profileRole==='owner';
  let notices = await loadList(KEYS.notices, true);
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="module-head">
      <h2>Notices &amp; Updates</h2>
      <p>Lab announcements, maintenance alerts, and important notices for all users.</p>
    </div>
    ${isIncharge ? `
    <div class="panel" style="margin-bottom:20px;">
      <h3>Post a new notice</h3>
      <div class="form-group" style="margin-bottom:12px;">
        <label>Title</label>
        <input id="ntTitle" placeholder="e.g. Lab closed on Friday" />
      </div>
      <div class="form-group" style="margin-bottom:12px;">
        <label>Message</label>
        <textarea id="ntBody" placeholder="Write the notice content here…" style="min-height:90px;"></textarea>
      </div>
      <div style="display:flex;gap:10px;align-items:center;">
        <select id="ntType" style="padding:9px 13px;border:1px solid var(--grid);border-radius:9px;background:var(--input-bg);color:var(--ink);font-size:13.5px;">
          <option value="info">ℹ️ Info</option>
          <option value="warn">⚠️ Warning</option>
          <option value="alert">🔴 Alert</option>
          <option value="ok">✅ Update</option>
        </select>
        <button class="btn btn-primary" id="ntSubmit">Post notice</button>
      </div>
    </div>
    ` : ''}
    <div id="ntList"></div>
  `;
  if(isIncharge){
    document.getElementById('ntSubmit').onclick = async ()=>{
      const title = document.getElementById('ntTitle').value.trim();
      const body  = document.getElementById('ntBody').value.trim();
      const type  = document.getElementById('ntType').value;
      if(!title || !body){ showToast('Fill in title and message.','warn'); return; }
      notices.unshift({ id:uid(), title, body, type, postedBy:profileName, timestamp:Date.now() });
      const ok = await saveList(KEYS.notices, notices, true);
      if(!ok){ showToast('Could not save notice.','error'); return; }
      showToast('Notice posted.','ok');
      renderNotices();
    };
  }
  const list = document.getElementById('ntList');
  if(!notices.length){
    list.innerHTML = `<div class="empty">No notices posted yet. Check back later.</div>`;
    return;
  }
  const typeIcon = {info:'ℹ️', warn:'⚠️', alert:'🔴', ok:'✅'};
  const typeBadge = {info:'badge-neutral', warn:'badge-warn', alert:'badge-rust', ok:'badge-ok'};
  list.innerHTML = notices.map(n=>`
    <div class="card" style="margin-bottom:14px;padding:18px 22px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:20px;">${typeIcon[n.type]||'ℹ️'}</span>
          <strong style="font-size:15px;">${esc(n.title)}</strong>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <span class="badge ${typeBadge[n.type]||'badge-neutral'}">${n.type||'info'}</span>
          ${isIncharge ? `<button class="btn btn-sm" style="color:var(--rust);border-color:var(--rust-soft);" data-delete-notice="${n.id}">Remove</button>` : ''}
        </div>
      </div>
      <p style="margin:0 0 8px;font-size:13.5px;line-height:1.6;color:var(--ink);">${esc(n.body)}</p>
      <span style="font-size:11.5px;color:var(--ink-soft);">Posted by ${esc(n.postedBy)} · ${fmtTime(n.timestamp)}</span>
    </div>
  `).join('');
  if(isIncharge){
    list.querySelectorAll('[data-delete-notice]').forEach(b=> b.onclick = async ()=>{
      notices = notices.filter(n=>n.id!==b.dataset.deleteNotice);
      await saveList(KEYS.notices, notices, true);
      showToast('Notice removed.','ok');
      renderNotices();
    });
  }
}

/* ============ DASHBOARD ============ */
async function renderDashboard(){
  const [equipment, checkouts, maintenance] = await Promise.all([
    loadList(KEYS.equipment, true), loadList(KEYS.checkouts, true), loadList(KEYS.maintenance, true)
  ]);
  const now = Date.now();
  const totalUnits = equipment.reduce((s,e)=>s+e.totalQty,0);
  const availableUnits = equipment.reduce((s,e)=>s+e.availableQty,0);
  const activeCheckouts = checkouts.filter(c=>c.status==='Active');
  const overdue = activeCheckouts.filter(c=> c.dueTime && c.dueTime < now);
  const underMaint = equipment.filter(e=>e.condition!=='Good').length;
  const openMaint = maintenance.filter(m=>m.status==='Open').length;

  const usageCount = {};
  checkouts.forEach(c=>{ usageCount[c.equipmentName] = (usageCount[c.equipmentName]||0)+1; });
  const topUsed = Object.entries(usageCount).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxUse = topUsed.length ? topUsed[0][1] : 1;

  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="module-head">
      <h2>Dashboard</h2>
      <p>Live status of every tracked item in the lab.</p>
    </div>
    <div class="grid grid-5" style="margin-bottom:20px;">
      <div class="card stat-card"><div class="num">${equipment.length}</div><div class="lbl">Equipment types</div></div>
      <div class="card stat-card ok"><div class="num">${availableUnits}/${totalUnits}</div><div class="lbl">Units available</div></div>
      <div class="card stat-card"><div class="num">${activeCheckouts.length}</div><div class="lbl">Checked out now</div></div>
      <div class="card stat-card ${overdue.length?'alert':''}"><div class="num">${overdue.length}</div><div class="lbl">Overdue returns</div></div>
      <div class="card stat-card ${underMaint?'warn':''}"><div class="num">${underMaint}</div><div class="lbl">Under maintenance</div></div>
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
  const [equipment, checkouts] = await Promise.all([
    loadList(KEYS.equipment, true), loadList(KEYS.checkouts, true)
  ]);
  const main = document.getElementById('main');
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
          <div class="form-group"><label>Complete description</label><textarea id="eqDescription" placeholder="Model number, specs, manufacturer…"></textarea></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>How to use</label><textarea id="eqUsage" placeholder="Setup steps, safety notes…"></textarea></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Video link (optional)</label><input id="eqVideo" type="url" placeholder="YouTube, Google Drive, or .mp4 link" /></div>
        </div>
        <button class="btn btn-primary" id="eqSubmit">Add equipment</button>
      ` : `
        <p style="margin:0 0 10px;">You're signed in as <strong>${profileName ? esc(profileName) : 'a guest'}</strong>. Only Lab In-Charge accounts can register new equipment.</p>
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
    document.getElementById('eqSubmit').onclick = async ()=>{
      if(!requireIncharge()) return;
      const nameInput = document.getElementById('eqName');
      const name = nameInput.value.trim();
      if(!name){ showToast('Equipment name is required.', 'warn'); nameInput.focus(); return; }
      const qty = Math.max(1, parseInt(document.getElementById('eqQty').value) || 1);
      const priceVal = document.getElementById('eqPrice').value;
      const tag = await nextTag();
      equipment.unshift({
        id: uid(), tag, name, category: document.getElementById('eqCategory').value.trim()||'General',
        location: document.getElementById('eqLocation').value.trim()||'Unassigned',
        price: priceVal ? parseFloat(priceVal) : null,
        description: document.getElementById('eqDescription').value.trim(),
        usageNotes: document.getElementById('eqUsage').value.trim(),
        videoUrl: document.getElementById('eqVideo').value.trim(),
        totalQty: qty, availableQty: qty, condition:'Good', addedBy: profileName, timestamp: Date.now()
      });
      const ok = await saveList(KEYS.equipment, equipment, true);
      if(!ok){ showToast('Could not save — check your connection and try again.', 'error'); return; }
      showToast(`${name} added as ${tag}.`, 'ok');
      renderInventory();
    };
  }
  const catSel = document.getElementById('eqFilterCat');
  [...new Set(equipment.map(e=>e.category))].forEach(c=>{
    const o = document.createElement('option'); o.textContent=c; catSel.appendChild(o);
  });
  const confirmingRemove = new Set();
  const editingDetails = new Set();

  const drawList = ()=>{
    const q = document.getElementById('eqSearch').value.toLowerCase();
    const fc = document.getElementById('eqFilterCat').value;
    const fcond = document.getElementById('eqFilterCond').value;
    const filtered = equipment.filter(e=>
      (!fc || e.category===fc) && (!fcond || e.condition===fcond) &&
      (!q || (e.name+e.tag).toLowerCase().includes(q))
    );
    const list = document.getElementById('eqList');
    if(!filtered.length){ list.innerHTML = `<div class="empty">No equipment registered yet. Add the first item above.</div>`; return; }
    list.innerHTML = `<div class="grid grid-2">` + filtered.map(e=>{
      const condBadge = e.condition==='Good' ? 'badge-ok' : e.condition==='Damaged' ? 'badge-rust' : 'badge-warn';
      const confirming = confirmingRemove.has(e.id);
      const editing = editingDetails.has(e.id);
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
            <div class="qr-slot" id="qr-${e.id}" title="Scan to look up this item"></div>
          </div>
        </div>
        <div class="tag-body">
          <span class="badge badge-neutral">${esc(e.category)}</span>
          <span class="badge badge-neutral">${esc(e.location)}</span>
          <div style="margin-top:8px;">Available: <strong class="mono">${e.availableQty} / ${e.totalQty}</strong>${fmtPrice(e.price) ? ` · Price: <strong class="mono">${fmtPrice(e.price)}</strong>` : ''}</div>
          ${e.description ? `<div style="margin-top:6px;color:var(--ink-soft);">${esc(e.description.length>140 ? e.description.slice(0,140)+'…' : e.description)}</div>` : ''}
          ${e.videoUrl ? `<div style="margin-top:8px;"><span class="badge badge-ok">▶ Video attached</span>${videoEmbedHtml(e.videoUrl)}</div>` : ''}
          
          ${isIncharge ? (editing ? `
            <div style="margin-top:10px;border-top:1px solid var(--grid);padding-top:10px;">
              <div class="form-group" style="margin-bottom:8px;"><label>Price (₹)</label><input id="editPrice-${e.id}" type="number" min="0" step="0.01" value="${e.price ?? ''}" /></div>
              <div class="form-group" style="margin-bottom:8px;"><label>Description</label><textarea id="editDesc-${e.id}">${esc(e.description||'')}</textarea></div>
              <div class="form-group" style="margin-bottom:8px;"><label>Video link</label><input id="editVideo-${e.id}" type="url" value="${esc(e.videoUrl||'')}" /></div>
              <div style="display:flex;gap:8px;">
                <button class="btn btn-primary btn-sm" data-save-details="${e.id}">Save</button>
                <button class="btn btn-sm" data-cancel-edit="${e.id}">Cancel</button>
              </div>
            </div>
          ` : `
            <div style="margin-top:10px;display:flex;gap:8px;">
              <button class="btn btn-sm" data-edit-details="${e.id}">Edit details</button>
              ${confirming ? `
                <span style="font-size:12px;color:var(--rust);align-self:center;">Remove?</span>
                <button class="btn btn-sm" style="border-color:var(--rust);color:var(--rust);" data-confirm-remove="${e.id}">Confirm</button>
                <button class="btn btn-sm" data-cancel-remove="${e.id}">Cancel</button>
              ` : `<button class="btn btn-sm" data-remove="${e.id}">Remove</button>`}
            </div>
          `) : ''}
        </div>
      </div>`;
    }).join('') + `</div>`;
    filtered.forEach(e=> renderQR('qr-'+e.id, e.tag, 62));

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
      const priceVal = document.getElementById('editPrice-'+eqId).value;
      eq.price = priceVal ? parseFloat(priceVal) : null;
      eq.description = document.getElementById('editDesc-'+eqId).value.trim();
      eq.videoUrl = document.getElementById('editVideo-'+eqId).value.trim();
      const ok = await saveList(KEYS.equipment, equipment, true);
      if(!ok){ showToast('Could not save updates.', 'error'); return; }
      showToast('Equipment updated successfully.', 'ok');
      editingDetails.delete(eqId);
      drawList();
    });

    list.querySelectorAll('[data-remove]').forEach(b=> b.onclick = ()=>{
      confirmingRemove.add(b.dataset.remove);
      drawList();
    });
    list.querySelectorAll('[data-cancel-remove]').forEach(b=> b.onclick = ()=>{
      confirmingRemove.delete(b.dataset.cancelRemove);
      drawList();
    });
    list.querySelectorAll('[data-confirm-remove]').forEach(b=> b.onclick = async ()=>{
      if(!requireIncharge()) return;
      const eqId = b.dataset.confirmRemove;
      const eq = equipment.find(x=>x.id===eqId);
      const stillOut = checkouts.some(c=>c.equipmentId===eqId && c.status==='Active');
      if(stillOut){
        showToast('Item still has an active checkout.', 'warn');
        confirmingRemove.delete(eqId);
        drawList();
        return;
      }
      const idx = equipment.findIndex(x=>x.id===eqId);
      if(idx>-1) equipment.splice(idx,1);
      await saveList(KEYS.equipment, equipment, true);
      showToast('Equipment removed.', 'ok');
      confirmingRemove.delete(eqId);
      drawList();
    });
  };
  ['eqSearch','eqFilterCat','eqFilterCond'].forEach(id=> document.getElementById(id).addEventListener('input', drawList));
  drawList();
}

/* ============ CHECKOUT / RETURN ============ */
async function renderCheckout(){
  const [equipment, checkouts] = await Promise.all([loadList(KEYS.equipment,true), loadList(KEYS.checkouts,true)]);
  const main = document.getElementById('main');
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
      <button class="btn btn-primary" id="coSubmit">Check out</button>
      ${!available.length ? `<div class="empty" style="margin-top:12px;">Nothing is currently available to check out.</div>` : ''}
    </div>
    <div class="filter-row">
      <select id="coFilterStatus"><option value="">All statuses</option><option>Active</option><option>Returned</option></select>
    </div>
    <div id="coList"></div>
  `;
  document.getElementById('coSubmit').onclick = async ()=>{
    if(!requireProfile()) return;
    const eqId = document.getElementById('coEquip').value;
    if(!eqId) return;
    const eq = equipment.find(x=>x.id===eqId);
    const qty = Math.min(parseInt(document.getElementById('coQty').value)||1, eq.availableQty);
    const dueVal = document.getElementById('coDue').value;
    eq.availableQty -= qty;
    await saveList(KEYS.equipment, equipment, true);
    checkouts.unshift({
      id: uid(), equipmentId: eq.id, equipmentName: eq.name, equipmentTag: eq.tag, qty,
      borrower: profileName, purpose: document.getElementById('coPurpose').value.trim(),
      checkoutTime: Date.now(), dueTime: dueVal ? new Date(dueVal).getTime() : null,
      returnTime: null, status:'Active'
    });
    await saveList(KEYS.checkouts, checkouts, true);
    renderCheckout();
  };
  const list = document.getElementById('coList');
  const draw = ()=>{
    const fs = document.getElementById('coFilterStatus').value;
    const filtered = checkouts.filter(c=> !fs || c.status===fs);
    if(!filtered.length){ list.innerHTML = `<div class="empty">No checkout records yet.</div>`; return; }
    const now = Date.now();
    list.innerHTML = filtered.map(c=>{
      const isOverdue = c.status==='Active' && c.dueTime && c.dueTime < now;
      const canReturn = c.status==='Active' && (c.borrower===profileName || profileRole==='incharge');
      return `
      <div class="asset-tag">
        <span class="tick-tr"></span><span class="tick-br"></span>
        <div class="tag-row">
          <div>
            <div class="tag-id">${c.equipmentTag||''}</div>
            <div class="tag-title">${esc(c.equipmentName)} <span class="mono" style="font-weight:400;color:var(--ink-soft);">×${c.qty}</span></div>
          </div>
          <span class="badge ${c.status==='Returned'?'badge-ok':isOverdue?'badge-rust':'badge-warn'}">${isOverdue?'Overdue':c.status}</span>
        </div>
        <div class="tag-body">
          ${c.purpose? esc(c.purpose)+'<br/>':''}
          Borrower: <strong>${esc(c.borrower)}</strong> · Out: ${fmtTime(c.checkoutTime)}
          ${c.dueTime? ' · Due: '+fmtTime(c.dueTime):''}
          ${c.returnTime? ' · Returned: '+fmtTime(c.returnTime):''}
          ${canReturn? `<div style="margin-top:8px;"><button class="btn btn-sm" data-return="${c.id}">Mark returned</button></div>`:''}
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-return]').forEach(b=> b.onclick = async ()=>{
      const c = checkouts.find(x=>x.id==b.dataset.return);
      c.status='Returned'; c.returnTime=Date.now();
      const eq = equipment.find(x=>x.id===c.equipmentId);
      if(eq) eq.availableQty = Math.min(eq.totalQty, eq.availableQty + c.qty);
      await Promise.all([saveList(KEYS.checkouts, checkouts, true), saveList(KEYS.equipment, equipment, true)]);
      renderCheckout();
    });
  };
  document.getElementById('coFilterStatus').addEventListener('input', draw);
  draw();
}

/* ============ USAGE LOG ============ */
async function renderUsage(){
  const checkouts = await loadList(KEYS.checkouts, true);
  const main = document.getElementById('main');
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
  document.getElementById('mtSubmit').onclick = async ()=>{
    if(!requireProfile()) return;
    const eqId = document.getElementById('mtEquip').value;
    const issue = document.getElementById('mtIssue').value.trim();
    if(!eqId || !issue) return;
    const eq = equipment.find(x=>x.id===eqId);
    const severity = document.getElementById('mtSeverity').value;
    eq.condition = severity;
    if(eq.availableQty>0) eq.availableQty -= 1;
    await saveList(KEYS.equipment, equipment, true);
    maintenance.unshift({ id:uid(), equipmentId:eq.id, equipmentName:eq.name, equipmentTag:eq.tag, issue, severity, status:'Open', reportedBy:profileName, timestamp:Date.now(), resolvedBy:null, resolvedAt:null });
    await saveList(KEYS.maintenance, maintenance, true);
    renderMaintenance();
  };
  const list = document.getElementById('mtList');
  const draw = ()=>{
    const fs = document.getElementById('mtFilterStatus').value;
    const filtered = maintenance.filter(m=> !fs || m.status===fs);
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
          ${m.status==='Open' ? `<div style="margin-top:8px;"><button class="btn btn-sm" data-resolve="${m.id}">${profileRole==='incharge'?'Mark resolved':'Awaiting lab in-charge'}</button></div>` : ''}
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-resolve]').forEach(b=> b.onclick = async ()=>{
      if(!requireIncharge()) return;
      const m = maintenance.find(x=>x.id===b.dataset.resolve);
      m.status='Resolved'; m.resolvedBy=profileName; m.resolvedAt=Date.now();
      const eq = equipment.find(x=>x.id===m.equipmentId);
      if(eq){ eq.condition='Good'; eq.availableQty = Math.min(eq.totalQty, eq.availableQty+1); }
      await Promise.all([saveList(KEYS.maintenance, maintenance, true), saveList(KEYS.equipment, equipment, true)]);
      renderMaintenance();
    });
  };
  document.getElementById('mtFilterStatus').addEventListener('input', draw);
  draw();
}

/* ============ QR SCANNER ============ */
let scanStream = null;
let scanRAF = null;

function stopCamera(){
  if(scanRAF){ cancelAnimationFrame(scanRAF); scanRAF = null; }
  if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream = null; }
}

async function renderScan(){
  stopCamera();
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="module-head">
      <h2>Scan QR</h2>
      <p>Point a camera at an equipment tag, or type the tag code below, to pull up its full record.</p>
    </div>
    <div class="grid grid-2" style="align-items:start;">
      <div class="panel">
        <h3>Camera scan</h3>
        <div id="camWrap" style="position:relative;background:#0C1A26;border-radius:8px;overflow:hidden;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;">
          <video id="scanVideo" muted autoplay playsinline webkit-playsinline="true" style="width:100%;height:100%;object-fit:cover;display:none;"></video>
          <div id="camPlaceholder" style="color:#9FB6C7;font-size:13px;text-align:center;padding:20px;">Camera is off</div>
        </div>
        <canvas id="scanCanvas" style="display:none;"></canvas>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="btn btn-primary" id="camStart">Start camera</button>
          <button class="btn" id="camStop">Stop camera</button>
        </div>
        <div id="camStatus" style="margin-top:10px;font-size:12.5px;color:var(--ink-soft);"></div>
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
  `;

  document.getElementById('camStart').onclick = startCamera;
  document.getElementById('camStop').onclick = ()=>{
    stopCamera();
    resetCameraUI();
    const statusEl = document.getElementById('camStatus');
    if(statusEl) statusEl.textContent = 'Camera stopped.';
  };
  document.getElementById('manualLookup').onclick = ()=>{
    const v = document.getElementById('manualTag').value.trim();
    if(!v){ showToast('Type a tag code first.', 'warn'); return; }
    lookupAndShow(v);
  };
  document.getElementById('manualTag').addEventListener('keydown', e=>{
    if(e.key==='Enter') document.getElementById('manualLookup').click();
  });
}

function resetCameraUI(){
  const video = document.getElementById('scanVideo');
  const placeholder = document.getElementById('camPlaceholder');
  const startBtn = document.getElementById('camStart');
  if(video) video.style.display = 'none';
  if(placeholder) placeholder.style.display = 'flex';
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
    statusEl.textContent = 'This browser/context has no camera API available (camera also requires HTTPS or localhost) — use manual lookup instead.';
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
      const msg = (e2 && (e2.name==='NotAllowedError'))
        ? 'Camera permission was denied — allow camera access in your browser settings, or use manual lookup below.'
        : 'Camera could not be started, which is common inside embedded previews. Try opening this file directly in a browser tab, or use manual lookup below.';
      statusEl.textContent = msg;
      return;
    }
  }
  const video = document.getElementById('scanVideo');
  const placeholder = document.getElementById('camPlaceholder');
  const canvas = document.getElementById('scanCanvas');
  if(!video || !canvas){ stopCamera(); return; }
  video.srcObject = scanStream;
  video.style.display = 'block';
  placeholder.style.display = 'none';
  try{ await video.play(); }
  catch(e){ /* safe to ignore */ }
  statusEl.textContent = 'Scanning…';
  const ctx = canvas.getContext('2d', { willReadFrequently:true });
  let sized = false;
  const tick = ()=>{
    if(!scanStream) return;
    if(video.readyState === video.HAVE_ENOUGH_DATA){
      if(!sized){
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        sized = true;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if(code && code.data){
        statusEl.textContent = 'Match found: ' + code.data;
        stopCamera();
        resetCameraUI();
        lookupAndShow(code.data);
        return;
      }
    }
    scanRAF = requestAnimationFrame(tick);
  };
  scanRAF = requestAnimationFrame(tick);
}

async function lookupAndShow(tagOrId){
  const [equipment, checkouts, maintenance] = await Promise.all([
    loadList(KEYS.equipment, true), loadList(KEYS.checkouts, true), loadList(KEYS.maintenance, true)
  ]);
  const needle = tagOrId.trim().toLowerCase();
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
          <span class="badge ${condBadge}">${eq.condition}</span>
        </div>
        <div class="tag-body">
          <span class="badge badge-neutral">${esc(eq.category)}</span>
          <span class="badge badge-neutral">${esc(eq.location)}</span>
          <div style="margin-top:8px;">Available: <strong class="mono">${eq.availableQty} / ${eq.totalQty}</strong></div>
          <div style="margin-top:4px;color:var(--ink-soft);">Registered by ${esc(eq.addedBy)} · ${fmtDate(eq.timestamp)}</div>
        </div>
      </div>

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
  resultEl.querySelectorAll('[data-go]').forEach(b=> b.onclick = ()=> switchTab(b.dataset.go));
}

/* ============ MANAGE USERS & APPROVALS ============ */
async function renderUsers(){
  const main = document.getElementById('main');
  if(profileRole!=='owner' && profileRole!=='incharge'){
    main.innerHTML = `<div class="empty">This section is only available to Lab In-Charge and Owner accounts.</div>`;
    return;
  }
  main.innerHTML = `
    <div class="module-head">
      <h2>Manage Users &amp; Approvals</h2>
      <p>Every registered account, across every college code. Promote a Student to Lab In-Charge, or remove an account entirely.</p>
    </div>
    <div class="panel">
      <div id="usersBody"><div class="loading-note">Loading users…</div></div>
    </div>
  `;
  let users = [];
  try{
    const res = await apiFetch('/api/owner/users');
    if(!res.ok) throw new Error('failed');
    users = (await res.json()).users;
  }catch(e){
    document.getElementById('usersBody').innerHTML = `<div class="empty">Could not load users.</div>`;
    return;
  }
  const draw = ()=>{
    const body = document.getElementById('usersBody');
    if(!users.length){ body.innerHTML = `<div class="empty">No users registered yet.</div>`; return; }
    body.innerHTML = `
      <div class="user-row head">
        <div>Name</div><div>College</div><div>Dept</div><div>Code</div><div>Role</div><div></div>
      </div>
      ${users.map(u=>`
        <div class="user-row">
          <div>${esc(u.fullName)}<br/><span class="tag-id">${esc(u.username)}</span></div>
          <div>${esc(u.collegeName)}</div>
          <div>${esc(u.department)}</div>
          <div class="mono">${esc(u.collegeCode)}</div>
          <div>
            ${u.role==='owner'
              ? `<span class="badge badge-rust">Owner</span>`
              : `<select data-role="${u.id}">
                   <option value="student" ${u.role==='student'?'selected':''}>Student</option>
                   <option value="incharge" ${u.role==='incharge'?'selected':''}>Lab In-Charge</option>
                 </select>`}
          </div>
          <div>${u.role==='owner' ? '' : `<button class="btn btn-sm" style="color:var(--rust);" data-delete="${u.id}">Remove</button>`}</div>
        </div>
      `).join('')}
    `;
    body.querySelectorAll('[data-role]').forEach(sel=> sel.onchange = async ()=>{
      const res = await apiFetch(`/api/owner/users/${sel.dataset.role}`, {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ role: sel.value })
      });
      if(res.ok){ showToast('Role updated.', 'ok'); }
      else{ showToast('Could not update role.', 'error'); }
    });
    body.querySelectorAll('[data-delete]').forEach(b=> b.onclick = async ()=>{
      if(b.dataset.confirming!=='1'){
        b.dataset.confirming = '1';
        b.textContent = 'Confirm remove?';
        setTimeout(()=>{ if(b.dataset.confirming==='1'){ b.dataset.confirming='0'; b.textContent='Remove'; } }, 4000);
        return;
      }
      const res = await apiFetch(`/api/owner/users/${b.dataset.delete}`, { method:'DELETE' });
      if(res.ok){
        showToast('User removed.', 'ok');
        users = users.filter(u=>u.id!==b.dataset.delete);
        draw();
      } else {
        showToast('Could not remove user.', 'error');
      }
    });
  };
  draw();
}

boot();
