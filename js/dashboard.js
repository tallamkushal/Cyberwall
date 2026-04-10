// CYBERWALL — Dashboard Logic

async function loadDashboard() {
  const user = await requireAuth();
  if (!user) return;
  let profile = await getCurrentProfile();
  if (!profile) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;
    const { data, error } = await supabaseClient.from('profiles').select('id').eq('id', session.user.id).single();
    if (!data && error?.code === 'PGRST116') {
      // No profile at all — create a minimal one so the user isn't stuck in a loop
      const SERVER = window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://cyberwall.onrender.com';
      const u = session.user;
      const res = await fetch(`${SERVER}/api/create-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: u.id,
          full_name: u.user_metadata?.full_name || u.email.split('@')[0],
          email: u.email,
          plan: 'starter',
          status: 'trial',
          role: 'client',
          created_at: new Date()
        })
      });
      const result = await res.json();
      if (result.success) {
        profile = await getCurrentProfile();
      } else {
        window.location.href = 'onboarding.html';
        return;
      }
    }
    if (!profile) return;
  }

  // Admins belong on the admin panel
  if (profile.role === 'admin') {
    window.location.replace('admin.html');
    return;
  }

  document.getElementById('user-name').textContent     = profile.full_name || 'User';
  document.getElementById('user-plan').textContent     = capitalize(profile.plan || 'starter') + ' Plan';
  document.getElementById('user-domain').textContent   = profile.domain || 'Not configured';
  document.getElementById('user-initials').textContent = getInitials(profile.full_name);

  // Show onboarding alert if domain not set
  if (!profile.domain) {
    const alert = document.getElementById('onboarding-alert');
    if (alert) alert.style.display = 'block';
  }

  // Populate settings fields
  const setName    = document.getElementById('set-name');
  const setCompany = document.getElementById('set-company');
  const setDomain  = document.getElementById('set-domain');
  const setPhone   = document.getElementById('set-phone');
  const setEmail   = document.getElementById('set-email');
  if (setName)    setName.value    = profile.full_name || '';
  if (setCompany) setCompany.value = profile.business_name   || '';
  if (setDomain)  setDomain.value  = profile.domain    || '';
  if (setPhone)   setPhone.value   = profile.phone     || '';
  if (setEmail)   setEmail.value   = profile.email     || '';
  const planBadge = document.getElementById('plan-badge');
  if (planBadge) planBadge.textContent = capitalize(profile.plan || 'starter') + ' Plan';

  // Show onboarding banner if the user hasn't connected a domain yet
  const banner = document.getElementById('onboarding-banner');
  if (banner && !profile.domain) banner.classList.remove('hidden');

  applyPlanGating(profile.plan || 'starter');
  loadStats(profile);
  loadThreats();
  loadReports();
  loadCloudflareForProfile(profile);
  loadCyberNews();
  loadMyTickets();
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
  document.querySelectorAll('.mobile-nav-item').forEach(i => i.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  // highlight matching sidebar item
  if (el && el.classList.contains('sidebar-item')) {
    el.classList.add('active');
  } else {
    const match = document.querySelector(`.sidebar-item[onclick*="'${name}'"]`);
    if (match) match.classList.add('active');
  }
  // highlight matching mobile nav item
  const mobileMatch = document.querySelector(`.mobile-nav-item[data-panel="${name}"]`);
  if (mobileMatch) mobileMatch.classList.add('active');
  const titles = {overview:'Dashboard',threats:'Threats Log',reports:'Security Reports',ssl:'Protection Status',alerts:'Alerts',billing:'Billing',settings:'Settings',ai:'AI Assistant',support:'Support','security-score':'My Security Grade'};
  if (name === 'security-score') loadSecurityScore();
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
  const { error } = await supabaseClient.from('profiles').update({ business_name: newName }).eq('id', userId);
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
  const phone   = document.getElementById('set-phone').value.trim();
  const errEl   = document.getElementById('set-profile-error');
  const sucEl   = document.getElementById('set-profile-success');

  errEl.classList.add('hidden');
  sucEl.classList.add('hidden');

  if (!name || !company) {
    errEl.textContent = 'Name and business name are required.';
    errEl.classList.remove('hidden');
    return;
  }

  const session = await supabaseClient.auth.getSession();
  const userId = session?.data?.session?.user?.id;
  if (!userId) return;

  const { error } = await supabaseClient.from('profiles').update({
    full_name: name, business_name: company, phone
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
  const currentPass = document.getElementById('set-pass-current').value;
  const newPass     = document.getElementById('set-pass').value;
  const confirm     = document.getElementById('set-pass-confirm').value;
  const errEl       = document.getElementById('set-pass-error');
  const sucEl       = document.getElementById('set-pass-success');

  errEl.classList.add('hidden');
  sucEl.classList.add('hidden');

  if (!currentPass) {
    errEl.textContent = 'Please enter your current password.';
    errEl.classList.remove('hidden');
    return;
  }
  if (newPass.length < 8) {
    errEl.textContent = 'New password must be at least 8 characters.';
    errEl.classList.remove('hidden');
    return;
  }
  if (newPass !== confirm) {
    errEl.textContent = 'New passwords do not match.';
    errEl.classList.remove('hidden');
    return;
  }
  if (currentPass === newPass) {
    errEl.textContent = 'New password must be different from current password.';
    errEl.classList.remove('hidden');
    return;
  }

  // Verify current password by re-authenticating
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const { error: signInError } = await supabaseClient.auth.signInWithPassword({
    email: session.user.email,
    password: currentPass
  });
  if (signInError) {
    errEl.textContent = 'Current password is incorrect.';
    errEl.classList.remove('hidden');
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({ password: newPass });
  if (error) {
    errEl.textContent = 'Failed to update password. Please try again.';
    errEl.classList.remove('hidden');
    return;
  }

  document.getElementById('set-pass-current').value = '';
  document.getElementById('set-pass').value = '';
  document.getElementById('set-pass-confirm').value = '';
  sucEl.classList.remove('hidden');
  setTimeout(() => sucEl.classList.add('hidden'), 3000);
}

// ---- CYBER NEWS ----
async function loadCyberNews() {
  const list = document.getElementById('cyber-news-list');
  if (!list) return;
  try {
    const SERVER = window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://cyberwall.onrender.com';
    const res = await fetch(`${SERVER}/api/cyber-news`);
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">No news available right now.</div>';
      return;
    }
    const severityColor = { critical: 'var(--red)', warning: 'var(--orange)', info: 'var(--accent)' };
    const severityLabel = { critical: 'Critical', warning: 'Warning', info: 'Info' };
    list.innerHTML = items.map(item => `
      <a href="${escapeAttr(item.link)}" target="_blank" rel="noopener" style="display:block;padding:11px 16px;border-bottom:1px solid var(--border);text-decoration:none;transition:background 0.15s" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:10px;font-weight:700;color:${severityColor[item.severity] || 'var(--accent)'};text-transform:uppercase;letter-spacing:0.5px">${severityLabel[item.severity] || 'Info'}</span>
          <span style="font-size:10px;color:var(--muted)">· ${escapeHtmlNews(item.source)} · ${newsTimeAgo(item.date)}</span>
        </div>
        <div style="font-size:12px;font-weight:600;color:var(--text);line-height:1.4">${escapeHtmlNews(item.title)}</div>
      </a>`).join('');
  } catch {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">Could not load news.</div>';
  }
}

function escapeHtmlNews(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(str) {
  if (!str) return '#';
  // Only allow http/https URLs
  return /^https?:\/\//.test(str) ? str.replace(/"/g, '%22') : '#';
}

function newsTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---- PLAN GATING ----
const PLAN_RANK = { starter: 1, pro: 2, business: 3 };

function applyPlanGating(plan) {
  const userRank = PLAN_RANK[plan] || 1;

  // Lock sidebar + mobile nav items the user can't access
  document.querySelectorAll('[data-requires]').forEach(item => {
    const required = item.getAttribute('data-requires');
    const requiredRank = PLAN_RANK[required] || 2;
    if (userRank < requiredRank) {
      item.classList.add('locked');
      item.setAttribute('onclick', `showUpgradePrompt('${required}')`);
      // Remove the notification badge on locked items so it's not misleading
      const notif = item.querySelector('.sidebar-notif');
      if (notif) notif.remove();
      // Add lock icon
      const lockSpan = document.createElement('span');
      lockSpan.className = 'lock-icon';
      lockSpan.textContent = '🔒';
      item.appendChild(lockSpan);
    }
  });

  // Limit threats log to 10 rows for Starter
  if (plan === 'starter') {
    const tbody = document.getElementById('threats-full-tbody');
    if (tbody) {
      const rows = Array.from(tbody.querySelectorAll('tr'));
      rows.forEach((row, i) => { if (i >= 10) row.remove(); });
      const hint = document.createElement('tr');
      hint.innerHTML = `<td colspan="7" style="text-align:center;padding:14px;color:var(--muted);font-size:13px;border-top:1px solid var(--border)">
        🔒 Showing last 10 threats. <a onclick="showUpgradePrompt('pro')" style="color:var(--accent);cursor:pointer;font-weight:600">Upgrade to Pro</a> for full history.
      </td>`;
      tbody.appendChild(hint);
    }
  }

  // Show AI model tier note
  if (plan === 'pro') {
    const aiSub = document.querySelector('#panel-ai .card-body > div > div:last-child');
    if (aiSub && aiSub.style.fontSize === '12px') {
      aiSub.textContent = 'Powered by Claude Haiku · Upgrade to Business for advanced AI (Claude Opus)';
    }
  }
}

function showUpgradePrompt(requiredPlan) {
  const info = {
    pro:      { name: 'Pro',      price: '₹4,999/mo' },
    business: { name: 'Business', price: '₹8,499/mo' },
  };
  const { name, price } = info[requiredPlan] || info.pro;
  document.getElementById('upgrade-modal-title').textContent = `Upgrade to ${name}`;
  document.getElementById('upgrade-modal-desc').textContent =
    `This feature is available on the ${name} plan (${price}). Contact us on WhatsApp to upgrade instantly.`;
  document.getElementById('modal-upgrade').style.display = 'flex';
}

// ---- SUPPORT TICKETS ----
const _SERVER = window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://cyberwall.onrender.com';

async function _getAuthHeaders() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
  return headers;
}

function _escapeHtml(str) {
  if (str == null) return '—';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function loadMyTickets() {
  const el = document.getElementById('my-tickets-list');
  if (!el) return;
  try {
    const res = await fetch(`${_SERVER}/api/tickets/mine`, { headers: await _getAuthHeaders() });
    const data = await res.json();
    renderMyTickets(data.tickets || []);
  } catch (err) {
    if (el) el.innerHTML = '<div style="color:var(--muted);font-size:13px">Could not load requests.</div>';
  }
}

function renderMyTickets(tickets) {
  const el = document.getElementById('my-tickets-list');
  const badge = document.getElementById('open-tickets-badge');
  if (!el) return;

  const open = tickets.filter(t => t.status === 'open').length;
  if (badge) { badge.textContent = open || ''; badge.style.display = open ? '' : 'none'; }

  if (!tickets.length) {
    el.innerHTML = '<div style="padding:16px 0;color:var(--muted);font-size:13px">No support requests yet.</div>';
    return;
  }
  el.innerHTML = tickets.map(t => {
    const isOpen = t.status === 'open';
    const statusBadge = isOpen
      ? '<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:#fee2e2;color:#dc2626;font-weight:600">Open</span>'
      : '<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:#dcfce7;color:#16a34a;font-weight:600">Resolved</span>';
    return `
      <div style="padding:13px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <div style="font-size:13px;font-weight:600">${_escapeHtml(t.subject)}</div>
          ${statusBadge}
        </div>
        <div style="font-size:13px;color:var(--muted);line-height:1.5">${_escapeHtml(t.message)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">${_formatDate(t.created_at)}</div>
      </div>`;
  }).join('');
}

// ── SECURITY SCORE ────────────────────────────────────────────────────────────
let _currentScanDomain = null;

async function loadSecurityScore() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const profile = await getCurrentProfile();
  const domain = profile?.domain;

  if (!domain) { _renderScoreEmpty(); return; }

  _currentScanDomain = domain;
  _renderScoreLoading(domain);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (session?.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
    const res = await fetch(`${_SERVER}/api/security-scan?domain=${encodeURIComponent(domain)}`, { headers });
    const data = await res.json();
    if (data.error) { _renderScoreError(data.error); return; }
    _renderSecurityScore(data);
  } catch(e) { _renderScoreError('Scan failed. Please try again.'); }
}

async function rerunSecurityScan() {
  if (!_currentScanDomain) { loadSecurityScore(); return; }
  const { data: { session } } = await supabaseClient.auth.getSession();
  _renderScoreLoading(_currentScanDomain);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (session?.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
    const res = await fetch(`${_SERVER}/api/security-scan?domain=${encodeURIComponent(_currentScanDomain)}&t=${Date.now()}`, { headers });
    const data = await res.json();
    if (data.error) { _renderScoreError(data.error); return; }
    _renderSecurityScore(data);
  } catch(e) { _renderScoreError('Scan failed. Please try again.'); }
}

function _ssGrade(score) {
  if (score >= 95) return 'A+'; if (score >= 90) return 'A'; if (score >= 85) return 'A-';
  if (score >= 80) return 'B+'; if (score >= 75) return 'B'; if (score >= 70) return 'B-';
  if (score >= 65) return 'C+'; if (score >= 55) return 'C'; if (score >= 40) return 'D';
  return 'F';
}

const _SS_GRADE_COLORS = {'A+':'#16a34a','A':'#16a34a','A-':'#22c55e','B+':'#2563eb','B':'#2563eb','B-':'#3b82f6','C+':'#d97706','C':'#d97706','D':'#dc2626','F':'#991b1b'};
const _SS_SEV_COLORS   = {critical:'#dc2626',high:'#ea580c',medium:'#d97706',low:'#9ca3af'};
const _SS_SEV_LABELS   = {critical:'Critical',high:'High',medium:'Medium',low:'Low'};

function _renderScoreEmpty() {
  const el = document.getElementById('ss-domain-label');
  if (el) el.textContent = 'No domain configured';
  const line = document.getElementById('ss-score-line');
  if (line) line.textContent = 'Complete your setup to run a security scan.';
}

function _renderScoreLoading(domain) {
  const el = document.getElementById('ss-domain-label');
  if (el) el.textContent = `Scanning ${domain}…`;
  const line = document.getElementById('ss-score-line');
  if (line) line.textContent = 'Checking HTTPS, SSL, security headers, CDN protection…';
  const circle = document.getElementById('ss-grade-circle');
  if (circle) { circle.textContent = '…'; circle.style.background = '#e5e7eb'; }
  const bar = document.getElementById('ss-score-bar');
  if (bar) { bar.style.width = '0%'; bar.style.background = '#e5e7eb'; }
}

function _renderScoreError(msg) {
  const line = document.getElementById('ss-score-line');
  if (line) line.textContent = '⚠️ ' + msg;
}

function _renderSecurityScore(data) {
  const color    = _SS_GRADE_COLORS[data.grade] || '#dc2626';
  const barColor = data.numericScore >= 80 ? '#16a34a' : data.numericScore >= 55 ? '#d97706' : '#dc2626';

  const circle = document.getElementById('ss-grade-circle');
  if (circle) { circle.textContent = data.grade; circle.style.background = color; }

  const domainEl = document.getElementById('ss-domain-label');
  if (domainEl) domainEl.textContent = data.domain;
  const scoreLine = document.getElementById('ss-score-line');
  if (scoreLine) scoreLine.textContent = `${data.numericScore}/100 · ${data.grade} Security Grade`;
  const bar = document.getElementById('ss-score-bar');
  if (bar) setTimeout(() => { bar.style.width = data.numericScore + '%'; bar.style.background = barColor; }, 80);
  const meta = document.getElementById('ss-score-meta');
  if (meta) meta.textContent = `${data.passedChecks.length} checks passed · ${data.issues.length} issues found · Confidence: ${data.confidence}`;

  const confBadge = document.getElementById('ss-confidence-badge');
  if (confBadge) { confBadge.textContent = '🔎 Confidence: ' + data.confidence; confBadge.style.display = ''; }

  const scanTime = document.getElementById('ss-scan-time');
  if (scanTime && data.scannedAt) {
    scanTime.textContent = 'Scanned ' + new Date(data.scannedAt).toLocaleTimeString() + (data.cached ? ' (cached)' : '');
  }

  if (data.managed) {
    const mb = document.getElementById('ss-managed-badge');
    if (mb) mb.style.display = '';
    const mbox = document.getElementById('ss-managed-box');
    if (mbox) {
      mbox.style.display = '';
      const mg = document.getElementById('ss-managed-grade');
      if (mg) { mg.textContent = data.grade; mg.style.color = color; }
      const mp = document.getElementById('ss-managed-points');
      if (mp) mp.textContent = data.numericScore + '/100';
    }
  }

  const baseScore = data.managed ? Math.max(0, data.numericScore - (data.managedBonus || 0)) : data.numericScore;
  const afterScore = Math.min(100, baseScore + 35);
  if (baseScore < 90) {
    const baSection = document.getElementById('ss-before-after');
    if (baSection) {
      baSection.style.display = '';
      const beforeGradeEl = document.getElementById('ss-before-grade');
      if (beforeGradeEl) { beforeGradeEl.textContent = _ssGrade(baseScore); beforeGradeEl.style.color = _SS_GRADE_COLORS[_ssGrade(baseScore)] || '#dc2626'; }
      const beforeScoreEl = document.getElementById('ss-before-score');
      if (beforeScoreEl) beforeScoreEl.textContent = baseScore + '/100';
      const afterGradeEl = document.getElementById('ss-after-grade');
      if (afterGradeEl) afterGradeEl.textContent = _ssGrade(afterScore);
      const afterScoreEl = document.getElementById('ss-after-score');
      if (afterScoreEl) afterScoreEl.textContent = afterScore + '/100';
      const impEl = document.getElementById('ss-improvement');
      if (impEl) impEl.textContent = '+' + (afterScore - baseScore) + ' pts';
    }
  }

  const bSection = document.getElementById('ss-breakdown-section');
  if (bSection) bSection.style.display = '';
  const bBody = document.getElementById('ss-breakdown-body');
  if (bBody && data.breakdown) {
    bBody.innerHTML = Object.values(data.breakdown).map(b => {
      const pct = b.score / b.max;
      const c = pct >= 0.8 ? '#16a34a' : pct >= 0.5 ? '#d97706' : '#dc2626';
      return `<div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <span style="font-size:13px;color:var(--text)">${b.label}</span>
          <span style="font-size:13px;font-weight:700;color:${c}">${b.score}/${b.max}</span>
        </div>
        <div style="height:6px;background:var(--bg);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${Math.round(pct*100)}%;background:${c};border-radius:3px;transition:width 0.7s ease"></div>
        </div>
      </div>`;
    }).join('');
  }

  const iBody  = document.getElementById('ss-issues-body');
  const iTitle = document.getElementById('ss-issues-title');
  if (iBody) {
    if (iTitle) iTitle.textContent = data.issues.length ? `Issues Found (${data.issues.length})` : 'Issues';
    iBody.innerHTML = !data.issues.length
      ? '<div style="color:#16a34a;font-size:13px;padding:8px 0">✅ No issues found!</div>'
      : data.issues.map(i => `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="width:8px;height:8px;border-radius:50%;background:${_SS_SEV_COLORS[i.severity]||'#9ca3af'};flex-shrink:0;margin-top:4px"></div>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:7px">
                ${_escapeHtml(i.label)}
                <span style="font-size:10px;font-weight:600;color:${_SS_SEV_COLORS[i.severity]};background:${_SS_SEV_COLORS[i.severity]}18;padding:2px 6px;border-radius:4px">${_SS_SEV_LABELS[i.severity]||''}</span>
              </div>
              <div style="font-size:12px;color:var(--muted);margin-top:3px">${_escapeHtml(i.detail)}</div>
            </div>
          </div>`).join('');
  }

  const pBody = document.getElementById('ss-passed-body');
  if (pBody) {
    pBody.innerHTML = !data.passedChecks.length
      ? '<div style="color:var(--muted);font-size:13px;padding:8px 0">No checks passed yet.</div>'
      : data.passedChecks.map(c => `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
            <span style="color:#16a34a;font-size:14px">${c.icon||'✓'}</span>
            <span style="color:var(--text)">${_escapeHtml(c.label)}</span>
          </div>`).join('');
  }

  if (data.managed && data.managedChecks?.length) {
    const mc = document.getElementById('ss-managed-checks-card');
    const mb = document.getElementById('ss-managed-checks-body');
    if (mc) mc.style.display = '';
    if (mb) mb.innerHTML = data.managedChecks.map(c => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
          <span style="color:var(--accent);font-size:14px">${c.icon||'🛡️'}</span>
          <span style="color:var(--text)">${_escapeHtml(c.label)}</span>
        </div>`).join('');
  }

  if (data.unknownChecks?.length) {
    const uc = document.getElementById('ss-unknown-card');
    const ub = document.getElementById('ss-unknown-body');
    if (uc) uc.style.display = '';
    if (ub) ub.innerHTML = data.unknownChecks.map(c => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--muted)">
          <span>❓</span> ${_escapeHtml(typeof c==='string'?c:c.label)}
        </div>`).join('');
  }
}

async function submitTicket() {
  const subject = (document.getElementById('ticket-subject').value || '').trim();
  const message = (document.getElementById('ticket-message').value || '').trim();
  const errEl = document.getElementById('ticket-error');
  const okEl  = document.getElementById('ticket-success');
  const btn   = document.getElementById('ticket-submit-btn');

  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  if (!subject || !message) {
    errEl.textContent = 'Please fill in both subject and message.';
    errEl.style.display = '';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const res = await fetch(`${_SERVER}/api/tickets`, {
      method: 'POST',
      headers: await _getAuthHeaders(),
      body: JSON.stringify({ subject, message })
    });
    if (!res.ok) throw new Error('Failed');
    document.getElementById('ticket-subject').value = '';
    document.getElementById('ticket-message').value = '';
    okEl.style.display = '';
    loadMyTickets();
  } catch (err) {
    errEl.textContent = 'Could not submit your request. Please try again.';
    errEl.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Request →';
  }
}
