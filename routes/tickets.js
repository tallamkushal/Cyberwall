const { requireAuth } = require('../lib/auth');
const { supabaseRequest } = require('../lib/supabase');
const { sendError } = require('../lib/utils');

async function handle(req, res, parsedUrl) {
  // ── SUPPORT TICKETS: CLIENT SUBMIT ─────────────────────────────────────────
  if (req.url === '/api/tickets') {
    const authUser = await requireAuth(req);
    if (!authUser) return sendError(res, 401, 'Unauthorized'), true;

    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { subject, message } = JSON.parse(body);
          if (!subject || !message) return sendError(res, 400, 'subject and message required');
          const ticket = { client_id: authUser.id, subject, message, status: 'open' };
          const r = await supabaseRequest('POST', 'support_tickets', ticket);
          res.writeHead(r.status >= 400 ? 400 : 201, {'Content-Type':'application/json'});
          res.end(r.status >= 400 ? r.body : JSON.stringify({ success: true }));
        } catch (err) {
          sendError(res, 500, err.message);
        }
      });
      return true;
    }
  }

  // ── SUPPORT TICKETS: CLIENT VIEW MINE ──────────────────────────────────────
  if (req.url === '/api/tickets/mine') {
    const authUser = await requireAuth(req);
    if (!authUser) return sendError(res, 401, 'Unauthorized'), true;

    if (req.method === 'GET') {
      try {
        const r = await supabaseRequest('GET',
          `support_tickets?client_id=eq.${encodeURIComponent(authUser.id)}&order=created_at.desc&select=*`,
          null);
        const tickets = JSON.parse(r.body);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ tickets: Array.isArray(tickets) ? tickets : [] }));
      } catch (err) {
        sendError(res, 500, err.message);
      }
      return true;
    }
  }

  return false;
}

module.exports = { handle };
