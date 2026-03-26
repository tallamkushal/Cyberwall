// CYBERWALL — Dashboard Logic

async function loadDashboard() {
  const user = await requireAuth();
  if (!user) return;
  const profile = await getCurrentProfile();
  if (!profile) {
    // Only redirect to onboarding if genuinely no profile — not on network failures
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return; // requireAuth already handles this
    const { data, error } = await supabaseClient.from('profiles').select('id').eq('id', session.user.id).single();
    if (!data && error?.code === 'PGRST116') {
      window.location.href = 'onboarding.html';
    }
    return;
  }

  document.getElementById('user-name').textContent     = profile.full_name || 'User';
  document.getElementById('user-plan').textContent     = capitalize(profile.plan || 'starter') + ' Plan';
  document.getElementById('user-domain').textContent   = profile.domain || 'Not configured';
  document.getElementById('user-initials').textContent = getInitials(profile.full_name);

  // Populate settings fields
  const setName    = document.getElementById('set-name');
  const setCompany = document.getElementById('set-company');
  const setDomain  = document.getElementById('set-domain');
  const setPhone   = document.getElementById('set-phone');
  const setEmail   = document.getElementById('set-email');
  if (setName)    setName.value    = profile.full_name || '';
  if (setCompany) setCompany.value = profile.company   || '';
  if (setDomain)  setDomain.value  = profile.domain    || '';
  if (setPhone)   setPhone.value   = profile.phone     || '';
  if (setEmail)   setEmail.value   = profile.email     || '';
  const planBadge = document.getElementById('plan-badge');
  if (planBadge) planBadge.textContent = capitalize(profile.plan || 'starter') + ' Plan';

  loadStats(profile);
  loadThreats();
  loadReports();
  loadCloudflareForProfile(profile);
}

function loadStats(profile) {
  document.getElementById('stat-blocked').textContent  = '—';
  document.getElementById('stat-uptime').textContent   = '—';
  document.getElementById('stat-response').textContent = '—';
  document.getElementById('stat-score').textContent    = '—';
}

function loadThreats() {
  // Real data loaded by loadCloudflareForProfile() — nothing to do here
}

function loadReports() {
  const list = document.getElementById('reports-list');
  if (!list) return;
  const reports = [
    {month:'February 2025', date:'Mar 1, 2025', size:'2.4 MB'},
    {month:'January 2025',  date:'Feb 1, 2025', size:'2.1 MB'},
    {month:'December 2024', date:'Jan 1, 2025', size:'1.9 MB'},
  ];
  list.innerHTML = reports.map(r => `
    <div class="report-row">
      <div class="report-icon">📄</div>
      <div>
        <div style="font-size:13px;font-weight:600">${r.month} Security Report</div>
        <div style="font-size:12px;color:var(--muted)">Generated ${r.date} · ${r.size}</div>
      </div>
      <span class="report-dl" style="color:var(--accent);font-weight:600;cursor:pointer;margin-left:auto">↓ PDF</span>
    </div>`).join('');
}

function showPanel(name, el, pushState = true) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  // highlight matching sidebar item by finding the one that calls showPanel with this name
  if (el) {
    el.classList.add('active');
  } else {
    const match = document.querySelector(`.sidebar-item[onclick*="'${name}'"]`);
    if (match) match.classList.add('active');
  }
  const titles = {overview:'Dashboard',threats:'Threats Log',reports:'Security Reports',ssl:'SSL Monitor',alerts:'Alerts',billing:'Billing',settings:'Settings',ai:'AI Assistant'};
  document.getElementById('topbar-title').textContent = titles[name] || name;
  if (pushState) history.pushState({ panel: name }, '', '#' + name);
}

window.addEventListener('popstate', function (e) {
  const panel = (e.state && e.state.panel) || 'overview';
  showPanel(panel, null, false);
});

function toggleSwitch(el) { el.classList.toggle('on'); }
async function handleLogout() { await logOut(); }
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function getInitials(name) { return name ? name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2) : 'U'; }

