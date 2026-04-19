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
    window.location.replace('dashboard.html');
    return;
  }

  // Step 3: Load all data
  await loadAllClients();
  loadRevenueStats();
  loadTasks();
  loadTickets();
});


var SERVER = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
var _clientsById = {}; // populated after loadAllClients

async function getAuthHeaders() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
  return headers;
}

function escapeHtml(str) {
  if (str == null) return '—';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- LOAD ALL CLIENTS ----
async function loadAllClients() {
  let list = [];
  try {
    const res = await fetch(`${SERVER}/api/admin/clients`, { headers: await getAuthHeaders() });
    const data = await res.json();
    list = data.clients || [];
  } catch (err) {
    console.error('Failed to load clients:', err);
    showToast('Could not load clients. Is the server running?', 'error');
    return;
  }

  // Build lookup map
  _clientsById = {};
  list.forEach(c => { _clientsById[c.id] = c; });

  // Update client count
  safeSet('total-clients', list.length);
  safeSet('clients-count-badge', list.length);
  const mobileClientsBadge = document.getElementById('clients-badge-mobile');
  if (mobileClientsBadge) { mobileClientsBadge.textContent = list.length; mobileClientsBadge.style.display = list.length > 0 ? '' : 'none'; }

  // Count trials
  const trials = list.filter(c => c.status === 'trial').length;
  safeSet('total-trials', trials);

  // Count overdue
  const overdueList = list.filter(c => c.status === 'overdue');
  safeSet('total-overdue', overdueList.length);

  // Calculate MRR
  const planPrices = { starter: 2999, pro: 5999, business: 9999 };
  const mrr = list
    .filter(c => c.status === 'active')
    .reduce((sum, c) => sum + (planPrices[c.plan] || 0), 0);
  safeSet('total-mrr', '₹' + mrr.toLocaleString('en-IN'));

  // Render client table
  renderClientTable(list);

  // Populate all other panels from real data
  renderRevenueStats(list);
  renderMRRBreakdown(list);
  renderRevenueChart(list);
  renderTasks(list);
  renderSupport(list);
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
        <div style="font-weight:600">${escapeHtml(c.full_name)}</div>
        <div style="font-size:12px;color:var(--muted)">${escapeHtml(c.domain)}</div>
      </td>
      <td><span class="plan-tag">${escapeHtml(capitalize(c.plan || 'starter'))}</span></td>
      <td>${getStatusBadge(c.status)}</td>
      <td style="font-weight:600">${c.status === 'active' ? '₹' + getPlanPrice(c.plan).toLocaleString('en-IN') : '—'}</td>
      <td style="color:var(--muted);font-size:12px">${escapeHtml(formatDate(c.created_at))}</td>
      <td>
        <button class="action-btn action-view" data-id="${escapeHtml(c.id)}" onclick="viewClient(this.dataset.id)">View</button>
        ${c.status === 'overdue'
          ? `<button class="action-btn action-warn" style="margin-left:6px" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.full_name)}" onclick="sendReminder(this.dataset.id, this.dataset.name)">Remind</button>`
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
  const dialcode = document.getElementById('ac-dialcode').value;
  const phone    = dialcode + document.getElementById('ac-phone').value.trim();
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

  const res = await fetch(`${SERVER}/api/admin/add-client`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ full_name: fname + ' ' + lname, email, phone, business_name: bizname, domain, plan })
  });
  const result = await res.json();

  if (result.error) {
    btn.classList.remove('loading');
    btn.textContent = 'Add Client →';
    err.textContent = result.error;
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
async function viewClient(id) {
  const res = await fetch(`${SERVER}/api/admin/clients`, { headers: await getAuthHeaders() });
  const data = await res.json();
  const client = (data.clients || []).find(c => c.id === id);

  if (!client) {
    showToast('Could not load client details', 'error');
    return;
  }

  // Populate modal
  document.getElementById('cv-name').textContent    = client.full_name || '—';
  document.getElementById('cv-domain').textContent  = client.domain || '—';
  document.getElementById('cv-email').textContent   = client.email || '—';
  document.getElementById('cv-phone').textContent   = client.phone || '—';
  document.getElementById('cv-biz').textContent     = client.business_name || '—';
  document.getElementById('cv-joined').textContent  = formatDate(client.created_at);
  document.getElementById('cv-plan').textContent    = capitalize(client.plan || 'starter');
  document.getElementById('cv-status').innerHTML    = getStatusBadge(client.status);
  document.getElementById('cv-notes').textContent   = client.notes || 'No notes.';

  // Plan select
  const planSel = document.getElementById('cv-plan-select');
  planSel.value = client.plan || 'starter';

  // Status select
  const statusSel = document.getElementById('cv-status-select');
  statusSel.value = client.status || 'trial';

  // WhatsApp button
  document.getElementById('cv-whatsapp-btn').onclick = () => {
    const phone = (client.phone || '').replace(/\D/g, '').slice(-10);
    if (!phone) { showToast('No phone number on file', 'error'); return; }
    window.open(`https://wa.me/91${phone}`, '_blank');
  };

  // Save changes button
  document.getElementById('cv-save-btn').onclick = () => saveClientChanges(id);

  // Store id for save
  document.getElementById('cv-modal').dataset.clientId = id;

  document.getElementById('cv-modal').classList.remove('hidden');
}

function closeClientModal() {
  document.getElementById('cv-modal').classList.add('hidden');
  document.getElementById('cv-cf-result').classList.add('hidden');
}

// ---- ACTIVATE CLOUDFLARE ----
async function activateCloudflare() {
  const domain = document.getElementById('cv-domain').textContent.trim();
  if (!domain || domain === '—') { showToast('No domain on file for this client', 'error'); return; }

  const btn = document.getElementById('cv-cf-btn');
  btn.textContent = 'Adding to Cloudflare...';
  btn.disabled = true;

  const res = await fetch(`${SERVER}/api/cf/activate`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ domain })
  });
  const data = await res.json();

  btn.textContent = '☁️ Activate Cloudflare';
  btn.disabled = false;

  if (data.error) {
    showToast('Cloudflare error: ' + data.error, 'error');
    return;
  }

  // Store nameservers for copy/WhatsApp
  window._cfNameservers = data.nameservers;
  window._cfDomain = domain;

  document.getElementById('cv-cf-ns').innerHTML = data.nameservers.map(ns => `<div>🔹 ${escapeHtml(ns)}</div>`).join('');
  document.getElementById('cv-cf-result').classList.remove('hidden');
  showToast('Domain added to Cloudflare!', 'success');
}

