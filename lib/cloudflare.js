const { makeRequest } = require('./http');
const { normalizeDomain } = require('./utils');

const CF_EMAIL   = process.env.CF_EMAIL   || '';
const CF_API_KEY = process.env.CF_API_KEY || '';

const _cfHeaders = () => ({
  'X-Auth-Email': CF_EMAIL,
  'X-Auth-Key':   CF_API_KEY,
  'Content-Type': 'application/json',
});

async function cfGet(apiPath) {
  const u = new URL('https://api.cloudflare.com/client/v4' + apiPath);
  const result = await makeRequest({
    hostname: u.hostname,
    path:     u.pathname + u.search,
    headers:  _cfHeaders(),
    timeout:  10000,
  });
  try { return JSON.parse(result.body); }
  catch(e) { throw new Error('CF parse error'); }
}

async function cfGetZoneId(domain) {
  const clean = normalizeDomain(domain);
  const data = await cfGet(`/zones?name=${encodeURIComponent(clean)}`);
  if (!data.success || !data.result.length) return null;
  return data.result[0].id;
}

async function cfGraphQL(query, variables) {
  const result = await makeRequest({
    hostname: 'api.cloudflare.com',
    path:     '/client/v4/graphql',
    method:   'POST',
    headers:  _cfHeaders(),
    timeout:  15000,
  }, { query, variables });
  try { return JSON.parse(result.body); }
  catch(e) { throw new Error('CF GraphQL parse error'); }
}

async function cfCreateZone(domain) {
  const clean = normalizeDomain(domain);
  const result = await makeRequest({
    hostname: 'api.cloudflare.com',
    path:     '/client/v4/zones',
    method:   'POST',
    headers:  _cfHeaders(),
    timeout:  15000,
  }, { name: clean, jump_start: true });
  try { return JSON.parse(result.body); }
  catch(e) { throw new Error('CF parse error'); }
}

module.exports = { cfGet, cfGetZoneId, cfGraphQL, cfCreateZone, CF_EMAIL, CF_API_KEY };
