const http  = require('http');
const https = require('https');
const { requireAuth } = require('../lib/auth');
const { supabaseRequest } = require('../lib/supabase');
const { sendTwilioMessage, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM } = require('../lib/twilio');
const { getClientIp, checkRateLimit } = require('../lib/rateLimit');
const { runSecurityScan, enhanceScanWithCloudflare } = require('../lib/scanner');
const { cfGet, cfGetZoneId } = require('../lib/cloudflare');
const { createAlert } = require('../lib/alerts');

const ADMIN_PHONE = process.env.ADMIN_PHONE || '';
const HIBP_API_KEY = process.env.HIBP_API_KEY || '';

async function handle(req, res, parsedUrl) {
  // ── WHATSAPP SEND ───────────────────────────────────────────────────────────
  if (req.method === 'POST' && (req.url === '/api/whatsapp' || req.url === '/.netlify/functions/send-whatsapp')) {
    const authUser = await requireAuth(req);
    if (!authUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }
    const ip = getClientIp(req);
    if (!checkRateLimit(ip, '/api/whatsapp', 10, 60000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return true;
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
    return true;
  }

  // ── CYBER NEWS FEED ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/cyber-news') {
    const FEEDS = [
      { url: 'https://feeds.feedburner.com/TheHackersNews',  source: 'The Hacker News' },
      { url: 'https://www.bleepingcomputer.com/feed/',        source: 'BleepingComputer' },
      { url: 'https://krebsonsecurity.com/feed/',             source: 'Krebs on Security' },
      { url: 'https://www.darkreading.com/rss.xml',           source: 'Dark Reading' },
      { url: 'https://www.securityweek.com/feed/',            source: 'SecurityWeek' },
      { url: 'https://www.hackerone.com/blog.rss',            source: 'HackerOne' },
      { url: 'https://isc.sans.edu/rssfeed_full.xml',         source: 'SANS ISC' },
    ];

    const cache = global._newsCache;
    if (cache && Date.now() - cache.ts < 15 * 60 * 1000) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cache.data));
      return true;
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
          .slice(0, 40)
          .map(item => ({ ...item, severity: categorize(item.title) }));
        global._newsCache = { ts: Date.now(), data: all };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(all));
      })
      .catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to fetch news' }));
      });
    return true;
  }

  // ── AUTH NEWS (cached daily) ────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/auth-news') {
    try {
      const todayKey = new Date().toISOString().slice(0, 10);
      if (!global._newsCache || global._newsCacheDay !== todayKey) {
        const feeds = [
          { url: 'https://feeds.feedburner.com/TheHackersNews',         source: 'The Hacker News' },
          { url: 'https://www.bleepingcomputer.com/feed/',               source: 'Bleeping Computer' },
          { url: 'https://krebsonsecurity.com/feed/',                    source: 'Krebs on Security' },
          { url: 'https://www.darkreading.com/rss.xml',                  source: 'Dark Reading' },
          { url: 'https://www.securityweek.com/feed/',                   source: 'SecurityWeek' },
          { url: 'https://isc.sans.edu/rssfeed_full.xml',                source: 'SANS ISC' },
          { url: 'https://feeds.feedburner.com/Securityweek',            source: 'SecurityWeek' },
          { url: 'https://cyberscoop.com/feed/',                         source: 'CyberScoop' },
        ];

        function fetchFeed(url) {
          return new Promise((resolve, reject) => {
            const u = new URL(url);
            const opts = { hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProCyberWall/1.0)' } };
            const r = https.get(opts, resp => {
              if (resp.statusCode === 301 || resp.statusCode === 302) {
                const loc = resp.headers.location;
                if (loc) return fetchFeed(loc).then(resolve).catch(reject);
              }
              let raw = '';
              resp.on('data', c => raw += c);
              resp.on('end', () => resolve(raw));
            });
            r.on('error', reject);
            r.setTimeout(8000, () => { r.destroy(); reject(new Error('timeout')); });
          });
        }

        function parseItems(xml, source) {
          const out = [];
          const itemRegex = /<item>([\s\S]*?)<\/item>/g;
          let m;
          while ((m = itemRegex.exec(xml)) !== null) {
            const block = m[1];
            const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/s.exec(block) || /<title>(.*?)<\/title>/s.exec(block) || [])[1] || '';
            const link  = (/<link>(.*?)<\/link>/s.exec(block) || [])[1] || '';
            const pub   = (/<pubDate>(.*?)<\/pubDate>/s.exec(block) || [])[1] || '';
            const desc  = (/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/s.exec(block) || /<description>([\s\S]*?)<\/description>/s.exec(block) || [])[1] || '';
            const clean = s => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&#\d+;/g,'');
            const t = clean(title.trim());
            if (t) out.push({
              title: t,
              link:  link.trim(),
              pub:   pub.trim(),
              desc:  clean(desc.replace(/<[^>]+>/g,'')).trim().slice(0, 150),
              source,
              ts:    new Date(pub).getTime() || 0
            });
          }
          return out;
        }

        const results = await Promise.allSettled(feeds.map(f => fetchFeed(f.url).then(xml => parseItems(xml, f.source))));

        const items = [];
        results.forEach(r => { if (r.status === 'fulfilled') items.push(...r.value); });

        items.sort((a, b) => b.ts - a.ts);
        const seen = new Set();
        const deduped = items.filter(i => {
          const key = i.title.slice(0, 60).toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        global._newsCache    = deduped.slice(0, 40);
        global._newsCacheDay = todayKey;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: global._newsCache || [] }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: [] }));
    }
    return true;
  }

  // ── CREATE PROFILE (bypasses RLS using service key) ─────────────────────────
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
        const bodyStr = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
        const isDuplicate = result.status === 409 || (result.status >= 400 && (bodyStr.includes('duplicate') || bodyStr.includes('already exists') || bodyStr.includes('unique')));
        if (result.status >= 400 && !isDuplicate) {
          console.error('Profile creation failed:', result.status, result.body);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: bodyStr || 'Profile creation failed' }));
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
    return true;
  }

  // ── PHONE OTP — SEND (via WhatsApp) ─────────────────────────────────────────
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

        const message = `Your *ProCyberWall* verification code is:\n\n*${otp}*\n\nThis code expires in 10 minutes. Do not share it with anyone.`;
        try {
          await sendTwilioMessage(phone, message);
        } catch (twilioErr) {
          // OTP was stored — clear it so the user can retry cleanly
          delete global._phoneOtps[phone];
          console.error('Twilio OTP send failed:', twilioErr.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to send WhatsApp OTP. Check the number and try again.' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to send OTP' }));
      }
    });
    return true;
  }

  // ── PHONE OTP — VERIFY ──────────────────────────────────────────────────────
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
    return true;
  }

  // ── PHONE LOGIN (OTP verify → magic link) ──────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/phone-login') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { phone, otp, redirect_to } = JSON.parse(body);
        if (!phone || !otp) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Phone and OTP required' }));
          return;
        }

        // Verify OTP
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

        // Look up account by phone number
        const profileRes = await supabaseRequest('GET',
          `profiles?phone=eq.${encodeURIComponent(phone)}&select=id,email`, null);
        const profiles = JSON.parse(profileRes.body);
        if (!Array.isArray(profiles) || !profiles[0]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No account found with this phone number.' }));
          return;
        }
        const { email } = profiles[0];

        // Generate Supabase magic link via Admin API
        const { SUPABASE_HOSTNAME, SUPABASE_SERVICE_KEY } = require('../lib/supabase');
        const linkBody = JSON.stringify({
          type: 'magiclink',
          email,
          ...(redirect_to ? { options: { redirect_to } } : {})
        });
        const linkResult = await new Promise((resolve, reject) => {
          const opts = {
            hostname: SUPABASE_HOSTNAME,
            path: '/auth/v1/admin/generate_link',
            method: 'POST',
            headers: {
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(linkBody)
            }
          };
          const r = https.request(opts, resp => {
            let raw = '';
            resp.on('data', c => raw += c);
            resp.on('end', () => {
              try { resolve({ status: resp.statusCode, body: JSON.parse(raw) }); }
              catch (e) { resolve({ status: resp.statusCode, body: {} }); }
            });
          });
          r.on('error', reject);
          r.setTimeout(10000, () => { r.destroy(); reject(new Error('Supabase timeout')); });
          r.write(linkBody);
          r.end();
        });

        const actionLink = linkResult.body?.properties?.action_link;
        if (linkResult.status !== 200 || !actionLink) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to generate login link. Please try again.' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ action_link: actionLink }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // ── DARK WEB SCAN (HIBP single-email) ───────────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/darkweb-scan')) {
    try {
      const authUser = await requireAuth(req);
      if (!authUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return true; }

      if (!HIBP_API_KEY) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ notConfigured: true, error: 'Dark web monitoring is not yet configured on this account. Contact ProCyberWall support to enable it.' }));
        return true;
      }

      const profileRes = await supabaseRequest('GET', `profiles?id=eq.${encodeURIComponent(authUser.id)}&select=full_name,email,domain,plan,phone`, null);
      const profiles = JSON.parse(profileRes.body);
      const profile = Array.isArray(profiles) && profiles[0] ? profiles[0] : {};
      const email = profile.email || authUser.email;

      if (!email) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'No email found on your account.'})); return true; }

      const breaches = await new Promise((resolve) => {
        const opts = {
          hostname: 'haveibeenpwned.com',
          path: `/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
          method: 'GET',
          headers: { 'hibp-api-key': HIBP_API_KEY, 'user-agent': 'ProCyberWall' }
        };
        const r = https.request(opts, resp => {
          let raw = '';
          resp.on('data', c => raw += c);
          resp.on('end', () => {
            if (resp.statusCode === 404) return resolve([]);
            if (resp.statusCode === 401) return resolve({ hibpError: 'Invalid API key' });
            if (resp.statusCode !== 200) return resolve([]);
            try { resolve(JSON.parse(raw)); } catch(e) { resolve([]); }
          });
        });
        r.on('error', () => resolve([]));
        r.setTimeout(10000, () => { r.destroy(); resolve([]); });
        r.end();
      });

      if (breaches?.hibpError) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: breaches.hibpError }));
        return true;
      }

      const totalBreaches = breaches.length;

      if (totalBreaches > 0) {
        const preview = breaches.slice(0, 3).map(b => `• ${b.Title} (${b.BreachDate?.slice(0,4) || '?'})`).join('\n');
        const alertTitle = `Your email found in ${totalBreaches} data breach${totalBreaches > 1 ? 'es' : ''}`;
        const alertDesc  = `${email} was found in the following breach${totalBreaches > 1 ? 'es' : ''}:\n${preview}${totalBreaches > 3 ? `\n+${totalBreaches - 3} more` : ''}\n\nChange your passwords immediately and enable two-factor authentication.`;
        createAlert(authUser.id, 'darkweb', 'high', alertTitle, alertDesc).catch(() => {});
      }

      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({
        email,
        scannedAt: new Date().toISOString(),
        breachDetails: breaches.map(b => ({
          name:        b.Title,
          date:        b.BreachDate,
          dataClasses: b.DataClasses || [],
        })),
        totalAffectedEmails: totalBreaches > 0 ? 1 : 0,
        totalBreaches,
      }));
    } catch(e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── CANCEL SUBSCRIPTION REQUEST ─────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/cancel-subscription') {
    const authUser = await requireAuth(req);
    if (!authUser) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Unauthorized'})); return true; }

    try {
      const profileRes = await supabaseRequest('GET', `profiles?id=eq.${encodeURIComponent(authUser.id)}&select=full_name,email,domain,plan`, null);
      const profiles = JSON.parse(profileRes.body);
      const profile = Array.isArray(profiles) && profiles[0] ? profiles[0] : {};

      const name   = profile.full_name || authUser.email || 'Unknown';
      const email  = profile.email     || authUser.email || '—';
      const domain = profile.domain    || '—';
      const plan   = (profile.plan     || 'starter').toUpperCase();

      if (ADMIN_PHONE) {
        const msg = `🚨 *Cancellation Request*\n\n*Client:* ${name}\n*Email:* ${email}\n*Domain:* ${domain}\n*Plan:* ${plan}\n\nThis client wants to cancel their ProCyberWall subscription. Please reach out to retain them.\n\n— ProCyberWall System`;
        sendTwilioMessage(ADMIN_PHONE, msg).catch(() => {});
      }

      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── SECURITY SCAN ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/security-scan')) {
    const params = new URL('http://x' + req.url).searchParams;
    const domain = params.get('domain');
    if (!domain) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'domain parameter required' }));
      return true;
    }
    if (!/^[a-zA-Z0-9.\-]+$/.test(domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0])) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid domain' }));
      return true;
    }
    const ip = getClientIp(req);
    if (!checkRateLimit(ip, '/api/security-scan', 5, 60000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests. Please wait a minute and try again.' }));
      return true;
    }
    try {
      let scan = await runSecurityScan(domain);
      if (scan.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: scan.error }));
        return true;
      }
      const authUser = await requireAuth(req);
      if (authUser) {
        const enhanced = await enhanceScanWithCloudflare(scan);
        // Keep the raw score — only attach the managed protections info
        scan = { ...scan, managed: enhanced.managed, managedChecks: enhanced.managedChecks };
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(scan));
    } catch(err) {
      console.error('Security scan error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Scan failed. Please try again.' }));
    }
    return true;
  }

  // ── WIDGET DATA ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/widget-data') {
    const user = await requireAuth(req);
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }
    try {
      const profileResult = await supabaseRequest(
        'GET',
        `profiles?id=eq.${encodeURIComponent(user.id)}&select=domain,plan,status`,
        null
      );
      const profiles = JSON.parse(profileResult.body);
      const profile = Array.isArray(profiles) && profiles[0];

      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

      if (!profile?.domain) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({
          status_text: 'Setup needed',
          dot_class: 'red',
          attacks_blocked: '--',
          domain: 'No domain set',
          updated_at: timeStr,
        }));
        return true;
      }

      const zoneId = await cfGetZoneId(profile.domain);
      let attacks_blocked = '0';

      if (zoneId) {
        try {
          const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
          const analytics = await cfGet(`/zones/${zoneId}/analytics/dashboard?since=${since30d}&until=${now.toISOString()}&continuous=true`);
          if (analytics.success) {
            const count = analytics.result?.totals?.requests?.threat || 0;
            attacks_blocked = count >= 1000 ? (count / 1000).toFixed(1) + 'k' : String(count);
          }
        } catch {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({
        status_text: zoneId ? 'Protected' : 'Not Protected',
        dot_class: zoneId ? 'green' : 'red',
        attacks_blocked,
        domain: profile.domain,
        updated_at: timeStr,
      }));
    } catch (err) {
      console.error('Widget data error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch widget data' }));
    }
    return true;
  }

  return false;
}

module.exports = { handle };