function copyCFNameservers() {
  const text = (window._cfNameservers || []).join('\n');
  navigator.clipboard.writeText(text).then(() => showToast('Nameservers copied!', 'success'));
}

async function sendCFWhatsApp() {
  const id = document.getElementById('cv-modal').dataset.clientId;
  const res = await fetch(`${SERVER}/api/admin/clients`, { headers: await getAuthHeaders() });
  const data = await res.json();
  const client = (data.clients || []).find(c => c.id === id);
  if (!client?.phone) { showToast('No phone number on file', 'error'); return; }

  const ns = (window._cfNameservers || []).join('\n');
  const message = `Hi ${client.full_name}! 👋\n\nYour website *${window._cfDomain}* is being connected to ProCyberWall protection.\n\nPlease update your domain nameservers at your registrar (GoDaddy, Namecheap, etc.) to:\n\n${ns}\n\nOnce updated, protection goes live within 24 hours. Reply if you need help! 🛡\n\n— ProCyberWall Team`;

  const result = await sendWhatsApp(client.phone, message);
  if (result.success) {
    showToast('Nameservers sent via WhatsApp ✅', 'success');
  } else {
    showToast('WhatsApp failed: ' + (result.error || 'unknown'), 'error');
  }
}

async function saveClientChanges(id) {
  const plan   = document.getElementById('cv-plan-select').value;
  const status = document.getElementById('cv-status-select').value;

  const res = await fetch(`${SERVER}/api/admin/update-client`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ id, plan, status })
  });
  const result = await res.json();

  if (!result.success) {
    showToast('Failed to save changes', 'error');
  } else {
    showToast('Client updated!', 'success');
    closeClientModal();
    await loadAllClients();
  }
}

// ---- SEND REMINDER ----
async function sendReminder(id, name) {
  const res = await fetch(`${SERVER}/api/admin/clients`, { headers: await getAuthHeaders() });
  const data = await res.json();
  const client = (data.clients || []).find(c => c.id === id);
  if (!client?.phone) { showToast('No phone number on file for ' + name, 'error'); return; }
  const message = `Hi ${name}! 👋\n\nThis is a reminder from ProCyberWall that your payment is overdue.\n\nPlease renew your subscription to keep your website *${client.domain || ''}* protected.\n\nReply to this message or log in to your dashboard to sort it out.\n\n— ProCyberWall Team 🛡`;
  const result = await sendWhatsApp(client.phone, message);
  if (result.success) {
    showToast(`Reminder sent to ${name} on WhatsApp ✅`, 'success');
  } else {
    showToast('Failed to send reminder: ' + (result.error || 'unknown error'), 'error');
  }
}

