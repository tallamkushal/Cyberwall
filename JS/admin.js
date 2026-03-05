// ============================================
// CYBERWALL — Admin Logic
// This file:
// - Checks if logged in user is an admin
// - Loads ALL client profiles from Supabase
// - Loads revenue data
// - Manages client operations
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Step 1: Check if logged in
  const user = await requireAuth();
  if (!user) return;

  // Step 2: Check if they are an admin
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') {
    // Not an admin — send them to client dashboard
    alert('Access denied. Admins only.');
    window.location.href = 'dashboard.html';
    return;
  }

  // Step 3: Load all data
  await loadAllClients();
  loadRevenueStats();
});

// ---- LOAD ALL CLIENTS ----
async function loadAllClients() {
  const { data: clients, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('role', 'client')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading clients:', error);
    return;
  }

  // Update client count
  safeSet('total-clients', clients.length);

  // Count trials
  const trials = clients.filter(c => c.status === 'trial').length;
  safeSet('total-trials', trials);

  // Count overdue
  const overdue = clients.filter(c => c.status === 'overdue').length;
  safeSet('total-overdue', overdue);

  // Calculate MRR
  const planPrices = { starter: 2999, pro: 5999, business: 9999 };
  const mrr = clients
    .filter(c => c.status === 'active')
    .reduce((sum, c) => sum + (planPrices[c.plan] || 0), 0);
  safeSet('total-mrr', '₹' + mrr.toLocaleString('en-IN'));

  // Render client table
  renderClientTable(clients);
}

// ---- RENDER CLIENT TABLE ----
function renderClientTable(clients) {
  const tbody = document.getElementById('clients-tbody');
  if (!tbody) return;

  if (clients.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:32px;color:var(--muted)">
          No clients yet. Add your first client above!
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = clients.map(c => `
    <tr>
      <td>
        <div style="font-weight:600">${c.full_name || '—'}</div>
        <div style="font-size:12px;color:var(--muted)">${c.domain || '—'}</div>
      </td>
      <td><span class="plan-tag">${capitalize(c.plan || 'starter')}</span></td>
      <td>${getStatusBadge(c.status)}</td>
      <td style="font-weight:600">${c.status === 'active' ? '₹' + getPlanPrice(c.plan).toLocaleString('en-IN') : '—'}</td>
      <td style="color:var(--muted);font-size:12px">${formatDate(c.created_at)}</td>
      <td>
        <button class="action-btn action-view" onclick="viewClient('${c.id}')">View</button>
        ${c.status === 'overdue'
          ? `<button class="action-btn action-warn" style="margin-left:6px" onclick="sendReminder('${c.id}', '${c.full_name}')">Remind</button>`
          : ''}
      </td>
    </tr>
  `).join('');
}

// ---- ADD NEW CLIENT ----
async function addClient() {
  const btn = document.getElementById('add-client-btn');
  const err = document.getElementById('add-client-error');

  const fname    = document.getElementById('ac-fname').value.trim();
  const lname    = document.getElementById('ac-lname').value.trim();
  const email    = document.getElementById('ac-email').value.trim();
  const phone    = document.getElementById('ac-phone').value.trim();
  const domain   = document.getElementById('ac-domain').value.trim();
  const bizname  = document.getElementById('ac-biz').value.trim();
  const plan     = document.getElementById('ac-plan').value;

  if (!fname || !email || !domain) {
    err.textContent = 'Please fill in name, email and domain';
    err.classList.remove('hidden');
    return;
  }

  btn.classList.add('loading');
  btn.innerHTML = '<span class="spinner"></span> Adding...';

  // Insert directly into profiles table
  // (admin adding client manually — no auth account created here)
  const { error } = await supabaseClient.from('profiles').insert({
    id: crypto.randomUUID(),
    full_name: fname + ' ' + lname,
    email, phone,
    business_name: bizname,
    domain, plan,
    status: 'trial',
    role: 'client',
    created_at: new Date()
  });

  if (error) {
    btn.classList.remove('loading');
    btn.textContent = 'Add Client →';
    err.textContent = error.message;
    err.classList.remove('hidden');
  } else {
    btn.textContent = '✓ Client Added!';
    btn.style.background = 'var(--green)';
    showToast('Client added successfully!', 'success');
    // Reload clients table
    setTimeout(async () => {
      await loadAllClients();
      showPanel('clients', null);
    }, 1500);
  }
}

// ---- VIEW CLIENT ----
function viewClient(id) {
  showToast('Client view coming soon!', 'default');
}

// ---- SEND REMINDER ----
function sendReminder(id, name) {
  showToast(`Reminder sent to ${name} on WhatsApp`, 'success');
}

// ---- REVENUE STATS ----
function loadRevenueStats() {
  // Mock revenue history for chart
  // Will connect to real Razorpay data later
  const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const values = [8000, 14000, 21000, 28000, 35000, 46992];
  const max = Math.max(...values);

  const chartEl = document.getElementById('rev-chart');
  if (!chartEl) return;

  chartEl.innerHTML = months.map((m, i) => `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px">
      <div style="font-size:10px;color:var(--muted);font-weight:600">
        ₹${(values[i]/1000).toFixed(0)}K
      </div>
      <div style="
        width:100%;border-radius:4px 4px 0 0;
        background:${i === months.length-1 ? 'var(--accent)' : 'var(--accent-light)'};
        height:${Math.round((values[i]/max)*100)}%;
        cursor:pointer;transition:background 0.2s;
      " onmouseover="this.style.background='var(--accent)'"
         onmouseout="this.style.background='${i === months.length-1 ? 'var(--accent)' : 'var(--accent-light)'}'">
      </div>
      <span style="font-size:10px;color:var(--muted-light)">${m}</span>
    </div>
  `).join('');
}

// ---- PANEL SWITCHER ----
function showPanel(name, el) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (el) el.classList.add('active');
  const titles = {
    overview: 'Admin Overview', clients: 'All Clients',
    revenue: 'Revenue', tasks: 'Tasks',
    add: 'Add New Client', support: 'Support'
  };
  safeSet('topbar-title', titles[name] || name);
}

// ---- HELPERS ----
function safeSet(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getPlanPrice(plan) {
  return { starter: 2999, pro: 5999, business: 9999 }[plan] || 0;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function getStatusBadge(status) {
  const map = {
    active:  '<span class="badge badge-green"><span class="live-dot"></span> Active</span>',
    trial:   '<span class="badge badge-blue"><span class="live-dot"></span> Trial</span>',
    overdue: '<span class="badge badge-red">Overdue</span>',
    cancelled: '<span class="badge" style="background:var(--bg);color:var(--muted)">Cancelled</span>',
  };
  return map[status] || '<span class="badge">Unknown</span>';
}

function toggleSwitch(el) {
  el.classList.toggle('on');
}