window.addEventListener('DOMContentLoaded', function () {
  // Seed initial history entry so the first back press stays on the dashboard
  const initial = location.hash.replace('#', '') || 'overview';
  history.replaceState({ panel: initial }, '', '#' + initial);
  loadDashboard();
});

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function editBusinessName() {
  const current = document.getElementById('user-biz').textContent;
  document.getElementById('biz-input').value = current === 'Not set' ? '' : current;
  openModal('modal-biz');
}

async function saveBizName() {
  const newName = document.getElementById('biz-input').value.trim();
  if (!newName) return;
  const session = await supabaseClient.auth.getSession();
  const userId = session?.data?.session?.user?.id;
  if (!userId) return;
  const { error } = await supabaseClient.from('profiles').update({ company: newName }).eq('id', userId);
  if (error) { showToast('Failed to update: ' + error.message, 'error'); return; }
  document.getElementById('user-biz').textContent = newName;
  closeModal('modal-biz');
}

function changePassword() {
  document.getElementById('pass-new').value = '';
  document.getElementById('pass-confirm').value = '';
  document.getElementById('pass-error').textContent = '';
  openModal('modal-pass');
}

async function savePassword() {
  const newPass = document.getElementById('pass-new').value;
  const confirm = document.getElementById('pass-confirm').value;
  const errEl = document.getElementById('pass-error');
  if (newPass.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
  if (newPass !== confirm) { errEl.textContent = 'Passwords do not match.'; return; }
  const { error } = await supabaseClient.auth.updateUser({ password: newPass });
  if (error) { errEl.textContent = 'Error: ' + error.message; return; }
  closeModal('modal-pass');
  showToast('Password updated successfully.', 'success');
}

// ---- LOAD CLOUDFLARE DATA ----
async function loadCloudflareForProfile(profile) {
  if (profile && profile.domain) {
    await loadCloudflareData(profile.domain);
  }
}

// ---- SAVE PROFILE SETTINGS ----
async function saveProfileSettings() {
  const name    = document.getElementById('set-name').value.trim();
  const company = document.getElementById('set-company').value.trim();
  const domain  = document.getElementById('set-domain').value.trim();
  const phone   = document.getElementById('set-phone').value.trim();
  const errEl   = document.getElementById('set-profile-error');
  const sucEl   = document.getElementById('set-profile-success');

  errEl.classList.add('hidden');
  sucEl.classList.add('hidden');

  if (!name || !company || !domain) {
    errEl.textContent = 'Name, business name and domain are required.';
    errEl.classList.remove('hidden');
    return;
  }

  const session = await supabaseClient.auth.getSession();
  const userId = session?.data?.session?.user?.id;
  if (!userId) return;

  const { error } = await supabaseClient.from('profiles').update({
    full_name: name, company, domain, phone
  }).eq('id', userId);

  if (error) {
    errEl.textContent = 'Failed to save: ' + error.message;
    errEl.classList.remove('hidden');
    return;
  }

  // Update topbar display
  document.getElementById('user-name').textContent   = name;
  document.getElementById('user-domain').textContent = domain;
  document.getElementById('user-initials').textContent = getInitials(name);

  sucEl.classList.remove('hidden');
  setTimeout(() => sucEl.classList.add('hidden'), 3000);
}

// ---- SAVE PASSWORD SETTINGS ----
async function savePasswordSettings() {
  const newPass = document.getElementById('set-pass').value;
  const confirm = document.getElementById('set-pass-confirm').value;
  const errEl   = document.getElementById('set-pass-error');
  const sucEl   = document.getElementById('set-pass-success');

  errEl.classList.add('hidden');
  sucEl.classList.add('hidden');

  if (newPass.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters.';
    errEl.classList.remove('hidden');
    return;
  }
  if (newPass !== confirm) {
    errEl.textContent = 'Passwords do not match.';
    errEl.classList.remove('hidden');
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({ password: newPass });
  if (error) {
    errEl.textContent = 'Error: ' + error.message;
    errEl.classList.remove('hidden');
    return;
  }

  document.getElementById('set-pass').value = '';
  document.getElementById('set-pass-confirm').value = '';
  sucEl.classList.remove('hidden');
  setTimeout(() => sucEl.classList.add('hidden'), 3000);
}