// ---- LOAD REVENUE STATS (called after loadAllClients) ----
function loadRevenueStats() {
  // Revenue stats are rendered inside loadAllClients via renderRevenueStats / renderMRRBreakdown
}

// ---- REVENUE STATS ----
function renderRevenueStats(clients) {
  const planPrices = { starter: 2999, pro: 5999, business: 9999 };
  const active  = clients.filter(c => c.status === 'active');
  const overdue = clients.filter(c => c.status === 'overdue');
  const mrr     = active.reduce((sum, c) => sum + (planPrices[c.plan] || 0), 0);
  const overdueMrr = overdue.reduce((sum, c) => sum + (planPrices[c.plan] || 0), 0);

  safeSet('rev-mrr',     '₹' + mrr.toLocaleString('en-IN'));
  safeSet('rev-arr',     '₹' + (mrr * 12).toLocaleString('en-IN'));
  safeSet('rev-overdue', overdueMrr > 0 ? '₹' + overdueMrr.toLocaleString('en-IN') : '₹0');
  safeSet('mrr-display', '₹' + mrr.toLocaleString('en-IN'));
  safeSet('total-mrr-2', '₹' + mrr.toLocaleString('en-IN'));
}

function renderMRRBreakdown(clients) {
  const planPrices = { starter: 2999, pro: 5999, business: 9999 };
  ['starter', 'pro', 'business'].forEach(plan => {
    const active = clients.filter(c => c.status === 'active' && c.plan === plan);
    const amount = active.length * planPrices[plan];
    safeSet(`mrr-count-${plan}`, active.length + ' client' + (active.length !== 1 ? 's' : ''));
    safeSet(`mrr-amount-${plan}`, active.length > 0 ? '₹' + amount.toLocaleString('en-IN') : '—');
  });
}

function renderRevenueChart(clients) {
  const chartEl = document.getElementById('rev-chart');
  if (!chartEl) return;
  const planPrices  = { starter: 2999, pro: 5999, business: 9999 };
  const planLabels  = { starter: 'Starter', pro: 'Pro', business: 'Business' };
  const planColors  = { starter: '#93c5fd', pro: 'var(--accent)', business: '#4f46e5' };
  const plans = ['starter', 'pro', 'business'];
  const values = plans.map(p =>
    clients.filter(c => c.status === 'active' && c.plan === p).length * planPrices[p]
  );
  const max = Math.max(...values, 1);
  chartEl.innerHTML = plans.map((p, i) => `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px">
      <div style="font-size:10px;color:var(--muted);font-weight:600">
        ${values[i] > 0 ? '₹' + (values[i]/1000).toFixed(1) + 'K' : '—'}
      </div>
      <div style="width:100%;border-radius:4px 4px 0 0;background:${planColors[p]};height:${Math.max(Math.round((values[i]/max)*100), values[i]>0?8:0)}%;transition:background 0.2s;"></div>
      <span style="font-size:10px;color:var(--muted-light)">${planLabels[p]}</span>
    </div>`).join('');
}

// Auto-generated action items stored for overview panel
var _autoActionItems = [];

// localStorage key for dismissed action items
const DISMISSED_KEY = 'cw_dismissed_actions';

function getDismissed() {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'); } catch { return []; }
}
function dismissAction(key) {
  const list = getDismissed();
  if (!list.includes(key)) list.push(key);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(list));
}

