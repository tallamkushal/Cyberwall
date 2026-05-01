const { requireAuth } = require('../lib/auth');
const { supabaseRequest } = require('../lib/supabase');
const { sendError } = require('../lib/utils');

async function handle(req, res, parsedUrl) {
  // ── GET ALERTS ──────────────────────────────────────────────────────────────
  if (req.method === 'GET' && parsedUrl.pathname === '/api/alerts') {
    const authUser = await requireAuth(req);
    if (!authUser) return sendError(res, 401, 'Unauthorized'), true;
    try {
      const showResolved = parsedUrl.searchParams.get('show_resolved') === 'true';
      const resolvedFilter = showResolved ? '' : '&is_resolved=eq.false';
      const result = await supabaseRequest('GET',
        `alerts?user_id=eq.${encodeURIComponent(authUser.id)}${resolvedFilter}&order=created_at.desc&limit=50&select=*`,
        null
      );
      const alerts = JSON.parse(result.body);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ alerts: Array.isArray(alerts) ? alerts : [] }));
    } catch (e) {
      sendError(res, 500, e.message);
    }
    return true;
  }

  // ── NEW LOGIN NOTIFICATION ──────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/login-notify') {
    const authUser = await requireAuth(req);
    if (!authUser) return sendError(res, 401, 'Unauthorized'), true;
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── MARK ALL ALERTS READ ────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/alerts/read') {
    const authUser = await requireAuth(req);
    if (!authUser) return sendError(res, 401, 'Unauthorized'), true;
    try {
      await supabaseRequest('PATCH',
        `alerts?user_id=eq.${encodeURIComponent(authUser.id)}&is_read=eq.false`,
        { is_read: true }
      );
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      sendError(res, 500, e.message);
    }
    return true;
  }

  // ── RESOLVE A SINGLE ALERT ──────────────────────────────────────────────────
  if (req.method === 'POST' && parsedUrl.pathname === '/api/alerts/resolve') {
    const authUser = await requireAuth(req);
    if (!authUser) return sendError(res, 401, 'Unauthorized'), true;
    let body = '';
    req.on('data', c => body += c);
    req.on('error', () => sendError(res, 400, 'Bad request'));
    req.on('end', async () => {
      try {
        const { id } = JSON.parse(body);
        if (!id) return sendError(res, 400, 'Missing id');
        await supabaseRequest('PATCH',
          `alerts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(authUser.id)}`,
          { is_resolved: true, is_read: true, resolved_at: new Date().toISOString() }
        );
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        sendError(res, 500, e.message);
      }
    });
    return true;
  }

  return false;
}

module.exports = { handle };
