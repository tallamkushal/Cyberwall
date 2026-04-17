const https = require('https');

const CF_EMAIL   = process.env.CF_EMAIL   || '';
const CF_API_KEY = process.env.CF_API_KEY || '';
const CF_BASE    = 'https://api.cloudflare.com/client/v4';

function cfGet(apiPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(CF_BASE + apiPath);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_API_KEY, 'Content-Type': 'application/json' }
    };
    const r = https.get(opts, resp => {
      let raw = '';
      resp.on('data', c => raw += c);
      resp.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('CF parse error')); } });
    });
    r.on('error', reject);
    r.setTimeout(10000, () => { r.destroy(); reject(new Error('CF API timeout')); });
  });
}

async function cfGetZoneId(domain) {
  const clean = domain.replace(/https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const data = await cfGet(`/zones?name=${encodeURIComponent(clean)}`);
  if (!data.success || !data.result.length) return null;
  return data.result[0].id;
}

module.exports = { cfGet, cfGetZoneId, CF_EMAIL, CF_API_KEY };
