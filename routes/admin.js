const https  = require('https');
const crypto = require('crypto');
const { requireAdminAuth } = require('../lib/auth');
const { supabaseRequest, SUPABASE_SERVICE_KEY, SUPABASE_HOSTNAME } = require('../lib/supabase');

async function handle(req, res, parsedUrl) {
  // ── ADMIN: GET ALL CLIENTS ──────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/admin/clients') {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }
    try {
      const result = await supabaseRequest('GET', 'profiles?role=eq.client&order=created_at.desc&select=*', null);
      const clients = JSON.parse(result.body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, clients: Array.isArray(clients) ? clients : [] }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── ADMIN: ADD CLIENT ───────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/admin/add-client') {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { full_name, email, phone, business_name, domain, plan } = JSON.parse(body);
        if (!email || !full_name || !domain) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'name, email and domain are required' }));
          return;
        }

        // Step 1: create auth user (generates a UUID that satisfies FK constraint)
        const authResult = await new Promise((resolve, reject) => {
          const payload = JSON.stringify({
            email,
            password: crypto.randomBytes(16).toString('hex') + 'Cw1!',
            email_confirm: true,
            user_metadata: { full_name }
          });
          const opts = {
            hostname: SUPABASE_HOSTNAME,
            path: '/auth/v1/admin/users',
            method: 'POST',
            headers: {
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          };
          const r = https.request(opts, resp => {
            let raw = '';
            resp.on('data', c => raw += c);
            resp.on('end', () => {
              try { resolve({ status: resp.statusCode, body: JSON.parse(raw) }); }
              catch (e) { reject(new Error('Supabase auth parse error')); }
            });
          });
          r.on('error', reject);
          r.write(payload);
          r.end();
        });

        if (authResult.status >= 400) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: authResult.body.msg || authResult.body.message || 'Failed to create user' }));
          return;
        }

        const userId = authResult.body.id;

        // Step 2: create profile row
        const profileResult = await supabaseRequest('POST', 'profiles', {
          id: userId, full_name, email, phone: phone || '',
          business_name: business_name || '', domain, plan: plan || 'starter',
          status: 'trial', role: 'client', created_at: new Date()
        });

        if (profileResult.status >= 400) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: profileResult.body }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, userId }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // ── ADMIN: UPDATE CLIENT ────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/admin/update-client') {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { id, plan, status } = JSON.parse(body);
        if (!id) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'id required'})); return; }
        const update = {};
        if (plan)   update.plan   = plan;
        if (status) update.status = status;
        const result = await supabaseRequest('PATCH', `profiles?id=eq.${id}`, update);
        res.writeHead(result.status >= 400 ? 400 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.status >= 400 ? { error: result.body } : { success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // ── TASKS: LIST & CREATE ────────────────────────────────────────────────────
  if (req.url === '/api/admin/tasks') {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return true; }

    if (req.method === 'GET') {
      const r = await supabaseRequest('GET', 'tasks?order=created_at.desc&select=*', null);
      const tasks = JSON.parse(r.body);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ tasks: Array.isArray(tasks) ? tasks : [] }));
      return true;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { title, description, priority, due_date, client_id } = JSON.parse(body);
          if (!title) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'title required'})); return; }
          const task = { title, description: description || null, priority: priority || 'med', due_date: due_date || null, client_id: client_id || null, completed: false };
          const r = await supabaseRequest('POST', 'tasks', task);
          res.writeHead(r.status >= 400 ? 400 : 201, {'Content-Type':'application/json'});
          res.end(r.status >= 400 ? r.body : JSON.stringify({success:true}));
        } catch (err) {
          res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message}));
        }
      });
      return true;
    }
  }

  // ── TASKS: UPDATE & DELETE ──────────────────────────────────────────────────
  if (req.url.startsWith('/api/admin/tasks/')) {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return true; }
    const taskId = req.url.slice('/api/admin/tasks/'.length).split('?')[0];

    if (req.method === 'PATCH') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const updates = JSON.parse(body);
          const r = await supabaseRequest('PATCH', `tasks?id=eq.${encodeURIComponent(taskId)}`, updates);
          res.writeHead(r.status >= 400 ? 400 : 200, {'Content-Type':'application/json'});
          res.end(r.status >= 400 ? r.body : JSON.stringify({success:true}));
        } catch (err) {
          res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message}));
        }
      });
      return true;
    }

    if (req.method === 'DELETE') {
      const r = await supabaseRequest('DELETE', `tasks?id=eq.${encodeURIComponent(taskId)}`, null);
      res.writeHead(r.status >= 400 ? 400 : 200, {'Content-Type':'application/json'});
      res.end(r.status >= 400 ? r.body : JSON.stringify({success:true}));
      return true;
    }
  }

  // ── SUPPORT TICKETS: ADMIN LIST ─────────────────────────────────────────────
  if (req.url === '/api/admin/tickets') {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return true; }

    if (req.method === 'GET') {
      const r = await supabaseRequest('GET', 'support_tickets?order=created_at.desc&select=*', null);
      const tickets = JSON.parse(r.body);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ tickets: Array.isArray(tickets) ? tickets : [] }));
      return true;
    }
  }

  // ── SUPPORT TICKETS: ADMIN RESOLVE ─────────────────────────────────────────
  if (req.url.startsWith('/api/admin/tickets/')) {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return true; }
    const ticketId = req.url.slice('/api/admin/tickets/'.length).split('?')[0];

    if (req.method === 'PATCH') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const updates = JSON.parse(body);
          if (updates.status === 'resolved') updates.resolved_at = new Date().toISOString();
          const r = await supabaseRequest('PATCH', `support_tickets?id=eq.${encodeURIComponent(ticketId)}`, updates);
          res.writeHead(r.status >= 400 ? 400 : 200, {'Content-Type':'application/json'});
          res.end(r.status >= 400 ? r.body : JSON.stringify({success:true}));
        } catch (err) {
          res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message}));
        }
      });
      return true;
    }
  }

  return false;
}

module.exports = { handle };
