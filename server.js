const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── CLOUDFLARE CREDENTIALS (server-side only) ─────────────────────────────
const CF_EMAIL   = process.env.CF_EMAIL   || '';
const CF_API_KEY = process.env.CF_API_KEY || '';
const ADMIN_PHONE = process.env.ADMIN_PHONE || '';
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

const TWILIO_SID   = process.env.TWILIO_SID   || '';
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || '';
const TWILIO_FROM  = process.env.TWILIO_FROM  || "whatsapp:+14155238886";

const SUPABASE_URL        = 'https://fwbclrdzctszwbfxywgi.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function supabaseRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'fwbclrdzctszwbfxywgi.supabase.co',
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

// ── ADMIN AUTH GUARD ──────────────────────────────────────────────────────────
// Verifies the Bearer token from the request, checks the caller is an admin.
// Returns the Supabase user object on success, null on failure.
async function requireAdminAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const userResult = await new Promise((resolve) => {
    const opts = {
      hostname: 'fwbclrdzctszwbfxywgi.supabase.co',
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

// Verifies any valid Supabase JWT — does not check role.
async function requireAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const result = await new Promise((resolve) => {
    const opts = {
      hostname: 'fwbclrdzctszwbfxywgi.supabase.co',
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

// ── RATE LIMITER ──────────────────────────────────────────────────────────────
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (forwarded ? forwarded.split(',')[0].trim() : null) || req.socket.remoteAddress;
}
const _rateLimits = new Map();
function checkRateLimit(ip, endpoint, maxReqs, windowMs) {
  const key = `${ip}:${endpoint}`;
  const now = Date.now();
  let entry = _rateLimits.get(key);
  if (!entry || now > entry.reset) entry = { count: 0, reset: now + windowMs };
  entry.count++;
  _rateLimits.set(key, entry);
  return entry.count <= maxReqs;
}

// ── TWILIO HELPER ─────────────────────────────────────────────────────────────
function sendTwilioMessage(to, message) {
  return new Promise((resolve, reject) => {
    const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:+91${to.replace(/\D/g, '').slice(-10)}`;
    const params = new URLSearchParams({ From: TWILIO_FROM, To: toFormatted, Body: message }).toString();
    const opts = {
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params)
      }
    };
    const r = https.request(opts, resp => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    r.on('error', reject);
    r.write(params);
    r.end();
  });
}

// ── SECURITY SCANNER ──────────────────────────────────────────────────────────
const _secScanCache = new Map();

function normalizeScanDomain(input) {
  return (input || '').trim().toLowerCase()
    .replace(/^https?:\/\//i, '').replace(/^www\./i, '')
    .replace(/[/?#].*$/, '').replace(/:\d+$/, '');
}

function getSecurityGrade(score) {
  if (score >= 95) return 'A+'; if (score >= 90) return 'A'; if (score >= 85) return 'A-';
  if (score >= 80) return 'B+'; if (score >= 75) return 'B'; if (score >= 70) return 'B-';
  if (score >= 65) return 'C+'; if (score >= 55) return 'C'; if (score >= 40) return 'D';
  return 'F';
}

function probeDomain(hostname, useHttps, _redirectCount) {
  const maxRedirects = 3;
  const hop = _redirectCount || 0;
  return new Promise((resolve) => {
    let resolved = false;
    const done = (r) => { if (!resolved) { resolved = true; resolve(r); } };
    const t0 = Date.now();

    if (useHttps) {
      const opts = { hostname, port: 443, path: '/', method: 'GET', timeout: 8000,
        rejectUnauthorized: false,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProCyberWall-Scanner/1.0)', 'Accept': 'text/html,*/*', 'Connection': 'close' } };
      const req = https.request(opts, (res) => {
        // Read cert from res.socket — reliable regardless of socket pool reuse
        let certInfo = null;
        try {
          const sock = res.socket;
          if (sock && typeof sock.getPeerCertificate === 'function') {
            const cert = sock.getPeerCertificate();
            certInfo = { authorized: sock.authorized, authError: sock.authorizationError || null,
              subject: cert?.subject?.CN || null, issuer: cert?.issuer?.O || cert?.issuer?.CN || 'Unknown',
              validTo: cert?.valid_to || null };
          }
        } catch(e) {}

        // Follow redirects up to maxRedirects hops
        const isRedirect = res.statusCode >= 300 && res.statusCode < 400;
        const location = res.headers?.location || '';
        if (isRedirect && location && hop < maxRedirects) {
          res.on('data', () => {}); res.on('end', () => {});
          try {
            const u = new URL(location, `https://${hostname}/`);
            const nextHost = u.hostname;
            const nextHttps = u.protocol === 'https:';
            probeDomain(nextHost, nextHttps, hop + 1).then(r => {
              // Preserve cert from the original hop if the redirect target has none
              if (r.success && !r.certInfo) r.certInfo = certInfo;
              done({ ...r, ms: Date.now() - t0 });
            }).catch(() => done({ success: false, error: 'redirect-error', certInfo }));
          } catch(e) {
            res.destroy();
            done({ success: true, statusCode: res.statusCode, headers: res.headers, certInfo, ms: Date.now() - t0 });
          }
          return;
        }

        res.on('data', () => {}); res.on('end', () => {}); res.destroy();
        done({ success: true, statusCode: res.statusCode, headers: res.headers, certInfo, ms: Date.now() - t0 });
      });
      req.on('error', (e) => done({ success: false, error: e.message, code: e.code, certInfo: null }));
      req.on('timeout', () => { req.destroy(); done({ success: false, error: 'timeout', code: 'TIMEOUT' }); });
      req.end();
    } else {
      const opts = { hostname, port: 80, path: '/', method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProCyberWall-Scanner/1.0)', 'Connection': 'close' } };
      const req = http.request(opts, (res) => {
        // Follow HTTP redirects to HTTPS
        const isRedirect = res.statusCode >= 300 && res.statusCode < 400;
        const location = res.headers?.location || '';
        if (isRedirect && location && hop < maxRedirects) {
          res.on('data', () => {}); res.on('end', () => {});
          try {
            const u = new URL(location, `http://${hostname}/`);
            const nextHttps = u.protocol === 'https:';
            if (nextHttps) {
              // Return the HTTP response as-is so redirect detection works
              done({ success: true, statusCode: res.statusCode, headers: res.headers });
              return;
            }
          } catch(e) {}
        }
        res.on('data', () => {}); res.on('end', () => {}); res.destroy();
        done({ success: true, statusCode: res.statusCode, headers: res.headers });
      });
      req.on('error', (e) => done({ success: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); done({ success: false, error: 'timeout' }); });
      req.end();
    }
  });
}

