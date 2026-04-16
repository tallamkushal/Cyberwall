const https = require('https');

const SUPABASE_HOSTNAME    = 'fwbclrdzctszwbfxywgi.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function supabaseRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: SUPABASE_HOSTNAME,
      path: '/rest/v1/' + path,
      method,
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const r = https.request(opts, resp => {
      let raw = '';
      resp.on('data', c => raw += c);
      resp.on('end', () => resolve({ status: resp.statusCode, body: raw }));
    });
    r.on('error', reject);
    r.setTimeout(10000, () => { r.destroy(); reject(new Error('Supabase timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

module.exports = { supabaseRequest, SUPABASE_SERVICE_KEY, SUPABASE_HOSTNAME };