function renderTasks(clients) {
  const tasks = [];

  clients.filter(c => c.status === 'overdue').forEach(c => tasks.push({
    priority: 'high',
    key: `overdue-${c.id}`,
    title: `Payment overdue — ${c.full_name || c.email}`,
    desc: `${capitalize(c.plan || 'starter')} plan · ${c.domain || 'no domain'}. Send a WhatsApp reminder.`,
    time: 'Action needed',
    clientId: c.id,
    clientName: c.full_name || c.email,
  }));

  clients.filter(c => !c.domain).forEach(c => tasks.push({
    priority: 'high',
    key: `nodomain-${c.id}`,
    title: `Domain not set up — ${c.full_name || c.email}`,
    desc: `Signed up ${formatDate(c.created_at)} but hasn't connected a domain yet.`,
    time: formatDate(c.created_at),
  }));

  clients.filter(c => c.status === 'trial' && c.domain).forEach(c => tasks.push({
    priority: 'med',
    key: `trial-${c.id}`,
    title: `Trial client — ${c.full_name || c.email}`,
    desc: `${c.domain} is on ${capitalize(c.plan || 'starter')} trial. Consider converting to paid.`,
    time: formatDate(c.created_at),
  }));

  _autoActionItems = tasks;

  const dismissed = getDismissed();
  const visible = tasks.filter(t => !dismissed.includes(t.key));
  const highCount = visible.filter(t => t.priority === 'high').length;
  const badge = document.getElementById('tasks-count-badge');
  if (badge) { badge.textContent = highCount > 0 ? highCount : ''; badge.style.display = highCount > 0 ? '' : 'none'; }
  const mobileTasksBadge = document.getElementById('tasks-badge-mobile');
  if (mobileTasksBadge) { mobileTasksBadge.textContent = highCount > 0 ? highCount : ''; mobileTasksBadge.style.display = highCount > 0 ? '' : 'none'; }

  const empty = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">All caught up — no action items.</div>';

  const renderAutoTask = t => {
    const done = dismissed.includes(t.key);
    return `
    <div class="task-item" id="action-${escapeHtml(t.key)}" style="${done ? 'opacity:0.4;' : ''}">
      <div class="task-dot dot-${t.priority}"></div>
      <div style="flex:1;min-width:0">
        <div class="task-title" style="${done ? 'text-decoration:line-through;color:var(--muted);' : ''}">${escapeHtml(t.title)}</div>
        <div class="task-desc">${escapeHtml(t.desc)}</div>
      </div>
      ${t.clientId && !done ? `<button class="action-btn action-warn" style="flex-shrink:0;margin-left:8px" onclick="sendReminder('${escapeHtml(t.clientId)}','${escapeHtml(t.clientName)}')">Remind</button>` : ''}
      <button class="action-btn ${done ? 'action-view' : 'action-ok'}" style="flex-shrink:0;margin-left:8px"
        onclick="markActionDone('${escapeHtml(t.key)}')">${done ? 'Undo' : '✓ Done'}</button>
    </div>`;
  };

  const actionEl = document.getElementById('action-items-list');
  if (actionEl) actionEl.innerHTML = tasks.length ? tasks.map(renderAutoTask).join('') : empty;

  const overviewTasks = document.getElementById('overview-tasks');
  if (overviewTasks) overviewTasks.innerHTML = visible.length ? visible.slice(0, 3).map(renderAutoTask).join('') : empty;
}

function markActionDone(key) {
  const dismissed = getDismissed();
  const isDone = dismissed.includes(key);
  if (isDone) {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed.filter(k => k !== key)));
  } else {
    dismissAction(key);
  }
  const dismissed2 = getDismissed();

  // Update the row in place without full re-render
  const row = document.getElementById('action-' + key);
  if (row) {
    const nowDone = dismissed2.includes(key);
    row.style.opacity = nowDone ? '0.4' : '1';
    const titleEl = row.querySelector('.task-title');
    if (titleEl) titleEl.style.textDecoration = nowDone ? 'line-through' : '';
    // Swap the Done/Undo button
    const btns = row.querySelectorAll('.action-btn');
    btns.forEach(b => {
      if (b.getAttribute('onclick') && b.getAttribute('onclick').includes('markActionDone')) {
        b.textContent = nowDone ? 'Undo' : '✓ Done';
        b.className = `action-btn ${nowDone ? 'action-view' : 'action-ok'}`;
      }
      // Hide/show Remind button
      if (b.getAttribute('onclick') && b.getAttribute('onclick').includes('sendReminder')) {
        b.style.display = nowDone ? 'none' : '';
      }
    });
  }

  // Update badge count
  const highCount = _autoActionItems.filter(t => !dismissed2.includes(t.key) && t.priority === 'high').length;
  const badge = document.getElementById('tasks-count-badge');
  if (badge) { badge.textContent = highCount > 0 ? highCount : ''; badge.style.display = highCount > 0 ? '' : 'none'; }
}

