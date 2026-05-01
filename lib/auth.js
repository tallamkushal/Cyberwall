const { makeRequest } = require('./http');
const { supabaseRequest, SUPABASE_SERVICE_KEY, SUPABASE_HOSTNAME } = require('./supabase');

function _extractToken(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

async function _verifyToken(token) {
  const result = await makeRequest({
    hostname: SUPABASE_HOSTNAME,
    path:     '/auth/v1/user',
    method:   'GET',
    headers:  { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + token },
    timeout:  8000,
  });
  try {
    const body = JSON.parse(result.body);
    return result.status === 200 && body.id ? body : null;
  } catch(e) { return null; }
}

async function requireAuth(req) {
  const token = _extractToken(req);
  if (!token) return null;
  return _verifyToken(token);
}

async function requireAdminAuth(req) {
  const token = _extractToken(req);
  if (!token) return null;
  const user = await _verifyToken(token);
  if (!user) return null;
  const r = await supabaseRequest('GET', `profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, null);
  try {
    const profiles = JSON.parse(r.body);
    return Array.isArray(profiles) && profiles[0]?.role === 'admin' ? user : null;
  } catch(e) { return null; }
}

module.exports = { requireAuth, requireAdminAuth };
