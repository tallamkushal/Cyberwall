const http  = require('http');
const https = require('https');
const dns   = require('dns').promises;
const { cfGet, cfGetZoneId } = require('./cloudflare');

// ── Email / DNS security check ────────────────────────────────────────────
async function checkEmailSecurity(hostname) {
  const result = { spf: false, dmarc: false, dmarcPolicy: null, dkim: false, dkimSelector: null };

  await Promise.allSettled([
    // SPF — TXT record on apex containing v=spf1
    dns.resolveTxt(hostname).then(records => {
      const flat = records.map(r => r.join('')).join('\n').toLowerCase();
      result.spf = flat.includes('v=spf1');
    }),
    // DMARC — TXT record on _dmarc.domain
    dns.resolveTxt('_dmarc.' + hostname).then(records => {
      const flat = records.map(r => r.join('')).join('\n').toLowerCase();
      if (flat.includes('v=dmarc1')) {
        result.dmarc = true;
        const pMatch = flat.match(/p=(reject|quarantine|none)/);
        result.dmarcPolicy = pMatch ? pMatch[1] : 'none';
      }
    }),
    // DKIM — try common selectors (best-effort; selector is not publicly discoverable)
    (async () => {
      for (const sel of ['default', 'google', 'mail', 'selector1', 'selector2', 'k1', 'dkim']) {
        try {
          const r = await dns.resolveTxt(`${sel}._domainkey.${hostname}`);
          if (r.some(arr => arr.join('').toLowerCase().includes('v=dkim1'))) {
            result.dkim = true; result.dkimSelector = sel; break;
          }
        } catch(_) {}
      }
    })(),
  ]);

  return result;
}

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

  const [httpsApex, httpsWww, emailSec] = await Promise.all([
    probeDomain(hostname, true),
    probeDomain('www.' + hostname, true),
    checkEmailSecurity(hostname),
  ]);
  const httpsResult = httpsApex.success ? httpsApex : (httpsWww.success ? httpsWww : httpsApex);
  const httpResult  = await probeDomain(hostname, false);

  // If we can't reach the domain at all, return a clear error immediately
  if (!httpsResult.success && !httpResult.success) {
    return { error: `Could not reach "${hostname}". Make sure the domain exists and is spelled correctly.` };
  }

  const certInfo     = httpsResult.certInfo;
  const httpsEnabled = httpsResult.success;
  const certValid    = certInfo?.authorized === true;
  let certExpiresInDays = null;
  if (certInfo?.validTo) {
    try { certExpiresInDays = Math.floor((new Date(certInfo.validTo) - Date.now()) / 86400000); } catch(e) {}
  }

  // Merge headers from all successful probes so CDN / security-header
  // detection doesn't depend on which probe happened to win the race.
  const headers = {
    ...(httpsApex.success  ? httpsApex.headers  || {} : {}),
    ...(httpsWww.success   ? httpsWww.headers   || {} : {}),
    ...(httpResult.success ? httpResult.headers  || {} : {}),
  };
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

  // ── Scoring (total max = 100) ──────────────────────────────────────────
  // https: 20  headers: 30  redirects: 10  protection: 15  reliability: 10  email: 15
  let httpsScore = 0;
  if (httpsEnabled) httpsScore += 8;
  if (certValid)    httpsScore += 8;
  if (certExpiresInDays !== null && certExpiresInDays > 30) httpsScore += 4;

  const hasAnyResponse = httpsResult.success || httpResult.success;

  const HEADER_CHECKS_SCORED = [
    { key: 'content-security-policy',   pts: 8 },
    { key: 'strict-transport-security', pts: 6 },
    { key: 'x-frame-options',           pts: 5 },
    { key: 'x-content-type-options',    pts: 4 },
    { key: 'referrer-policy',           pts: 4 },
    { key: 'permissions-policy',        pts: 3 },
  ];
  // Recompute headersScore with updated weights (max 30)
  headersScore = 0;
  for (const c of HEADER_CHECKS_SCORED) { if (headers[c.key]) headersScore += c.pts; }

  let redirectScore = 0;
  if (httpToHttps) redirectScore += 7;
  else if (!httpResult.success && httpsEnabled) redirectScore += 4;
  if (hasAnyResponse) redirectScore += 3;

  let protectionScore = 0;
  if (cdnDetected) protectionScore += 10;
  if (hasAnyResponse && !serverLeaksVersion) protectionScore += 5;

  // Reliability: binary up/down (response time varies per scan — not scored)
  let reliabilityScore = 0;
  if (httpsEnabled || httpResult.success) reliabilityScore = 10;

  // Email security (SPF + DMARC + DKIM) — max 15
  let emailScore = 0;
  if (emailSec.spf)   emailScore += 5;
  if (emailSec.dmarc) emailScore += 4;
  if (emailSec.dmarcPolicy === 'reject')     emailScore += 4;
  else if (emailSec.dmarcPolicy === 'quarantine') emailScore += 2;
  if (emailSec.dkim)  emailScore += 2;

  const totalScore = httpsScore + headersScore + redirectScore + protectionScore + reliabilityScore + emailScore;

  const issues = [], passedChecks = [], unknownChecks = [];

  if (httpsEnabled)  passedChecks.push({ label: 'Website connection is secure', icon: '🔒', desc: '<strong>HTTPS (HyperText Transfer Protocol Secure)</strong> — Every time a customer visits your website, the information they type — like their name, phone number, or payment details — is encrypted and cannot be read by anyone else. Customers see a lock icon in their browser.' });
  else if (hasAnyResponse) issues.push({ severity: 'critical', label: 'Website connection is NOT secure (No HTTPS)', detail: 'Your website runs on HTTP, not HTTPS. Anyone between your customer and your website can read their passwords and personal details. Customers will see a "Not Secure" warning in their browser.' });
  else unknownChecks.push('HTTPS check (website could not be reached)');

  if (certValid) passedChecks.push({ label: 'Security certificate is working', icon: '✅', desc: '<strong>SSL/TLS Certificate</strong> — Your website has a valid certificate issued by a trusted authority. This is like an official ID card for your website that proves to browsers and customers that your site is genuine and has not been faked.' });
  else if (httpsEnabled) issues.push({ severity: 'critical', label: 'SSL/TLS certificate has a problem', detail: 'Your SSL certificate is invalid or untrusted. Every customer who visits your website right now sees a scary browser warning page. Most will leave immediately.' });
  else unknownChecks.push('SSL/TLS certificate check');

  if (certExpiresInDays !== null) {
    if (certExpiresInDays > 30) passedChecks.push({ label: `Security certificate good for ${certExpiresInDays} more days`, icon: '📅', desc: `<strong>SSL Certificate Expiry</strong> — Your SSL/TLS certificate is valid and does not need renewal yet. ProCyberWall will alert you before it expires so your customers never see a browser warning.` });
    else if (certExpiresInDays > 0) issues.push({ severity: 'high', label: `SSL certificate expires in ${certExpiresInDays} days`, detail: 'When your SSL certificate expires, customers will see a scary browser warning and your website will look unsafe. Renew it before it expires.' });
    else issues.push({ severity: 'critical', label: 'SSL certificate has expired', detail: 'Your SSL/TLS certificate has expired. Your website is showing security error warnings to every visitor right now. They cannot safely use your site.' });
  } else if (httpsEnabled) unknownChecks.push('SSL certificate expiry date');

  if (hasAnyResponse) {
    if (headers['strict-transport-security']) passedChecks.push({ label: 'Always uses secure connection', icon: '🔐', desc: '<strong>HSTS (HTTP Strict Transport Security)</strong> — This header tells browsers to always use HTTPS, even if a customer types "http://" by mistake. No customer ever lands on an unsafe version of your site.' });
    else issues.push({ severity: 'medium', label: 'HSTS not enabled — secure connection not always forced', detail: 'Without the HSTS header, a hacker can sometimes intercept and downgrade your customer\'s connection to the unsafe HTTP version of your website.' });

    if (headers['content-security-policy']) passedChecks.push({ label: 'Protection against fake content injection', icon: '🛡️', desc: '<strong>CSP (Content Security Policy)</strong> — This header tells browsers exactly which content is allowed on your page. Hackers cannot inject fake buttons, fake login forms, or malicious scripts onto your website pages. Your customers only see what you put there.' });
    else issues.push({ severity: 'medium', label: 'No CSP — hackers can inject fake content on your pages', detail: 'Without a Content Security Policy header, hackers can use XSS (Cross-Site Scripting) attacks to make fake login forms or buttons appear on your website to steal customer details.' });

    if (headers['x-frame-options']) passedChecks.push({ label: 'Protection against fake lookalike pages', icon: '🖼️', desc: '<strong>X-Frame-Options header</strong> — This prevents your website from being loaded inside another website\'s frame or iframe. It stops a Clickjacking attack, where criminals copy your site inside a fake one to trick customers.' });
    else issues.push({ severity: 'low', label: 'No X-Frame-Options — Clickjacking risk', detail: 'Without this header, criminals can embed your website inside their fake website using an iframe. Customers think they are on your site but are actually being tricked into giving money or passwords to criminals.' });

    if (headers['x-content-type-options']) passedChecks.push({ label: 'Protection against hidden file attacks', icon: '📄', desc: '<strong>X-Content-Type-Options header</strong> — This tells browsers not to guess the type of a file and just run it. It stops MIME-sniffing attacks, where a hacker uploads a harmful file disguised as something safe (like an image) and tricks the browser into running it.' });
    else issues.push({ severity: 'low', label: 'No X-Content-Type-Options — MIME sniffing risk', detail: 'Without this header, a hacker could upload a harmful script disguised as an image or document on your website and trick browsers into executing it.' });

    if (headers['referrer-policy']) passedChecks.push({ label: 'Customer browsing info is private', icon: '🔗', desc: '<strong>Referrer-Policy header</strong> — Controls what URL information is shared when a customer clicks a link from your website to another site. Protects customer privacy and prevents internal page paths from leaking to third-party sites.' });
    else issues.push({ severity: 'low', label: 'No Referrer-Policy — browsing info may leak', detail: 'Without this header, when a customer clicks a link from your site to another, their full URL path is shared with that site. This can leak internal page names and customer session info to third parties.' });

    if (headers['permissions-policy']) passedChecks.push({ label: 'Website feature access is controlled', icon: '🎛️', desc: '<strong>Permissions-Policy header</strong> (formerly Feature-Policy) — Restricts which browser features your website can use, like camera, microphone, or location. This stops any injected malicious code from secretly accessing your customers\' device features.' });
    else issues.push({ severity: 'low', label: 'No Permissions-Policy — browser features unrestricted', detail: 'Without this header, any malicious script injected into your site could silently access your customers\' camera, microphone, or location. Adding this header locks down which browser features your site is allowed to use.' });
  } else {
    unknownChecks.push('HSTS', 'Content Security Policy', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy');
  }

  if (httpToHttps) passedChecks.push({ label: 'All visitors automatically get the safe version', icon: '↪️', desc: '<strong>HTTP → HTTPS redirect</strong> — Your server automatically redirects anyone who visits "http://" to the secure "https://" version. No matter how a customer types your address, they always land on the encrypted version.' });
  else if (httpResult.success) issues.push({ severity: 'medium', label: 'No HTTP → HTTPS redirect configured', detail: 'Customers who type your address without "https://" reach an unencrypted version of your site. This is a simple server configuration fix that ProCyberWall can set up for you.' });
  else unknownChecks.push('HTTP to HTTPS redirect');

  if (cdnDetected) passedChecks.push({ label: `Protected by ${cdnProvider} firewall`, icon: '🛡️', desc: `<strong>Firewall / CDN via ${cdnProvider}</strong> — Your website traffic passes through ${cdnProvider}'s global network, which filters out hackers, bots, and DDoS attacks before they ever reach your server.` });
  else if (hasAnyResponse) issues.push({ severity: 'high', label: 'No firewall detected — no firewall protection', detail: 'Your website server is directly exposed to the internet with no firewall. Hackers, bots, and DDoS attacks hit your server directly. ProCyberWall adds a firewall to block these for you.' });
  else unknownChecks.push('Firewall / CDN detection (could not reach website)');

  if (hasAnyResponse) {
    if (!serverLeaksVersion) passedChecks.push({ label: 'Server software details are hidden', icon: '👁️', desc: '<strong>Server header / version disclosure</strong> — Your website does not reveal what server software it runs (e.g. Apache 2.4, Nginx 1.18). Hiding this makes it harder for hackers to look up known vulnerabilities specific to your software version.' });
    else issues.push({ severity: 'low', label: `Server version exposed in HTTP headers (${serverHdr})`, detail: `Your server is revealing its software and version in the HTTP "Server" header. Hackers can look up known CVEs (security vulnerabilities) for exactly this version and exploit them.` });
  } else {
    unknownChecks.push('Server version disclosure (could not reach website)');
  }

  // ── Email security checks ─────────────────────────────────────────────
  if (emailSec.spf) {
    passedChecks.push({ label: 'SPF record configured — email spoofing blocked', icon: '📧', desc: '<strong>SPF (Sender Policy Framework)</strong> — A DNS record that tells the world which servers are allowed to send email on behalf of your domain. Without it, anyone can send fake emails pretending to be from your business to scam your customers.' });
  } else {
    issues.push({ severity: 'high', label: 'No SPF record — your domain can be used to send fake emails', detail: 'Without an SPF record, hackers can send emails pretending to be from your business email address. Your customers could receive scam emails that look like they came from you. ProCyberWall can help you set this up.' });
  }

  if (emailSec.dmarc) {
    const policyLabel = emailSec.dmarcPolicy === 'reject' ? 'reject (strongest)' : emailSec.dmarcPolicy === 'quarantine' ? 'quarantine' : 'none (monitoring only)';
    if (emailSec.dmarcPolicy === 'none') {
      passedChecks.push({ label: `DMARC configured (policy: ${policyLabel})`, icon: '📬', desc: '<strong>DMARC (Domain-based Message Authentication)</strong> — Your DMARC record exists but is set to "none", which means it only monitors and does not block fake emails. Upgrading to "quarantine" or "reject" will actively stop spoofed emails.' });
      issues.push({ severity: 'low', label: 'DMARC policy is "none" — fake emails are not being blocked', detail: 'Your DMARC record is set to monitoring mode (p=none). It collects data but does not stop fake emails. Change it to p=quarantine or p=reject to actively block email spoofing of your domain.' });
    } else {
      passedChecks.push({ label: `DMARC configured — fake emails blocked (policy: ${policyLabel})`, icon: '📬', desc: `<strong>DMARC (Domain-based Message Authentication)</strong> — Your DMARC policy is set to "${emailSec.dmarcPolicy}", which actively blocks or quarantines emails that fail authentication. This prevents criminals from sending convincing fake emails using your domain name.` });
    }
  } else {
    issues.push({ severity: 'high', label: 'No DMARC record — no policy against fake emails from your domain', detail: 'Without DMARC, email providers like Gmail and Outlook have no instructions on what to do with fake emails sent from your domain. Criminals can impersonate your business in emails to your customers, suppliers, or bank.' });
  }

  if (emailSec.dkim) {
    passedChecks.push({ label: `DKIM signing active (selector: ${emailSec.dkimSelector})`, icon: '✍️', desc: '<strong>DKIM (DomainKeys Identified Mail)</strong> — Your emails are digitally signed so recipients can verify the email genuinely came from your server and was not tampered with in transit. This is a key part of email trust.' });
  } else {
    issues.push({ severity: 'low', label: 'DKIM not detected on common selectors', detail: 'DKIM adds a digital signature to your outgoing emails so receiving mail servers can verify they are genuine. We checked common selectors and found none — your email provider may use a custom one, or DKIM may not be configured.' });
  }

  const SEV = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => (SEV[a.severity] || 9) - (SEV[b.severity] || 9));

  const result = {
    domain: hostname, scannedAt: new Date().toISOString(),
    numericScore: totalScore, grade: getSecurityGrade(totalScore),
    confidence: httpsEnabled ? 'high' : (httpResult.success ? 'medium' : 'low'),
    breakdown: {
      https:       { score: httpsScore,        max: 20, label: 'Safe connection for customers',       about: '<strong>HTTPS / SSL / TLS</strong> — Checks whether your website encrypts data between your customers and your server. If this score is low, customer data like passwords and phone numbers can be stolen in transit.' },
      headers:     { score: headersScore,      max: 30, label: 'Protection from common attacks',      about: '<strong>HTTP Security Headers</strong> (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) — The biggest part of your score. These are instructions your server sends to browsers to block the most common attack types — XSS, Clickjacking, MIME sniffing, and more.' },
      redirects:   { score: redirectScore,     max: 10, label: 'All visitors reach the safe version', about: '<strong>HTTP → HTTPS redirect / HSTS preload</strong> — Checks that every visitor always lands on the encrypted HTTPS version of your site. A low score means some customers reach an unencrypted HTTP page without knowing.' },
      protection:  { score: protectionScore,   max: 15, label: 'Firewall & hidden server details',    about: '<strong>Firewall / CDN / Server header disclosure</strong> — Checks whether a firewall is blocking attacks before they hit your server, and whether your server software version is hidden. Exposed server details help hackers find and use known CVEs (vulnerabilities).' },
      reliability: { score: reliabilityScore,  max: 10, label: 'Website is up and responding',        about: '<strong>Uptime</strong> — Checks whether your website is online and reachable. An unreachable site drives customers away and hurts your search rankings.' },
      email:       { score: emailScore,        max: 15, label: 'Email security (SPF / DMARC / DKIM)', about: '<strong>Email Security</strong> — SPF, DMARC, and DKIM are DNS records that stop criminals from sending fake emails pretending to be from your business. Without these, hackers can email your customers, suppliers, or bank impersonating you.' },
    },
    issues, passedChecks, unknownChecks, headersFound, headersMissing,
    emailSec,
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
    if (wafActive)               { managedBonus += 8; managedChecks.push({ label: 'OWASP firewall rules active', icon: '⚔️' }); }

    const enhancedScore = Math.min(100, scan.numericScore + managedBonus);
    return { ...scan, managed: true, numericScore: enhancedScore, grade: getSecurityGrade(enhancedScore), managedBonus, managedChecks };
  } catch(e) { return scan; }
}

module.exports = { normalizeScanDomain, getSecurityGrade, probeDomain, runSecurityScan, enhanceScanWithCloudflare };