// Load custom tasks from DB
async function loadTasks() {
  const el = document.getElementById('tasks-list');
  if (!el) return;
  try {
    const res = await fetch(`${SERVER}/api/admin/tasks`, { headers: await getAuthHeaders() });
    const data = await res.json();
    renderCustomTasks(data.tasks || []);
  } catch (err) {
    if (el) el.innerHTML = '<div style="color:var(--red);font-size:13px;padding:8px">Failed to load tasks.</div>';
  }
}

function renderCustomTasks(tasks) {
  const el = document.getElementById('tasks-list');
  if (!el) return;
  if (!tasks.length) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">No custom tasks. Create one above.</div>';
    return;
  }
  el.innerHTML = tasks.map(t => {
    const dotClass = t.priority === 'high' ? 'dot-high' : t.priority === 'low' ? 'dot-low' : 'dot-med';
    const doneStyle = t.completed ? 'opacity:0.5;' : '';
    const titleStyle = t.completed ? 'text-decoration:line-through;color:var(--muted);' : '';
    const dueStr = t.due_date ? `Due ${formatDate(t.due_date)}` : '';
    return `
      <div class="task-item" style="${doneStyle}">
        <div class="task-dot ${dotClass}"></div>
        <div style="flex:1;min-width:0">
          <div class="task-title" style="${titleStyle}">${escapeHtml(t.title)}</div>
          ${t.description ? `<div class="task-desc">${escapeHtml(t.description)}</div>` : ''}
        </div>
        ${dueStr ? `<span class="task-time">${escapeHtml(dueStr)}</span>` : ''}
        <button class="action-btn ${t.completed ? 'action-view' : 'action-ok'}" style="flex-shrink:0;margin-left:8px"
          onclick="toggleTaskDone('${escapeHtml(t.id)}', ${!t.completed})">${t.completed ? 'Undo' : '✓ Done'}</button>
        <button class="action-btn action-del" style="flex-shrink:0;margin-left:4px"
          onclick="deleteTask('${escapeHtml(t.id)}')">Delete</button>
      </div>`;
  }).join('');
}

function toggleNewTaskForm() {
  const form = document.getElementById('new-task-form');
  if (!form) return;
  const open = form.style.display !== 'none';
  form.style.display = open ? 'none' : 'block';
  if (!open) document.getElementById('new-task-title').focus();
}

async function createTask() {
  const title = document.getElementById('new-task-title').value.trim();
  const priority = document.getElementById('new-task-priority').value;
  const due_date = document.getElementById('new-task-due').value || null;
  const description = document.getElementById('new-task-desc').value.trim() || null;
  const errEl = document.getElementById('new-task-error');

  if (!title) { errEl.textContent = 'Title is required.'; errEl.style.display = ''; return; }
  errEl.style.display = 'none';

  try {
    const res = await fetch(`${SERVER}/api/admin/tasks`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ title, description, priority, due_date })
    });
    if (!res.ok) throw new Error('Failed');
    document.getElementById('new-task-title').value = '';
    document.getElementById('new-task-desc').value = '';
    document.getElementById('new-task-due').value = '';
    document.getElementById('new-task-priority').value = 'med';
    toggleNewTaskForm();
    showToast('Task created!', 'success');
    loadTasks();
  } catch (err) {
    errEl.textContent = 'Could not create task. Try again.';
    errEl.style.display = '';
  }
}

async function toggleTaskDone(id, completed) {
  try {
    await fetch(`${SERVER}/api/admin/tasks/${id}`, {
      method: 'PATCH',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ completed })
    });
    loadTasks();
  } catch (err) {
    showToast('Could not update task.', 'error');
  }
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    await fetch(`${SERVER}/api/admin/tasks/${id}`, {
      method: 'DELETE',
      headers: await getAuthHeaders()
    });
    loadTasks();
  } catch (err) {
    showToast('Could not delete task.', 'error');
  }
}