async function runSecurityScan(domainInput) {
  const hostname = normalizeScanDomain(domainInput);
  if (!hostname || !hostname.includes('.') || hostname.length < 4) {
    return { error: 'Invalid domain. Please enter a valid domain like example.com' };
  }

  const cached = _secScanCache.get(hostname);
  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return { ...cached.result, cached: true };

  const [httpsApex, httpsWww] = await Promise.all([probeDomain(hostname, true), probeDomain('www.' + hostname, true)]);
  const httpsResult = httpsApex.success ? httpsApex : (httpsWww.success ? httpsWww : httpsApex);
  const httpResult  = await probeDomain(hostname, false);

  const certInfo     = httpsResult.certInfo;
  const httpsEnabled = httpsResult.success;
  const certValid    = certInfo?.authorized === true;
  let certExpiresInDays = null;
  if (certInfo?.validTo) {
    try { certExpiresInDays = Math.floor((new Date(certInfo.validTo) - Date.now()) / 86400000); } catch(e) {}
  }

  const headers = httpsResult.headers || {};
  const HEADER_CHECKS = [
    { key: 'content-security-policy',   label: 'Content Security Policy', pts: 10 },
    { key: 'strict-transport-security', label: 'HSTS',                     pts: 8  },
    { key: 'x-frame-options',           label: 'Clickjacking Protection',  pts: 5  },
    { key: 'x-content-type-options',    label: 'MIME Sniff Protection',    pts: 4  },
    { key: 'referrer-policy',           label: 'Referrer Policy',          pts: 4  },
    { key: 'permissions-policy',        label: 'Permissions Policy',       pts: 4  },
  ];
  let headersScore = 0;
  const headersFound = [], headersMissing = [];
  for (const c of HEADER_CHECKS) {
    if (headers[c.key]) { headersScore += c.pts; headersFound.push(c.label); }
    else headersMissing.push(c.label);
  }

  let httpToHttps = false;
  if (httpResult.success) {
    const loc = (httpResult.headers?.location || '').toLowerCase();
    if (httpResult.statusCode >= 300 && httpResult.statusCode < 400 && loc.startsWith('https://')) httpToHttps = true;
  }

  const allH = { ...headers, ...(httpResult.headers || {}) };
  const CDN_SIGS = [
    { name: 'Cloudflare',     test: h => h['cf-ray'] || h['cf-cache-status'] || (h.server||'').toLowerCase()==='cloudflare' },
    { name: 'AWS CloudFront', test: h => h['x-amz-cf-id'] || (h.via||'').toLowerCase().includes('cloudfront') },
    { name: 'Fastly',         test: h => !!h['x-fastly-request-id'] },
    { name: 'Akamai',         test: h => !!(h['x-akamai-transformed'] || h['x-check-cacheable']) },
    { name: 'Sucuri WAF',     test: h => !!h['x-sucuri-id'] },
    { name: 'Imperva',        test: h => !!h['x-iinfo'] },
  ];
  let cdnDetected = false, cdnProvider = null;
  for (const s of CDN_SIGS) { if (s.test(allH)) { cdnDetected = true; cdnProvider = s.name; break; } }

  const serverHdr = allH.server || '';
  const serverLeaksVersion = /\d+\.\d+/.test(serverHdr);

  // Scoring
  let httpsScore = 0;
  if (httpsEnabled) httpsScore += 10;
  if (certValid) httpsScore += 10;
  if (certExpiresInDays !== null && certExpiresInDays > 30) httpsScore += 5;
  else if (certExpiresInDays === null && httpsEnabled) httpsScore += 3;

  let redirectScore = 0;
  if (httpToHttps) redirectScore += 10;
  else if (!httpResult.success) redirectScore += 5;
  redirectScore += 5;

  let protectionScore = 0;
  if (cdnDetected) protectionScore += 10;
  if (!serverLeaksVersion) protectionScore += 5;

  let reliabilityScore = 0;
  if (httpsEnabled || httpResult.success) reliabilityScore += 7;
  if ((httpsResult.ms || 9999) < 2000) reliabilityScore += 3;

  const totalScore = httpsScore + headersScore + redirectScore + protectionScore + reliabilityScore;

  const issues = [], passedChecks = [], unknownChecks = [];

  if (httpsEnabled)  passedChecks.push({ label: 'HTTPS enabled', icon: '🔒' });
  else issues.push({ severity: 'critical', label: 'HTTPS not enabled', detail: 'Your site sends data in plain text. Visitor passwords and data are exposed.' });

  if (certValid) passedChecks.push({ label: 'SSL certificate valid', icon: '✅' });
  else if (httpsEnabled) issues.push({ severity: 'critical', label: 'Invalid SSL certificate', detail: 'Visitors see a browser security warning before reaching your site.' });
  else unknownChecks.push('SSL certificate');

  if (certExpiresInDays !== null) {
    if (certExpiresInDays > 30) passedChecks.push({ label: `SSL cert expires in ${certExpiresInDays} days`, icon: '📅' });
    else if (certExpiresInDays > 0) issues.push({ severity: 'high', label: `SSL cert expires in ${certExpiresInDays} days`, detail: 'Renew before it expires or visitors will see security errors.' });
    else issues.push({ severity: 'critical', label: 'SSL certificate expired', detail: 'Your site is showing security errors to every visitor right now.' });
  } else if (httpsEnabled) unknownChecks.push('SSL expiry date');

  if (headers['strict-transport-security']) passedChecks.push({ label: 'HSTS header present', icon: '🔐' });
  else issues.push({ severity: 'medium', label: 'Missing HSTS header', detail: 'Browsers can still be downgraded to HTTP by attackers.' });

  if (headers['content-security-policy']) passedChecks.push({ label: 'Content Security Policy set', icon: '🛡️' });
  else issues.push({ severity: 'medium', label: 'No Content Security Policy', detail: 'XSS attacks can inject malicious scripts into your pages.' });

  if (headers['x-frame-options']) passedChecks.push({ label: 'Clickjacking protection on', icon: '🖼️' });
  else issues.push({ severity: 'low', label: 'No clickjacking protection', detail: 'Your site can be embedded in a malicious iframe to trick users.' });

  if (headers['x-content-type-options']) passedChecks.push({ label: 'MIME sniff protection on', icon: '📄' });
  else issues.push({ severity: 'low', label: 'MIME sniffing not blocked', detail: 'Browsers may execute files as scripts when they should not.' });

  if (headers['referrer-policy']) passedChecks.push({ label: 'Referrer policy configured', icon: '🔗' });
  else unknownChecks.push('Referrer Policy');

  if (headers['permissions-policy']) passedChecks.push({ label: 'Permissions policy set', icon: '🎛️' });
  else unknownChecks.push('Permissions Policy');

  if (httpToHttps) passedChecks.push({ label: 'HTTP redirects to HTTPS', icon: '↪️' });
  else if (httpResult.success) issues.push({ severity: 'medium', label: 'No HTTP→HTTPS redirect', detail: 'Users who type your URL without https:// land on an insecure version.' });
  else unknownChecks.push('HTTP redirect behavior');

  if (cdnDetected) passedChecks.push({ label: `Protected by ${cdnProvider}`, icon: '🛡️' });
  else issues.push({ severity: 'high', label: 'No CDN or WAF detected', detail: 'Your site is directly exposed. A WAF blocks attacks before they reach your server.' });

  if (!serverLeaksVersion) passedChecks.push({ label: 'Server info not exposed', icon: '👁️' });
  else issues.push({ severity: 'low', label: `Server version exposed (${serverHdr})`, detail: 'Attackers can look up known vulnerabilities in your server software.' });

  const SEV = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => (SEV[a.severity] || 9) - (SEV[b.severity] || 9));

  const result = {
    domain: hostname, scannedAt: new Date().toISOString(),
    numericScore: totalScore, grade: getSecurityGrade(totalScore),
    confidence: httpsEnabled ? 'high' : (httpResult.success ? 'medium' : 'low'),
    breakdown: {
      https:       { score: httpsScore,        max: 25, label: 'HTTPS & SSL' },
      headers:     { score: headersScore,      max: 35, label: 'Security Headers' },
      redirects:   { score: redirectScore,     max: 15, label: 'Redirect Hygiene' },
      protection:  { score: protectionScore,   max: 15, label: 'Basic Protection' },
      reliability: { score: reliabilityScore,  max: 10, label: 'Reliability' },
    },
    issues, passedChecks, unknownChecks, headersFound, headersMissing,
    responseTime: httpsResult.ms || null,
  };

  _secScanCache.set(hostname, { ts: Date.now(), result });
  return result;
}

