const http  = require('http');
const https = require('https');
const { cfGet, cfGetZoneId } = require('./cloudflare');

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

  const hasAnyResponse = httpsResult.success || httpResult.success;

  let redirectScore = 0;
  if (httpToHttps) redirectScore += 10;
  else if (!httpResult.success && httpsEnabled) redirectScore += 5; // HTTPS-only is fine
  if (hasAnyResponse) redirectScore += 5; // baseline only if we actually reached the server

  let protectionScore = 0;
  if (cdnDetected) protectionScore += 10;
  if (hasAnyResponse && !serverLeaksVersion) protectionScore += 5;

  let reliabilityScore = 0;
  if (httpsEnabled || httpResult.success) reliabilityScore += 7;
  if ((httpsResult.ms || 9999) < 2000) reliabilityScore += 3;

  const totalScore = httpsScore + headersScore + redirectScore + protectionScore + reliabilityScore;

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

  const SEV = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => (SEV[a.severity] || 9) - (SEV[b.severity] || 9));

  const result = {
    domain: hostname, scannedAt: new Date().toISOString(),
    numericScore: totalScore, grade: getSecurityGrade(totalScore),
    confidence: httpsEnabled ? 'high' : (httpResult.success ? 'medium' : 'low'),
    breakdown: {
      https:       { score: httpsScore,        max: 25, label: 'Safe connection for customers',       about: '<strong>HTTPS / SSL / TLS</strong> — Checks whether your website encrypts data between your customers and your server. If this score is low, customer data like passwords and phone numbers can be stolen in transit.' },
      headers:     { score: headersScore,      max: 35, label: 'Protection from common attacks',      about: '<strong>HTTP Security Headers</strong> (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) — The biggest part of your score. These are instructions your server sends to browsers to block the most common attack types — XSS, Clickjacking, MIME sniffing, and more.' },
      redirects:   { score: redirectScore,     max: 15, label: 'All visitors reach the safe version', about: '<strong>HTTP → HTTPS redirect / HSTS preload</strong> — Checks that every visitor always lands on the encrypted HTTPS version of your site. A low score means some customers reach an unencrypted HTTP page without knowing.' },
      protection:  { score: protectionScore,   max: 15, label: 'Firewall & hidden server details',    about: '<strong>Firewall / CDN / Server header disclosure</strong> — Checks whether a firewall is blocking attacks before they hit your server, and whether your server software version is hidden. Exposed server details help hackers find and use known CVEs (vulnerabilities).' },
      reliability: { score: reliabilityScore,  max: 10, label: 'Website is up and fast',              about: '<strong>Uptime / Response time</strong> — Checks whether your website is online and responding quickly. A slow or unreachable site drives customers away and hurts your business reputation and search rankings.' },
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
    if (wafActive)               { managedBonus += 8; managedChecks.push({ label: 'OWASP firewall rules active', icon: '⚔️' }); }

    const enhancedScore = Math.min(100, scan.numericScore + managedBonus);
    return { ...scan, managed: true, numericScore: enhancedScore, grade: getSecurityGrade(enhancedScore), managedBonus, managedChecks };
  } catch(e) { return scan; }
}

module.exports = { normalizeScanDomain, getSecurityGrade, probeDomain, runSecurityScan, enhanceScanWithCloudflare };