function renderSupport(clients) {
  const el = document.getElementById('support-list');
  if (!el) return;
  const withPhone = clients.filter(c => c.phone);
  if (!withPhone.length) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">No clients with phone numbers yet.</div>';
    return;
  }
  const colors = ['var(--accent)', 'var(--green)', 'var(--orange)', 'var(--red)', '#7c3aed'];
  el.innerHTML = withPhone.map((c, i) => {
    const initials = (c.full_name || c.email || '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const phone = (c.phone || '').replace(/\D/g, '').slice(-10);
    return `
      <div class="support-item">
        <div class="support-avatar" style="background:${colors[i % colors.length]}">${escapeHtml(initials)}</div>
        <div style="flex:1;min-width:0">
          <div class="support-name">${escapeHtml(c.full_name || c.email)} <span style="font-size:11px;color:var(--muted);font-weight:400">· ${escapeHtml(c.domain || 'no domain')}</span></div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${getStatusBadge(c.status)} &nbsp; ${escapeHtml(capitalize(c.plan || 'starter'))} plan</div>
        </div>
        <div class="support-reply" style="display:flex;gap:6px">
          ${phone ? `<a href="https://wa.me/91${phone}" target="_blank" class="btn btn-ghost" style="font-size:12px;padding:6px 12px">💬 WhatsApp</a>` : ''}
          <button class="action-btn action-view" onclick="viewClient('${escapeHtml(c.id)}')">View</button>
        </div>
      </div>`;
  }).join('');
}

// Load support tickets from DB
async function loadTickets() {
  const el = document.getElementById('tickets-list');
  if (!el) return;
  try {
    const res = await fetch(`${SERVER}/api/admin/tickets`, { headers: await getAuthHeaders() });
    const data = await res.json();
    renderTickets(data.tickets || []);
  } catch (err) {
    if (el) el.innerHTML = '<div style="color:var(--red);font-size:13px;padding:8px">Failed to load tickets.</div>';
  }
}

function renderTickets(tickets) {
  const el = document.getElementById('tickets-list');
  const countEl = document.getElementById('open-ticket-count');
  const badge = document.getElementById('support-count-badge');
  if (!el) return;

  const open = tickets.filter(t => t.status === 'open');
  if (countEl) countEl.textContent = open.length ? `${open.length} open` : 'All resolved';
  if (badge) { badge.textContent = open.length || ''; badge.style.display = open.length ? '' : 'none'; }
  const mobileSupportBadge = document.getElementById('support-badge-mobile');
  if (mobileSupportBadge) { mobileSupportBadge.textContent = open.length || ''; mobileSupportBadge.style.display = open.length ? '' : 'none'; }

  if (!tickets.length) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">No support tickets yet.</div>';
    return;
  }

  el.innerHTML = tickets.map(t => {
    const isOpen = t.status === 'open';
    const statusBadge = isOpen
      ? '<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:#fee2e2;color:var(--red);font-weight:600">Open</span>'
      : '<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:#dcfce7;color:var(--green);font-weight:600">Resolved</span>';
    return `
      <div class="support-item" style="${!isOpen ? 'opacity:0.6;' : ''}">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
            <div class="support-name">${escapeHtml(t.subject)}</div>
            ${statusBadge}
          </div>
          <div class="support-msg">${escapeHtml(t.message)}</div>
          <div class="support-time">${escapeHtml((_clientsById[t.client_id] || {}).full_name || (_clientsById[t.client_id] || {}).email || t.client_id)} · ${formatDate(t.created_at)}</div>
        </div>
        <div class="support-reply" style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          ${isOpen ? `<button class="action-btn action-ok" onclick="resolveTicket('${escapeHtml(t.id)}')">✓ Resolve</button>` : ''}
          ${(() => { const c = _clientsById[t.client_id]; const ph = c && (c.phone || '').replace(/\D/g,'').slice(-10); return ph ? `<a href="https://wa.me/91${ph}" target="_blank" class="btn btn-ghost" style="font-size:12px;padding:5px 10px">💬 WhatsApp</a>` : ''; })()}
        </div>
      </div>`;
  }).join('');
}

async function resolveTicket(id) {
  try {
    const res = await fetch(`${SERVER}/api/admin/tickets/${id}`, {
      method: 'PATCH',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ status: 'resolved' })
    });
    if (!res.ok) throw new Error('Failed');
    showToast('Ticket resolved!', 'success');
    loadTickets();
  } catch (err) {
    showToast('Could not resolve ticket.', 'error');
  }
}

// ---- PANEL SWITCHER ----
function showPanel(name, el) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (el) el.classList.add('active');

  // Sync mobile bottom nav active state
  document.querySelectorAll('.admin-mobile-nav-item[data-panel]').forEach(i => i.classList.remove('active'));
  const mobileItem = document.querySelector(`.admin-mobile-nav-item[data-panel="${name}"]`);
  if (mobileItem) mobileItem.classList.add('active');

  const titles = {
    overview: 'Admin Overview', clients: 'All Clients',
    revenue: 'Revenue', tasks: 'Tasks',
    add: 'Add New Client', support: 'Support', scanner: 'Site Scanner'
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
