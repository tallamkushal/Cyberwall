const { requireAuth } = require('../lib/auth');
const { supabaseRequest } = require('../lib/supabase');
const { createAlert } = require('../lib/alerts');

async function handle(req, res, parsedUrl) {
  // ── GET ALERTS ──────────────────────────────────────────────────────────────
  if (req.method === 'GET' && parsedUrl.pathname === '/api/alerts') {
    const authUser = await requireAuth(req);
    if (!authUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return true; }
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
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── NEW LOGIN NOTIFICATION ──────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/login-notify') {
    const authUser = await requireAuth(req);
    if (!authUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return true; }
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ ok: true }));
    // Fire-and-forget: check if IP has changed
    (async () => {
      try {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        const profRes = await supabaseRequest('GET', `profiles?id=eq.${authUser.id}&select=last_login_ip`, null);
        const [prof]  = JSON.parse(profRes.body);
        const lastIp  = prof?.last_login_ip;
        await supabaseRequest('PATCH', `profiles?id=eq.${authUser.id}`, { last_login_ip: ip, last_login_at: new Date().toISOString() });
        if (lastIp && lastIp !== ip) {
          createAlert(authUser.id, 'login', 'low',
            'Dashboard accessed from a new location',
            `Your ProCyberWall dashboard was accessed from a new IP address. If this was not you, contact ProCyberWall support immediately to secure your account.`
          ).catch(() => {});
        }
      } catch (e) { console.error('Login notify error:', e.message); }
    })();
    return true;
  }

  // ── MARK ALL ALERTS READ ────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/alerts/read') {
    const authUser = await requireAuth(req);
    if (!authUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return true; }
    try {
      await supabaseRequest('PATCH',
        `alerts?user_id=eq.${encodeURIComponent(authUser.id)}&is_read=eq.false`,
        { is_read: true }
      );
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── RESOLVE A SINGLE ALERT ──────────────────────────────────────────────────
  if (req.method === 'POST' && parsedUrl.pathname === '/api/alerts/resolve') {
    const authUser = await requireAuth(req);
    if (!authUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return true; }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { id } = JSON.parse(body);
        if (!id) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Missing id'})); return; }
        await supabaseRequest('PATCH',
          `alerts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(authUser.id)}`,
          { is_resolved: true, is_read: true, resolved_at: new Date().toISOString() }
        );
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  return false;
}

module.exports = { handle };
