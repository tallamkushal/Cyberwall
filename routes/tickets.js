const { requireAuth } = require('../lib/auth');
const { supabaseRequest } = require('../lib/supabase');

async function handle(req, res, parsedUrl) {
  // ── SUPPORT TICKETS: CLIENT SUBMIT ─────────────────────────────────────────
  if (req.url === '/api/tickets') {
    const authUser = await requireAuth(req);
    if (!authUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return true; }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { subject, message } = JSON.parse(body);
          if (!subject || !message) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'subject and message required'})); return; }
          const ticket = { client_id: authUser.id, subject, message, status: 'open' };
          const r = await supabaseRequest('POST', 'support_tickets', ticket);
          res.writeHead(r.status >= 400 ? 400 : 201, {'Content-Type':'application/json'});
          res.end(r.status >= 400 ? r.body : JSON.stringify({success:true}));
        } catch (err) {
          res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message}));
        }
      });
      return true;
    }
  }

  // ── SUPPORT TICKETS: CLIENT VIEW MINE ──────────────────────────────────────
  if (req.url === '/api/tickets/mine') {
    const authUser = await requireAuth(req);
    if (!authUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return true; }

    if (req.method === 'GET') {
      const r = await supabaseRequest('GET', `support_tickets?client_id=eq.${encodeURIComponent(authUser.id)}&order=created_at.desc&select=*`, null);
      const tickets = JSON.parse(r.body);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ tickets: Array.isArray(tickets) ? tickets : [] }));
      return true;
    }
  }

  return false;
}

module.exports = { handle };
