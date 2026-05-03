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

async function cfPut(apiPath, body) {
  const u = new URL('https://api.cloudflare.com/client/v4' + apiPath);
  const result = await makeRequest({
    hostname: u.hostname,
    path:     u.pathname + u.search,
    method:   'PUT',
    headers:  _cfHeaders(),
    timeout:  15000,
  }, body);
  try { return JSON.parse(result.body); }
  catch(e) { throw new Error('CF parse error'); }
}

// Cloudflare global managed ruleset IDs (fixed across all accounts)
const CF_MANAGED_RULESET_ID = 'efb7b8c949ac4650a09736fc376e9aee';
const CF_OWASP_RULESET_ID   = '4814384a9e5d4991b9815dcfc25d2f1f';

async function cfDeployWAF(zoneId) {
  return cfPut(`/zones/${zoneId}/rulesets/phases/http_request_firewall_managed/entrypoint`, {
    rules: [
      {
        action: 'execute',
        description: 'Cloudflare Managed Ruleset (SQLi, XSS, RCE, etc.)',
        expression: 'true',
        action_parameters: { id: CF_MANAGED_RULESET_ID },
        enabled: true,
      },
      {
        action: 'execute',
        description: 'OWASP Core Ruleset',
        expression: 'true',
        action_parameters: { id: CF_OWASP_RULESET_ID },
        enabled: true,
      },
    ],
  });
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

module.exports = { cfGet, cfPut, cfGetZoneId, cfGraphQL, cfCreateZone, cfDeployWAF, CF_EMAIL, CF_API_KEY };
