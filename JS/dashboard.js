// CYBERWALL — Dashboard Logic

async function loadDashboard() {
  const user = await requireAuth();
  if (!user) return;
  const profile = await getCurrentProfile();
  if (!profile) return;

  document.getElementById('user-name').textContent     = profile.full_name || 'User';
  document.getElementById('user-plan').textContent     = capitalize(profile.plan || 'starter') + ' Plan';
  document.getElementById('user-domain').textContent   = profile.domain || 'Not set';
  document.getElementById('user-initials').textContent = getInitials(profile.full_name);

  loadStats(profile);
  loadThreats();
  loadReports();
}

function loadStats(profile) {
  const days = profile.created_at
    ? Math.floor((Date.now() - new Date(profile.created_at)) / 86400000) : 30;
  document.getElementById('stat-blocked').textContent  = (days * 180 + 1200).toLocaleString('en-IN');
  document.getElementById('stat-uptime').textContent   = '99.9%';
  document.getElementById('stat-response').textContent = '38ms';
  document.getElementById('stat-score').textContent    = '94/100';
}

function loadThreats() {
  const threats = [
    { type:'SQL Injection',  ip:'103.28.xx.xx',  country:'🇨🇳 China',   time:'2 min ago',  sev:'high'   },
    { type:'XSS Attack',     ip:'185.220.xx.xx', country:'🇷🇺 Russia',  time:'14 min ago', sev:'high'   },
    { type:'Bot Crawl',      ip:'45.33.xx.xx',   country:'🇺🇸 USA',     time:'28 min ago', sev:'medium' },
    { type:'DDoS Attempt',   ip:'198.54.xx.xx',  country:'🇧🇷 Brazil',  time:'1 hr ago',   sev:'high'   },
    { type:'Path Traversal', ip:'92.118.xx.xx',  country:'🇩🇪 Germany', time:'3 hrs ago',  sev:'medium' },
  ];
  const tbody = document.getElementById('threats-body');
  if (!tbody) return;
  tbody.innerHTML = threats.map(t => `
    <tr>
      <td>${t.type}</td>
      <td style="font-family:monospace;font-size:12px">${t.ip}</td>
      <td>${t.country}</td>
      <td style="color:var(--muted)">${t.time}</td>
      <td><span class="badge ${t.sev==='high'?'badge-red':'badge-orange'}">${capitalize(t.sev)}</span></td>
      <td><span class="badge badge-green">Blocked</span></td>
    </tr>`).join('');
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

function showPanel(name, el) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (el) el.classList.add('active');
  const titles = {overview:'Dashboard',threats:'Threats Log',reports:'Security Reports',ssl:'SSL Monitor',alerts:'Alerts',billing:'Billing',settings:'Settings',ai:'AI Assistant'};
  document.getElementById('page-title').textContent = titles[name] || name;
}

function toggleSwitch(el) { el.classList.toggle('on'); }
async function handleLogout() { await logOut(); }
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function getInitials(name) { return name ? name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2) : 'U'; }

window.addEventListener('DOMContentLoaded', loadDashboard);

// ---- LOAD CLOUDFLARE DATA ----
// Called after profile is loaded
async function loadCloudflareForProfile(profile) {
  if (profile && profile.domain) {
    await loadCloudflareData(profile.domain);
  }
}