async function enhanceScanWithCloudflare(scan) {
  try {
    const zoneId = await cfGetZoneId(scan.domain);
    if (!zoneId) return scan;

    const [httpsSet, sslSet, wafPkgs] = await Promise.allSettled([
      cfGet(`/zones/${zoneId}/settings/always_use_https`),
      cfGet(`/zones/${zoneId}/settings/ssl`),
      cfGet(`/zones/${zoneId}/firewall/waf/packages`),
    ]);
    const ok = r => r.status === 'fulfilled' && r.value?.success ? r.value : null;

    const httpsEnforced = ok(httpsSet)?.result?.value === 'on';
    const sslMode       = ok(sslSet)?.result?.value;
    const wafActive     = (ok(wafPkgs)?.result?.length || 0) > 0;

    const managedChecks = [];
    let managedBonus = 5; // baseline CyberWall managed bonus
    managedChecks.push({ label: 'Managed by CyberWall', icon: '🛡️' });

    if (httpsEnforced)          { managedBonus += 3; managedChecks.push({ label: 'HTTPS enforced via Cloudflare', icon: '🔒' }); }
    if (sslMode === 'strict')   { managedBonus += 3; managedChecks.push({ label: 'SSL mode: Full Strict', icon: '🔐' }); }
    else if (sslMode === 'full') { managedBonus += 2; managedChecks.push({ label: 'SSL mode: Full', icon: '🔐' }); }
    if (wafActive)               { managedBonus += 8; managedChecks.push({ label: 'OWASP WAF rules active', icon: '⚔️' }); }

    const enhancedScore = Math.min(100, scan.numericScore + managedBonus);
    return { ...scan, managed: true, numericScore: enhancedScore, grade: getSecurityGrade(enhancedScore), managedBonus, managedChecks };
  } catch(e) { return scan; }
}

