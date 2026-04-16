const https = require('https');
const { supabaseRequest, SUPABASE_SERVICE_KEY, SUPABASE_HOSTNAME } = require('./supabase');

async function requireAdminAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const userResult = await new Promise((resolve) => {
    const opts = {
      hostname: SUPABASE_HOSTNAME,
      path: '/auth/v1/user',
      method: 'GET',
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + token }
    };
    const r = https.request(opts, resp => {
      let raw = '';
      resp.on('data', c => raw += c);
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: 500, body: {} }); }
      });
    });
    r.on('error', () => resolve({ status: 500, body: {} }));
    r.setTimeout(8000, () => { r.destroy(); resolve({ status: 500, body: {} }); });
    r.end();
  });

  if (userResult.status !== 200 || !userResult.body.id) return null;

  const profileResult = await supabaseRequest(
    'GET',
    `profiles?id=eq.${encodeURIComponent(userResult.body.id)}&select=role`,
    null
  );
  try {
    const profiles = JSON.parse(profileResult.body);
    if (Array.isArray(profiles) && profiles[0]?.role === 'admin') return userResult.body;
  } catch (e) {}
  return null;
}

async function requireAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const result = await new Promise((resolve) => {
    const opts = {
      hostname: SUPABASE_HOSTNAME,
      path: '/auth/v1/user',
      method: 'GET',
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + token }
    };
    const r = https.request(opts, resp => {
      let raw = '';
      resp.on('data', c => raw += c);
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: 500, body: {} }); }
      });
    });
    r.on('error', () => resolve({ status: 500, body: {} }));
    r.setTimeout(8000, () => { r.destroy(); resolve({ status: 500, body: {} }); });
    r.end();
  });
  return result.status === 200 && result.body.id ? result.body : null;
}

module.exports = { requireAuth, requireAdminAuth };
