const { makeRequest } = require('./http');

const SUPABASE_HOSTNAME    = 'fwbclrdzctszwbfxywgi.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function supabaseRequest(method, path, body, prefer = 'return=minimal') {
  return makeRequest({
    hostname: SUPABASE_HOSTNAME,
    path:     '/rest/v1/' + path,
    method,
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type':  'application/json',
      'Prefer':        prefer,
    },
    timeout: 10000,
  }, body || null);
}

function supabaseUpsert(path, body) {
  return supabaseRequest('POST', path, body, 'resolution=merge-duplicates,return=minimal');
}

function supabaseAuthRequest(method, path, body) {
  return makeRequest({
    hostname: SUPABASE_HOSTNAME,
    path:     '/auth/v1/' + path,
    method,
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type':  'application/json',
    },
    timeout: 10000,
  }, body || null);
}

module.exports = { supabaseRequest, supabaseUpsert, supabaseAuthRequest, SUPABASE_SERVICE_KEY, SUPABASE_HOSTNAME };