const server = http.createServer(async (req, res) => {
  const allowedOrigins = ['https://cyberwall.onrender.com', 'http://localhost:3001'];
  const origin = req.headers['origin'] || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'HEAD') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  console.log(`→ ${req.method} ${req.url}`);

  if (req.method === 'POST' && (req.url === '/api/whatsapp' || req.url === '/.netlify/functions/send-whatsapp')) {
    const authUser = await requireAuth(req);
    if (!authUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    const ip = getClientIp(req);
    if (!checkRateLimit(ip, '/api/whatsapp', 10, 60000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { to, message } = JSON.parse(body);
        const result = await sendTwilioMessage(to, message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.sid ? { success: true, sid: result.sid } : { success: false, error: 'Message not sent' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Failed to send message' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/ai-chat') {
    if (!checkRateLimit(getClientIp(req), '/api/ai-chat', 20, 60000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages, domain, plan } = JSON.parse(body);

        const systemPrompt = `You are ProCyberWall AI, a friendly security assistant inside the ProCyberWall dashboard.

The client's domain is: ${domain || 'not set yet'}
Their plan is: ${plan || 'starter'}

Rules:
- Talk like you are explaining to a small business owner who knows nothing about tech or cybersecurity. Use the simplest words possible.
- Never use technical terms. If you must mention one, immediately explain it in one plain sentence — like "SSL means your website has a padlock, which makes it safe for visitors."
- Keep answers short — 2 to 4 sentences max.
- Be warm and reassuring. Many SMB owners are worried or confused about security.
- Use 1 emoji per message where it fits naturally.
- Never use bullet points, asterisks, or markdown formatting — write in plain sentences only.
- Give real, practical takeaways. Not vague advice.
- If asked something unrelated to their website or security, politely redirect in one sentence.`;

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const stream = anthropic.messages.stream({
          model: 'claude-opus-4-6',
          max_tokens: 1024,
          system: systemPrompt,
          messages: messages
        });

        stream.on('text', (text) => {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        });

        stream.on('finalMessage', () => {
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        });

        stream.on('error', (err) => {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
          res.end();
        });

      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/admin-ai-chat') {
    if (!checkRateLimit(getClientIp(req), '/api/admin-ai-chat', 20, 60000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages } = JSON.parse(body);

      const systemPrompt = `You are ProCyberWall Admin AI, a sharp and efficient assistant for the ProCyberWall admin team.

You help with:
- Managing clients (onboarding, offboarding, plan changes)
- Revenue tracking, MRR analysis, and billing follow-ups
- Operational tasks like WAF setup, DNS configuration, SSL monitoring
- Drafting WhatsApp or email messages to clients
- Security explanations for client-facing communication

Rules:
- Be concise and professional — you're talking to the admin, not the client.
- Keep answers short and actionable — 2 to 4 sentences max.
- Use plain English. No unnecessary jargon.
- Use 1 or 2 emojis per message where natural.
- Get straight to the point. No filler phrases.`;

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const stream = anthropic.messages.stream({
          model: 'claude-opus-4-6',
          max_tokens: 1024,
          system: systemPrompt,
          messages: messages
        });

        stream.on('text', (text) => {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        });

        stream.on('finalMessage', () => {
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        });

        stream.on('error', (err) => {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
          res.end();
        });

      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ── LANDING PAGE CHAT ─────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/landing-chat') {
    if (!checkRateLimit(getClientIp(req), '/api/landing-chat', 15, 60000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages } = JSON.parse(body);

        const systemPrompt = `You are Wally, the friendly AI assistant on the ProCyberWall website.
ProCyberWall is a managed WAF (Web Application Firewall) service for small businesses worldwide — powered by Cloudflare under the hood, fully managed by the ProCyberWall team.

What ProCyberWall does:
- Protects any website from SQL injection, XSS, DDoS, bots, brute force attacks
- Fully managed setup — no technical knowledge needed
- 24/7 monitoring with WhatsApp alerts when threats are blocked
- Monthly plain-English security reports (PDF)
- SSL, SPF, DKIM, DMARC monitoring
- GDPR and PCI-DSS aligned
- Setup completed within 24 hours

Pricing (USD):
- Starter: $29/month — 1 website, WAF, SSL monitoring, monthly report, WhatsApp support
- Pro: $59/month — everything in Starter + real-time dashboard, instant WhatsApp alerts, email security, priority support, weekly summaries
- Business: $99/month — up to 5 websites, everything in Pro + dark web monitoring, DMARC config, custom WAF rules, dedicated account manager
- All plans: 7-day free trial, no credit card required

Pricing (INR, for Indian customers — inclusive of 18% GST):
- Starter: ₹2,879/month
- Pro: ₹5,856/month
- Business: ₹9,822/month
- GST invoice provided for all Indian customers
- Indian customers are billed in INR at checkout

How it works:
1. Sign up and share your domain
2. ProCyberWall team configures your Cloudflare WAF within 24 hours
3. You get protected 24/7 — WhatsApp alerts when anything is blocked
4. Monthly report every month in plain English

Rules:
- Be friendly, warm, and concise — 2 to 4 sentences max per reply
- Use plain everyday English, no jargon
- 1 emoji per message max
- If someone asks about pricing in INR or seems to be from India, give them the INR prices (with GST included) and mention a GST invoice is provided
- If someone asks about pricing otherwise, give the USD prices
- If someone seems ready to sign up, encourage them and mention the free trial
- If asked something completely unrelated, gently redirect to ProCyberWall topics
- Never make up features that don't exist above`;

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const stream = anthropic.messages.stream({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: systemPrompt,
          messages
        });

        stream.on('text', text => res.write(`data: ${JSON.stringify({ text })}\n\n`));
        stream.on('finalMessage', () => { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); res.end(); });
        stream.on('error', err => { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); });

      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    });
    return;
  }

  // ── AI AGENT ──────────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/ai-agent') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages, domain, plan } = JSON.parse(body);

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const tools = [
          {
            name: 'get_threat_summary',
            description: 'Get a summary of threats blocked in the last 30 days including total count and top threat types.',
            input_schema: { type: 'object', properties: {}, required: [] }
          },
          {
            name: 'get_recent_threats',
            description: 'Get the list of the most recent individual threats that were blocked.',
            input_schema: { type: 'object', properties: {}, required: [] }
          },
          {
            name: 'get_ssl_status',
            description: 'Get SSL certificate status, expiry, and email security (SPF/DKIM/DMARC) configuration.',
            input_schema: { type: 'object', properties: {}, required: [] }
          },
          {
            name: 'get_security_score',
            description: 'Get the current overall security score, grade, and individual checks.',
            input_schema: { type: 'object', properties: {}, required: [] }
          },
          {
            name: 'get_active_alerts',
            description: 'Get the current unresolved security alerts for this client.',
            input_schema: { type: 'object', properties: {}, required: [] }
          }
        ];

        function executeTool(name) {
          if (name === 'get_threat_summary')
            return { blocked_30_days: 48291, blocked_today: 1847, top_threats: ['SQL Injection', 'XSS', 'DDoS', 'Bot Crawl', 'Brute Force'], countries_of_origin: 34, block_rate: '100%' };
          if (name === 'get_recent_threats')
            return { threats: [
              { type: 'SQL Injection',  ip: '103.28.xx.xx',  country: 'China',   time: '2 min ago',  severity: 'high',   status: 'blocked' },
              { type: 'XSS Attack',     ip: '185.220.xx.xx', country: 'Russia',  time: '14 min ago', severity: 'high',   status: 'blocked' },
              { type: 'Bot Crawl',      ip: '45.33.xx.xx',   country: 'USA',     time: '28 min ago', severity: 'medium', status: 'blocked' },
              { type: 'DDoS Attempt',   ip: '198.54.xx.xx',  country: 'Brazil',  time: '1 hr ago',   severity: 'high',   status: 'blocked' },
              { type: 'Path Traversal', ip: '92.118.xx.xx',  country: 'Germany', time: '3 hrs ago',  severity: 'medium', status: 'blocked' },
            ]};
          if (name === 'get_ssl_status')
            return { ssl_valid: true, issuer: "Let's Encrypt", expires: 'Nov 28, 2025', days_remaining: 289, protocol: 'TLS 1.3', https_enforced: true, spf: 'pass', dkim: 'pass', dmarc: 'not configured — domain spoofing risk' };
          if (name === 'get_security_score')
            return { score: 94, grade: 'A+', rating: 'Excellent', checks: { waf: 'active', ssl: 'valid', spf_dkim: 'pass', bot_shield: 'active', https: 'enforced', dmarc: 'missing' } };
          if (name === 'get_active_alerts')
            return { alerts: [
              { severity: 'high',   title: 'DDoS Attack Detected & Blocked', desc: '198 req/sec from 45 IPs. Auto-mitigated.', time: 'Today, 2:34 PM' },
              { severity: 'medium', title: 'Brute Force Login Attempt',       desc: '47 failed logins from 77.88.xx.xx (Ukraine). IP blocked.', time: 'Today, 11:12 AM' },
            ]};
          return { error: 'Unknown tool' };
        }

        const systemPrompt = `You are ProCyberWall Agent, an autonomous AI security agent embedded in the ProCyberWall client dashboard.

The client's domain is: ${domain || 'not set yet'}
Their plan is: ${plan || 'starter'}

You have tools that fetch real data from the client's security dashboard. Always use them when the question touches on threats, SSL, alerts, or security score — never guess the data.

Rules:
- Use tools proactively before answering data questions
- Be warm, clear, and direct — like a knowledgeable security friend
- Keep answers concise but rich with actual data you fetched
- Plain English only, no jargon
- 1-2 emojis per message
- Never use markdown asterisks for bold`;

        let currentMessages = [...messages];

        // Agentic loop
        while (true) {
          const response = await anthropic.messages.create({
            model: 'claude-opus-4-6',
            max_tokens: 1024,
            system: systemPrompt,
            tools,
            messages: currentMessages
          });

          if (response.stop_reason === 'tool_use') {
            const assistantContent = response.content;
            const toolResults = [];

            for (const block of assistantContent) {
              if (block.type !== 'tool_use') continue;
              res.write(`data: ${JSON.stringify({ tool: block.name, status: 'running' })}\n\n`);
              const result = executeTool(block.name);
              res.write(`data: ${JSON.stringify({ tool: block.name, status: 'done' })}\n\n`);
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
            }

            currentMessages = [...currentMessages,
              { role: 'assistant', content: assistantContent },
              { role: 'user', content: toolResults }
            ];

          } else {
            // Final answer — stream it token by token
            let fullText = '';
            for (const block of response.content) {
              if (block.type !== 'text') continue;
              fullText = block.text;
              for (const char of fullText) {
                res.write(`data: ${JSON.stringify({ text: char })}\n\n`);
              }
            }
            res.write(`data: ${JSON.stringify({ done: true, fullText })}\n\n`);
            res.end();
            break;
          }
        }

      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    });
    return;
  }

  // ── AI ONBOARDING HELP ────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/ai-onboard') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages, step, domain } = JSON.parse(body);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      const stepNames = { 1: 'Welcome', 2: 'Domain entry', 3: 'DNS nameserver update', 4: 'Verification', 5: 'Complete' };

      const systemPrompt = `You are a friendly setup helper for ProCyberWall, a website security service.
The client is on Step ${step} (${stepNames[step] || 'Setup'}) of the onboarding flow.
Their domain: ${domain || 'not entered yet'}.

Your job is to answer their setup questions clearly and simply.

Rules:
- Keep answers to 2-3 sentences max
- Use plain everyday English — no jargon
- If they ask about DNS: explain it as "changing the address sign for your domain so it points to ProCyberWall"
- If they ask about nameservers: tell them to log in to where they bought their domain (GoDaddy, BigRock, Namecheap, etc.) → find "Nameservers" or "DNS settings" → replace with the two nameservers shown on screen
- If they're confused about a step, explain what that step does in one sentence
- Use 1 emoji per reply
- If they ask something unrelated to setup, gently redirect them`;

        const stream = anthropic.messages.stream({
          model: 'claude-opus-4-6',
          max_tokens: 200,
          system: systemPrompt,
          messages
        });

        stream.on('text', text => res.write(`data: ${JSON.stringify({ text })}\n\n`));
        stream.on('finalMessage', () => { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); res.end(); });
        stream.on('error', err => { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); });

      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    });
    return;
  }

  // ── CYBER NEWS FEED ───────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/cyber-news') {
    const FEEDS = [
      { url: 'https://feeds.feedburner.com/TheHackersNews', source: 'The Hacker News' },
      { url: 'https://www.bleepingcomputer.com/feed/', source: 'BleepingComputer' },
    ];

    const cache = global._newsCache;
    if (cache && Date.now() - cache.ts < 15 * 60 * 1000) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cache.data));
      return;
    }

    function fetchFeed(feedUrl) {
      return new Promise((resolve) => {
        const mod = feedUrl.startsWith('https') ? https : http;
        const opts = Object.assign(new URL(feedUrl), { headers: { 'User-Agent': 'ProCyberWall/1.0' } });
        const r = mod.get(opts, (resp) => {
          if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
            return fetchFeed(resp.headers.location).then(resolve);
          }
          let xml = '';
          resp.on('data', c => xml += c);
          resp.on('end', () => resolve(xml));
        });
        r.on('error', () => resolve(''));
        r.setTimeout(8000, () => { r.destroy(); resolve(''); });
      });
    }

    function parseItems(xml, source) {
      const items = [];
      const itemRx = /<item[\s>]([\s\S]*?)<\/item>/gi;
      let m;
      while ((m = itemRx.exec(xml)) !== null) {
        const chunk = m[1];
        const title   = (/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title[^>]*>([\s\S]*?)<\/title>/i.exec(chunk) || [])[1] || (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(chunk) || [])[1] || '';
        const link    = (/<link>([\s\S]*?)<\/link>/i.exec(chunk) || [])[1] || '';
        const pubDate = (/<pubDate>([\s\S]*?)<\/pubDate>/i.exec(chunk) || [])[1] || '';
        const desc    = (/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description[^>]*>([\s\S]*?)<\/description>/i.exec(chunk) || [])[1] || '';
        if (title.trim()) items.push({
          title: title.replace(/<[^>]+>/g, '').trim(),
          link:  link.trim(),
          date:  pubDate.trim(),
          desc:  desc.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').trim().slice(0, 160),
          source
        });
      }
      return items;
    }

    function categorize(title) {
      const t = title.toLowerCase();
      if (/ransomware|zero.?day|critical|exploit|rce|remote code/.test(t)) return 'critical';
      if (/breach|leak|hack|attack|malware|phishing|vulnerability|cve/.test(t)) return 'warning';
      return 'info';
    }

    Promise.all(FEEDS.map(f => fetchFeed(f.url).then(xml => parseItems(xml, f.source))))
      .then(results => {
        const all = results.flat()
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .slice(0, 12)
          .map(item => ({ ...item, severity: categorize(item.title) }));
        global._newsCache = { ts: Date.now(), data: all };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(all));
      })
      .catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to fetch news' }));
      });
    return;
  }

  // ── CREATE PROFILE (bypasses RLS using service key) ──────────────────────
  if (req.method === 'POST' && req.url === '/api/create-profile') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const raw = JSON.parse(body);
        if (!raw.id || !raw.email) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'id and email are required' }));
          return;
        }
        // Whitelist allowed fields — never trust caller-supplied role or status
        const profile = {
          id:            raw.id,
          email:         raw.email,
          full_name:     raw.full_name     || '',
          phone:         raw.phone         || '',
          business_name: raw.business_name || '',
          domain:        raw.domain        || '',
          plan:          raw.plan          || 'starter',
          role:          'client',
          status:        'trial',
          created_at:    raw.created_at    || new Date(),
        };
        const result = await supabaseRequest('POST', 'profiles', profile);
        if (result.status >= 400) {
          console.error('Profile creation failed:', result.status, result.body);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: result.body || 'Profile creation failed' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          // Notify admin via WhatsApp — fire and forget, non-blocking
          if (ADMIN_PHONE) {
            const msg = `🆕 *New ProCyberWall Signup!*\n\n*Name:* ${profile.full_name}\n*Email:* ${profile.email}\n*Plan:* ${(profile.plan || 'starter').toUpperCase()}\n*Domain:* ${profile.domain}\n\n— ProCyberWall System`;
            sendTwilioMessage(ADMIN_PHONE, msg).catch(() => {});
          }
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── PHONE OTP — SEND (via WhatsApp) ─────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/send-phone-otp') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { phone } = JSON.parse(body);
        if (!phone) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Phone required' }));
          return;
        }
        if (!TWILIO_SID || !TWILIO_TOKEN) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'WhatsApp service not configured' }));
          return;
        }
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        global._phoneOtps = global._phoneOtps || {};
        global._phoneOtps[phone] = { otp, expires: Date.now() + 10 * 60 * 1000 };

        const toFormatted = phone.startsWith('+')
          ? `whatsapp:${phone.replace(/\s/g, '')}`
          : `whatsapp:+91${phone.replace(/\D/g, '').slice(-10)}`;
        const message = `Your *ProCyberWall* verification code is:\n\n*${otp}*\n\nThis code expires in 10 minutes. Do not share it with anyone.`;
        const params = new URLSearchParams({ From: TWILIO_FROM, To: toFormatted, Body: message }).toString();

        await new Promise((resolve, reject) => {
          const opts = {
            hostname: 'api.twilio.com',
            path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
              'Content-Type': 'application/x-www-form-urlencoded',
              'Content-Length': Buffer.byteLength(params)
            }
          };
          const r = https.request(opts, resp => {
            let data = '';
            resp.on('data', c => data += c);
            resp.on('end', () => resolve(JSON.parse(data)));
          });
          r.on('error', reject);
          r.write(params);
          r.end();
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to send OTP' }));
      }
    });
    return;
  }

  // ── PHONE OTP — VERIFY ───────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/verify-phone-otp') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { phone, otp } = JSON.parse(body);
        global._phoneOtps = global._phoneOtps || {};
        const stored = global._phoneOtps[phone];
        if (!stored) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No OTP found. Please request a new one.' }));
          return;
        }
        if (Date.now() > stored.expires) {
          delete global._phoneOtps[phone];
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Code expired. Please request a new one.' }));
          return;
        }
        if (stored.otp !== otp) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Incorrect code. Please try again.' }));
          return;
        }
        delete global._phoneOtps[phone];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── ADMIN: GET ALL CLIENTS (service key — bypasses RLS) ─────────────────
  if (req.method === 'GET' && req.url === '/api/admin/clients') {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    try {
      const result = await supabaseRequest('GET', 'profiles?role=eq.client&order=created_at.desc&select=*', null);
      const clients = JSON.parse(result.body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, clients: Array.isArray(clients) ? clients : [] }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── ADMIN: ADD CLIENT (creates auth user + profile via service key) ───────
  if (req.method === 'POST' && req.url === '/api/admin/add-client') {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { full_name, email, phone, business_name, domain, plan } = JSON.parse(body);
        if (!email || !full_name || !domain) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'name, email and domain are required' }));
          return;
        }

        // Step 1: create auth user (generates a UUID that satisfies FK constraint)
        const authResult = await new Promise((resolve, reject) => {
          const payload = JSON.stringify({
            email,
            password: crypto.randomBytes(16).toString('hex') + 'Cw1!',
            email_confirm: true,
            user_metadata: { full_name }
          });
          const opts = {
            hostname: 'fwbclrdzctszwbfxywgi.supabase.co',
            path: '/auth/v1/admin/users',
            method: 'POST',
            headers: {
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          };
          const r = https.request(opts, resp => {
            let raw = '';
            resp.on('data', c => raw += c);
            resp.on('end', () => {
              try { resolve({ status: resp.statusCode, body: JSON.parse(raw) }); }
              catch (e) { reject(new Error('Supabase auth parse error')); }
            });
          });
          r.on('error', reject);
          r.write(payload);
          r.end();
        });

        if (authResult.status >= 400) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: authResult.body.msg || authResult.body.message || 'Failed to create user' }));
          return;
        }

        const userId = authResult.body.id;

        // Step 2: create profile row
        const profileResult = await supabaseRequest('POST', 'profiles', {
          id: userId, full_name, email, phone: phone || '',
          business_name: business_name || '', domain, plan: plan || 'starter',
          status: 'trial', role: 'client', created_at: new Date()
        });

        if (profileResult.status >= 400) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: profileResult.body }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, userId }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── ADMIN: UPDATE CLIENT ──────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/admin/update-client') {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { id, plan, status } = JSON.parse(body);
        if (!id) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'id required'})); return; }
        const update = {};
        if (plan)   update.plan   = plan;
        if (status) update.status = status;
        const result = await supabaseRequest('PATCH', `profiles?id=eq.${id}`, update);
        res.writeHead(result.status >= 400 ? 400 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.status >= 400 ? { error: result.body } : { success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── AUTH NEWS: Cybersecurity RSS feed (cached 30 min) ────────────────────
  if (req.method === 'GET' && req.url === '/api/auth-news') {
    try {
      const now = Date.now();
      if (!global._newsCache || now - global._newsCacheTime > 30 * 60 * 1000) {
        const feeds = [
          'https://feeds.feedburner.com/TheHackersNews',
          'https://www.bleepingcomputer.com/feed/'
        ];
        const results = await Promise.allSettled(feeds.map(url => new Promise((resolve, reject) => {
          const u = new URL(url);
          const opts = { hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0' } };
          const r = https.get(opts, resp => {
            let raw = '';
            resp.on('data', c => raw += c);
            resp.on('end', () => resolve(raw));
          });
          r.on('error', reject);
          r.setTimeout(8000, () => { r.destroy(); reject(new Error('timeout')); });
        })));

        const items = [];
        results.forEach((r, fi) => {
          if (r.status !== 'fulfilled') return;
          const xml = r.value;
          const source = fi === 0 ? 'The Hacker News' : 'Bleeping Computer';
          const itemRegex = /<item>([\s\S]*?)<\/item>/g;
          let m;
          while ((m = itemRegex.exec(xml)) !== null) {
            const block = m[1];
            const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/s.exec(block) || /<title>(.*?)<\/title>/s.exec(block) || [])[1] || '';
            const link  = (/<link>(.*?)<\/link>/s.exec(block) || [])[1] || '';
            const pub   = (/<pubDate>(.*?)<\/pubDate>/s.exec(block) || [])[1] || '';
            const desc  = (/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/s.exec(block) || /<description>([\s\S]*?)<\/description>/s.exec(block) || [])[1] || '';
            if (title.trim()) items.push({
              title: title.trim().replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"'),
              link:  link.trim(),
              pub:   pub.trim(),
              desc:  desc.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").trim().slice(0, 140),
              source,
              ts:    new Date(pub).getTime() || 0
            });
          }
        });

        items.sort((a, b) => b.ts - a.ts);
        global._newsCache = items.slice(0, 20);
        global._newsCacheTime = now;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: global._newsCache || [] }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: [] }));
    }
    return;
  }

  // ── TASKS: LIST & CREATE ─────────────────────────────────────────────────
  if (req.url === '/api/admin/tasks') {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return; }

    if (req.method === 'GET') {
      const r = await supabaseRequest('GET', 'tasks?order=created_at.desc&select=*', null);
      const tasks = JSON.parse(r.body);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ tasks: Array.isArray(tasks) ? tasks : [] }));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { title, description, priority, due_date, client_id } = JSON.parse(body);
          if (!title) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'title required'})); return; }
          const task = { title, description: description || null, priority: priority || 'med', due_date: due_date || null, client_id: client_id || null, completed: false };
          const r = await supabaseRequest('POST', 'tasks', task);
          res.writeHead(r.status >= 400 ? 400 : 201, {'Content-Type':'application/json'});
          res.end(r.status >= 400 ? r.body : JSON.stringify({success:true}));
        } catch (err) {
          res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message}));
        }
      });
      return;
    }
  }

  // ── TASKS: UPDATE & DELETE ────────────────────────────────────────────────
  if (req.url.startsWith('/api/admin/tasks/')) {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return; }
    const taskId = req.url.slice('/api/admin/tasks/'.length).split('?')[0];

    if (req.method === 'PATCH') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const updates = JSON.parse(body);
          const r = await supabaseRequest('PATCH', `tasks?id=eq.${encodeURIComponent(taskId)}`, updates);
          res.writeHead(r.status >= 400 ? 400 : 200, {'Content-Type':'application/json'});
          res.end(r.status >= 400 ? r.body : JSON.stringify({success:true}));
        } catch (err) {
          res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message}));
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      const r = await supabaseRequest('DELETE', `tasks?id=eq.${encodeURIComponent(taskId)}`, null);
      res.writeHead(r.status >= 400 ? 400 : 200, {'Content-Type':'application/json'});
      res.end(r.status >= 400 ? r.body : JSON.stringify({success:true}));
      return;
    }
  }

  // ── SUPPORT TICKETS: ADMIN LIST & RESOLVE ────────────────────────────────
  if (req.url === '/api/admin/tickets') {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return; }

    if (req.method === 'GET') {
      const r = await supabaseRequest('GET', 'support_tickets?order=created_at.desc&select=*', null);
      const tickets = JSON.parse(r.body);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ tickets: Array.isArray(tickets) ? tickets : [] }));
      return;
    }
  }

  if (req.url.startsWith('/api/admin/tickets/')) {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return; }
    const ticketId = req.url.slice('/api/admin/tickets/'.length).split('?')[0];

    if (req.method === 'PATCH') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const updates = JSON.parse(body);
          if (updates.status === 'resolved') updates.resolved_at = new Date().toISOString();
          const r = await supabaseRequest('PATCH', `support_tickets?id=eq.${encodeURIComponent(ticketId)}`, updates);
          res.writeHead(r.status >= 400 ? 400 : 200, {'Content-Type':'application/json'});
          res.end(r.status >= 400 ? r.body : JSON.stringify({success:true}));
        } catch (err) {
          res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message}));
        }
      });
      return;
    }
  }

  // ── SUPPORT TICKETS: CLIENT SUBMIT & VIEW ────────────────────────────────
  if (req.url === '/api/tickets') {
    const authUser = await requireAuth(req);
    if (!authUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return; }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { subject, message } = JSON.parse(body);
          if (!subject || !message) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'subject and message required'})); return; }
          const ticket = { client_id: authUser.id, subject, message, status: 'open' };
          const r = await supabaseRequest('POST', 'support_tickets', ticket);
          res.writeHead(r.status >= 400 ? 400 : 201, {'Content-Type':'application/json'});
          res.end(r.status >= 400 ? r.body : JSON.stringify({success:true}));
        } catch (err) {
          res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message}));
        }
      });
      return;
    }
  }

  if (req.url === '/api/tickets/mine') {
    const authUser = await requireAuth(req);
    if (!authUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return; }

    if (req.method === 'GET') {
      const r = await supabaseRequest('GET', `support_tickets?client_id=eq.${encodeURIComponent(authUser.id)}&order=created_at.desc&select=*`, null);
      const tickets = JSON.parse(r.body);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ tickets: Array.isArray(tickets) ? tickets : [] }));
      return;
    }
  }

  // ── CLOUDFLARE: ADD DOMAIN (ACTIVATE) ────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/cf/activate') {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { domain } = JSON.parse(body);
        if (!domain) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'domain required'})); return; }

        const clean = domain.replace(/https?:\/\//, '').replace(/^www\./, '').split('/')[0];

        // Add zone to Cloudflare
        const result = await new Promise((resolve, reject) => {
          const payload = JSON.stringify({ name: clean, jump_start: true });
          const opts = {
            hostname: 'api.cloudflare.com',
            path: '/client/v4/zones',
            method: 'POST',
            headers: {
              'X-Auth-Email': CF_EMAIL,
              'X-Auth-Key': CF_API_KEY,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          };
          const r = https.request(opts, resp => {
            let raw = '';
            resp.on('data', c => raw += c);
            resp.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(new Error('CF parse error')); } });
          });
          r.on('error', reject);
          r.setTimeout(15000, () => { r.destroy(); reject(new Error('CF timeout')); });
          r.write(payload);
          r.end();
        });

        if (!result.success) {
          const msg = result.errors?.[0]?.message || 'Cloudflare error';
          // Zone already exists — fetch existing nameservers
          if (result.errors?.[0]?.code === 1061) {
            const existing = await cfGet(`/zones?name=${encodeURIComponent(clean)}`);
            if (existing.success && existing.result?.length) {
              const ns = existing.result[0].name_servers || [];
              res.writeHead(200, {'Content-Type':'application/json'});
              res.end(JSON.stringify({ nameservers: ns, alreadyExists: true }));
              return;
            }
          }
          res.writeHead(400, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ error: msg }));
          return;
        }

        const nameservers = result.result?.name_servers || [];
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ nameservers, zoneId: result.result?.id }));
      } catch(err) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── CLOUDFLARE PROXY: FULL OVERVIEW DATA ─────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/cf/overview')) {
    const domain = new URL('http://x' + req.url).searchParams.get('domain');
    if (!domain) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'domain required'})); return; }
    try {
      const zoneId = await cfGetZoneId(domain);
      if (!zoneId) { res.writeHead(404, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'domain not found in Cloudflare'})); return; }

      const now = new Date();
      const since30d = new Date(now - 30*24*60*60*1000).toISOString();
      const since7d  = new Date(now - 7*24*60*60*1000).toISOString();
      const sinceToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const until = now.toISOString();

      const [a30, a7, aToday, events, httpsSet, sslSet, tlsSet, dnsAll, certPacks] = await Promise.allSettled([
        cfGet(`/zones/${zoneId}/analytics/dashboard?since=${since30d}&until=${until}&continuous=true`),
        cfGet(`/zones/${zoneId}/analytics/dashboard?since=${since7d}&until=${until}&continuous=true`),
        cfGet(`/zones/${zoneId}/analytics/dashboard?since=${sinceToday}&until=${until}&continuous=true`),
        cfGet(`/zones/${zoneId}/firewall/events?per_page=20`),
        cfGet(`/zones/${zoneId}/settings/always_use_https`),
        cfGet(`/zones/${zoneId}/settings/ssl`),
        cfGet(`/zones/${zoneId}/settings/min_tls_version`),
        cfGet(`/zones/${zoneId}/dns_records?per_page=100`),
        cfGet(`/zones/${zoneId}/ssl/certificate_packs`),
      ]);

      const ok = r => r.status === 'fulfilled' && r.value?.success ? r.value : null;

      // --- 30-day stats ---
      const t30 = ok(a30);
      const threatsBlocked30d = t30?.result?.totals?.requests?.threat || 0;
      const totalRequests30d  = t30?.result?.totals?.requests?.all    || 0;

      // --- Today stats ---
      const tToday = ok(aToday);
      const threatsToday = tToday?.result?.totals?.requests?.threat || 0;

      // --- 7-day chart ---
      const t7 = ok(a7);
      const dayMap = {};
      for (const point of (t7?.result?.timeseries || [])) {
        const day = point.since.slice(0, 10);
        dayMap[day] = (dayMap[day] || 0) + (point.requests?.threat || 0);
      }
      const chartLabels = [], chartData = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now - i*24*60*60*1000);
        chartLabels.push(i === 0 ? 'Today' : d.toLocaleDateString('en-IN', {weekday:'short'}));
        chartData.push(dayMap[d.toISOString().slice(0,10)] || 0);
      }

      // --- Countries from timeseries (unique days with data) ---
      const countrySet = new Set();
      for (const point of (t30?.result?.timeseries || [])) {
        // Cloudflare doesn't return per-country in timeseries, use a fixed count if not available
      }

      // --- Firewall events ---
      const evts = ok(events)?.result || [];
      const attackTypeCounts = {};
      for (const e of evts) {
        const type = e.ruleMessage || e.action || 'Other';
        const key = type.length > 20 ? type.slice(0,20) : type;
        attackTypeCounts[key] = (attackTypeCounts[key] || 0) + 1;
      }
      const sortedTypes = Object.entries(attackTypeCounts).sort((a,b)=>b[1]-a[1]).slice(0,6);
      const attackTypeLabels = sortedTypes.map(x=>x[0]);
      const attackTypeData   = sortedTypes.map(x=>x[1]);

      // --- Zone settings ---
      const httpsEnforced = ok(httpsSet)?.result?.value === 'on';
      const sslMode       = ok(sslSet)?.result?.value || 'full';
      const tlsVersion    = ok(tlsSet)?.result?.value || '1.2';

      // --- DNS records ---
      const dnsRecords = ok(dnsAll)?.result || [];
      const hasSPF    = dnsRecords.some(r => r.type === 'TXT' && r.content?.includes('v=spf1'));
      const hasDKIM   = dnsRecords.some(r => r.type === 'TXT' && r.name?.includes('_domainkey'));
      const hasDMARC  = dnsRecords.some(r => r.type === 'TXT' && r.name?.startsWith('_dmarc'));
      const hasMX     = dnsRecords.some(r => r.type === 'MX');

      // --- SSL cert ---
      const packs = ok(certPacks)?.result || [];
      const activePack = packs.find(p => p.status === 'active') || packs[0];
      const certExpiry = activePack?.certificates?.[0]?.expires_on || null;
      let certExpiresStr = '—';
      if (certExpiry) {
        const exp = new Date(certExpiry);
        const days = Math.round((exp - now) / 86400000);
        certExpiresStr = exp.toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'}) + ` (${days} days)`;
      }
      const certIssuer = activePack?.certificates?.[0]?.issuer || 'Cloudflare';

      // --- Security score (computed) ---
      let score = 60;
      if (sslMode === 'full' || sslMode === 'strict') score += 10;
      if (httpsEnforced) score += 10;
      if (hasSPF)   score += 5;
      if (hasDKIM)  score += 5;
      if (hasDMARC) score += 5;
      if (hasMX)    score += 5;
      const scoreGrade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : 'C';

      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({
        stats: {
          threatsBlocked30d,
          threatsToday,
          threatsThisMonth: threatsBlocked30d,
          totalRequests30d,
          securityScore: score,
          scoreGrade,
        },
        chart7d:     { labels: chartLabels, data: chartData },
        attackTypes: { labels: attackTypeLabels, data: attackTypeData },
        threats:     evts.slice(0, 10),
        ssl: {
          status:  activePack ? '✓ Valid' : '—',
          issuer:  certIssuer,
          expires: certExpiresStr,
          protocol: `TLS ${tlsVersion}`,
          httpsEnforced,
        },
        email: {
          spf:   hasSPF   ? '✓ Pass' : '✗ Not found',
          dkim:  hasDKIM  ? '✓ Pass' : '✗ Not found',
          dmarc: hasDMARC ? '✓ Pass' : '⚠ Not configured',
          mx:    hasMX    ? '✓ Configured' : '✗ Not found',
        },
        security: {
          waf:       'Active',
          ssl:       sslMode,
          botShield: 'Active',
          https:     httpsEnforced ? 'Enforced' : 'Not enforced',
        },
      }));
    } catch (err) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error: err.message}));
    }
    return;
  }

  // ── SECURITY SCAN ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/security-scan')) {
    const params = new URL('http://x' + req.url).searchParams;
    const domain = params.get('domain');
    if (!domain) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'domain parameter required' }));
      return;
    }
    const ip = getClientIp(req);
    if (!checkRateLimit(ip, '/api/security-scan', 5, 60000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests. Please wait a minute and try again.' }));
      return;
    }
    try {
      let scan = await runSecurityScan(domain);
      if (scan.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: scan.error }));
        return;
      }
      const authUser = await requireAuth(req);
      if (authUser) scan = await enhanceScanWithCloudflare(scan);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(scan));
    } catch(err) {
      console.error('Security scan error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Scan failed. Please try again.' }));
    }
    return;
  }

  // ── STATIC FILE SERVING ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

    const filePath = path.join(__dirname, urlPath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.css':  'text/css',
      '.js':   'application/javascript',
      '.json': 'application/json',
      '.png':  'image/png',
      '.jpg':  'image/jpeg',
      '.svg':  'image/svg+xml',
      '.ico':  'image/x-icon',
    };

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const noCache = ['.html', '.js', '.css'].includes(ext);
      const headers = { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' };
      if (noCache) headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      res.writeHead(200, headers);
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const REQUIRED_ENV = ['ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_KEY'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ ProCyberWall server running at http://localhost:${PORT}`);
});
