const https = require('https');
const { requireAuth, requireAdminAuth } = require('../lib/auth');
const { supabaseRequest } = require('../lib/supabase');
const { cfGet, cfGetZoneId, cfGraphQL, CF_EMAIL, CF_API_KEY } = require('../lib/cloudflare');
const { sendTwilioMessage } = require('../lib/twilio');
const { probeDomain } = require('../lib/scanner');
const { createAlert } = require('../lib/alerts');

const ADMIN_PHONE = process.env.ADMIN_PHONE || '';

async function handle(req, res, parsedUrl) {
  // ── CLOUDFLARE: ADD DOMAIN (ACTIVATE — admin only) ──────────────────────────
  if (req.method === 'POST' && req.url === '/api/cf/activate') {
    const adminUser = await requireAdminAuth(req);
    if (!adminUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { domain } = JSON.parse(body);
        if (!domain) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'domain required'})); return; }

        const clean = domain.replace(/https?:\/\//, '').replace(/^www\./, '').split('/')[0];

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
    return true;
  }

  // ── CLOUDFLARE: CLIENT SELF-SERVE ZONE SETUP ───────────────────────────────
  if (req.method === 'POST' && req.url === '/api/cf/setup-zone') {
    const authUser = await requireAuth(req);
    if (!authUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { domain } = JSON.parse(body);
        if (!domain) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'domain required' }));
          return;
        }

        const clean = domain.replace(/https?:\/\//, '').replace(/^www\./, '').split('/')[0];

        // Save domain to profile first — persisted even if CF zone creation fails
        await supabaseRequest('PATCH', `profiles?id=eq.${authUser.id}`, { domain: clean }).catch(() => {});

        const cfPayload = JSON.stringify({ name: clean, jump_start: true });
        const result = await new Promise((resolve, reject) => {
          const opts = {
            hostname: 'api.cloudflare.com',
            path: '/client/v4/zones',
            method: 'POST',
            headers: {
              'X-Auth-Email': CF_EMAIL,
              'X-Auth-Key': CF_API_KEY,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(cfPayload)
            }
          };
          const r = https.request(opts, resp => {
            let raw = '';
            resp.on('data', c => raw += c);
            resp.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(new Error('CF parse error')); } });
          });
          r.on('error', reject);
          r.setTimeout(15000, () => { r.destroy(); reject(new Error('CF timeout')); });
          r.write(cfPayload);
          r.end();
        });

        let nameservers = [];
        let zoneId = null;
        let alreadyExists = false;

        if (!result.success) {
          // Zone already exists in our CF account — fetch its nameservers
          if (result.errors?.[0]?.code === 1061) {
            const existing = await cfGet(`/zones?name=${encodeURIComponent(clean)}`);
            if (existing.success && existing.result?.length) {
              nameservers = existing.result[0].name_servers || [];
              zoneId      = existing.result[0].id;
              alreadyExists = true;
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Zone already exists but could not retrieve nameservers' }));
              return;
            }
          } else {
            const msg = result.errors?.[0]?.message || 'Cloudflare error';
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: msg }));
            return;
          }
        } else {
          nameservers = result.result?.name_servers || [];
          zoneId      = result.result?.id;
        }

        // Persist zoneId + nameservers to the client's profile
        if (zoneId) {
          await supabaseRequest('PATCH', `profiles?id=eq.${authUser.id}`, {
            cf_zone_id:   zoneId,
            nameservers:  nameservers.join(','),
            domain:       clean
          }).catch(() => {});
        }

        // Notify admin via WhatsApp
        if (ADMIN_PHONE) {
          const profRes = await supabaseRequest('GET', `profiles?id=eq.${authUser.id}&select=full_name,email`, null).catch(() => null);
          let clientName = authUser.email;
          if (profRes) {
            try {
              const rows = JSON.parse(profRes.body);
              if (rows?.[0]?.full_name) clientName = rows[0].full_name;
            } catch(e) {}
          }
          const status = alreadyExists ? '(zone already existed)' : '✅ New zone created';
          const msg = `🌐 *Cloudflare Zone Setup*\n\n*Client:* ${clientName}\n*Domain:* ${clean}\n*Status:* ${status}\n*Nameservers:*\n• ${nameservers.join('\n• ')}\n\nClient has been shown their nameservers and is updating DNS.\n\n— ProCyberWall System`;
          sendTwilioMessage(ADMIN_PHONE, msg).catch(() => {});
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ nameservers, zoneId, alreadyExists }));
      } catch(err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // ── CLOUDFLARE PROXY: FULL OVERVIEW DATA ───────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/cf/overview')) {
    const _overviewUrl = new URL('http://x' + req.url);
    const domain = (_overviewUrl.searchParams.get('domain') || '')
      .trim().toLowerCase()
      .replace(/^https?:\/\//i, '').replace(/^www\./i, '')
      .replace(/[/?#].*$/, '').replace(/:\d+$/, '');
    if (!domain) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'domain required'})); return true; }
    // Start auth check early (runs in parallel with CF API calls)
    const _cfAuthPromise = requireAuth(req).catch(() => null);
    try {
      let zoneId = _overviewUrl.searchParams.get('zone_id') || null;
      let zoneStatus = 'active';
      let zonePlan   = 'free';
      if (zoneId) {
        const zoneInfo = await cfGet(`/zones/${zoneId}`).catch(() => null);
        if (!zoneInfo?.success) {
          zoneId = null;
        } else {
          zoneStatus = zoneInfo.result?.status   || 'active';
          zonePlan   = zoneInfo.result?.plan?.legacy_id || 'free';
        }
      }
      if (!zoneId) {
        zoneId = await cfGetZoneId(domain);
        if (zoneId) {
          const zoneInfo = await cfGet(`/zones/${zoneId}`).catch(() => null);
          zoneStatus = zoneInfo?.result?.status   || 'active';
          zonePlan   = zoneInfo?.result?.plan?.legacy_id || 'free';
        }
      }
      if (!zoneId) { res.writeHead(404, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'domain not found in Cloudflare'})); return true; }

      const isPro        = ['pro', 'business', 'enterprise'].includes(zonePlan);
      const isBusiness   = ['business', 'enterprise'].includes(zonePlan);

      const now = new Date();
      const since30d   = new Date(now - 30*24*60*60*1000).toISOString();
      const since3d    = new Date(now -  3*24*60*60*1000).toISOString();
      const sinceToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const until = now.toISOString();

      const today = now.toISOString().slice(0, 10);

      // Check for today's cached security score — avoids DNS inconsistency
      const scoreCachePromise = _cfAuthPromise.then(async user => {
        if (!user) return null;
        const r = await supabaseRequest('GET',
          `security_scores?profile_id=eq.${encodeURIComponent(user.id)}&domain=eq.${encodeURIComponent(domain)}&scanned_at=gte.${today}T00:00:00Z&order=scanned_at.desc&limit=1`,
          null);
        const rows = JSON.parse(r.body);
        return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      }).catch(() => null);

      // Profile query (last_downtime_at) runs in parallel with CF calls
      const profilePromise = _cfAuthPromise.then(async user => {
        if (!user) return null;
        const r = await supabaseRequest('GET', `profiles?id=eq.${encodeURIComponent(user.id)}&select=last_downtime_at`, null);
        const rows = JSON.parse(r.body);
        return Array.isArray(rows) ? rows[0] : null;
      }).catch(() => null);

      // Real ping — measures actual response time to the customer's domain
      const pingPromise = new Promise(resolve => {
        const host = domain.replace(/^https?:\/\//, '').split('/')[0];
        const t0 = Date.now();
        const r = https.request({ hostname: host, path: '/', method: 'HEAD', timeout: 6000 }, () => resolve(Date.now() - t0));
        r.on('error', () => resolve(null));
        r.on('timeout', () => { r.destroy(); resolve(null); });
        r.end();
      });

      const _statsGql = (since) => cfGraphQL(`
        query($zoneTag:String!,$since:String!,$until:String!){
          viewer{
            zones(filter:{zoneTag:$zoneTag}){
              hours:httpRequests1hGroups(
                filter:{datetime_geq:$since,datetime_leq:$until}
                limit:720 orderBy:[datetime_ASC]
              ){sum{requests threats} dimensions{datetime}}
            }
          }
        }`, { zoneTag: zoneId, since, until });

      // Try 30 days first; free-plan zones are capped at 3 days — fall back automatically
      const statsGqlPromise = _statsGql(since30d)
        .then(r => r?.errors?.[0]?.extensions?.code === 'quota' ? _statsGql(since3d) : r)
        .catch(() => null);

      // Firewall events — 5s max so it never hangs the overview
      const fwGqlPromise = Promise.race([
        cfGraphQL(`
          query($zoneTag:String!,$since:String!,$until:String!){
            viewer{
              zones(filter:{zoneTag:$zoneTag}){
                byAction:firewallEventsAdaptiveGroups(
                  filter:{datetime_geq:$since,datetime_leq:$until}
                  limit:10 orderBy:[count_DESC]
                ){count dimensions{action clientIP clientCountryName}}
              }
            }
          }`, { zoneTag: zoneId, since: sinceToday, until }),
        new Promise(resolve => setTimeout(() => resolve(null), 5000))
      ]).catch(() => null);

      const [events, httpsSet, sslSet, tlsSet, dnsAll, certPacks, wafSet, botSet, botMgmt, rulesets] = await Promise.allSettled([
        cfGet(`/zones/${zoneId}/firewall/events?per_page=20`),
        cfGet(`/zones/${zoneId}/settings/always_use_https`),
        cfGet(`/zones/${zoneId}/settings/ssl`),
        cfGet(`/zones/${zoneId}/settings/min_tls_version`),
        cfGet(`/zones/${zoneId}/dns_records?per_page=100`),
        cfGet(`/zones/${zoneId}/ssl/certificate_packs`),
        cfGet(`/zones/${zoneId}/settings/waf`),
        isPro ? Promise.resolve(null) : cfGet(`/zones/${zoneId}/settings/bot_fight_mode`),
        isPro ? cfGet(`/zones/${zoneId}/bot_management`) : Promise.resolve(null),
        cfGet(`/zones/${zoneId}/rulesets`),
      ]);

      const [profile, responseMs] = await Promise.all([profilePromise, pingPromise]);

      const ok = r => r.status === 'fulfilled' && r.value?.success ? r.value : null;

      // --- Stats from GraphQL ---
      const statsGqlData = (await statsGqlPromise)?.data?.viewer?.zones?.[0]?.hours || [];

      // Time windows
      const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      const since7d  = new Date(now -  7 * 24 * 60 * 60 * 1000).toISOString();

      const filterSince = (since) => statsGqlData.filter(h => (h.dimensions?.datetime || '') >= since);

      const data24h = filterSince(since24h);
      const data7d  = filterSince(since7d);

      const threatsToday   = data24h.reduce((s, h) => s + (h.sum?.threats  || 0), 0);
      const threats7d      = data7d.reduce( (s, h) => s + (h.sum?.threats  || 0), 0);
      const threats30d     = statsGqlData.reduce((s, h) => s + (h.sum?.threats  || 0), 0);

      const totalRequests24h = data24h.reduce((s, h) => s + (h.sum?.requests || 0), 0);
      const totalRequests7d  = data7d.reduce( (s, h) => s + (h.sum?.requests || 0), 0);
      const totalRequests30d = statsGqlData.reduce((s, h) => s + (h.sum?.requests || 0), 0);

      // --- Chart: aggregate by day (7-day bar chart) ---
      const dayMap = {};
      for (const h of statsGqlData) {
        const day = (h.dimensions?.datetime || '').slice(0, 10);
        if (day) dayMap[day] = (dayMap[day] || 0) + (h.sum?.threats || 0);
      }
      const todayUtc = now.toISOString().slice(0, 10);
      const chartDays = 7;
      const chartLabels = [], chartData = [];
      for (let i = chartDays - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = d.toISOString().slice(0, 10);
        chartLabels.push(i === 0 ? 'Today' : d.toLocaleDateString('en-IN', {weekday:'short'}));
        chartData.push(dayMap[dateStr] || 0);
      }

      // --- Firewall events: REST first, GraphQL fallback ---
      const restEvts = ok(events)?.result || [];
      const fwRaw    = restEvts.length === 0
        ? (await fwGqlPromise)?.data?.viewer?.zones?.[0]?.byAction || []
        : [];
      const evts = restEvts.length > 0
        ? restEvts
        : fwRaw.map(g => ({
            action:            g.dimensions?.action            || 'Block',
            clientIP:          g.dimensions?.clientIP          || '—',
            clientCountryName: g.dimensions?.clientCountryName || '—',
          }));
      const attackTypeLabels = [];
      const attackTypeData   = [];

      // --- Zone settings ---
      const httpsEnforced = ok(httpsSet)?.result?.value === 'on';
      const sslMode       = ok(sslSet)?.result?.value || 'full';
      const tlsVersion    = ok(tlsSet)?.result?.value || '1.2';
      const legacyWaf = ok(wafSet)?.result?.value === 'on';
      const managedRulesets = ok(rulesets)?.result || [];
      const hasWafRuleset = managedRulesets.some(r =>
        r.phase === 'http_request_firewall_managed' || r.phase === 'http_ratelimit' ||
        (r.kind === 'managed' && r.description?.toLowerCase().includes('managed'))
      );
      const wafEnabled = legacyWaf || hasWafRuleset || (zoneStatus === 'active' && managedRulesets.length > 0);
      const botMgmtResult = ok(botMgmt)?.result;
      const botEnabled    = isPro
        ? ['managed_challenge','block'].includes(botMgmtResult?.sbfm_definitely_automated)  // pro: Super Bot Fight Mode
          || botMgmtResult?.stale_zone_configuration?.fight_mode === true
        : ok(botSet)?.result?.value === 'on';                                               // free: Bot Fight Mode

      // --- Uptime from last recorded downtime ---
      let uptimePercent = '100%';
      if (profile?.last_downtime_at) {
        const daysSince = (Date.now() - new Date(profile.last_downtime_at).getTime()) / 86400000;
        uptimePercent = daysSince <= 30 ? '99.9%' : '100%';
      }

      // --- DNS records ---
      const dnsRecords = ok(dnsAll)?.result || [];

      const spfRecord   = dnsRecords.find(r => r.type === 'TXT' && r.content?.includes('v=spf1'));
      const spfContent  = spfRecord?.content || '';
      const hasSPF      = !!spfRecord;
      const spfHardfail = spfContent.includes('-all');
      const spfStatus   = !hasSPF         ? '✗ Not protected'
                        : spfHardfail     ? '✓ Protected'
                        :                   '⚠ Partially protected';

      const hasDKIM  = dnsRecords.some(r => r.type === 'TXT' && r.name?.includes('_domainkey'));
      const dkimStatus = hasDKIM ? '✓ Pass' : '✗ Not found';

      const dmarcRecord  = dnsRecords.find(r => r.type === 'TXT' && r.name?.startsWith('_dmarc'));
      const dmarcContent = dmarcRecord?.content || '';
      const dmarcPolicy  = (dmarcContent.match(/p=(none|quarantine|reject)/i)?.[1] || '').toLowerCase();
      const hasDMARC     = !!dmarcRecord;
      const dmarcBlocking = dmarcPolicy === 'reject' || dmarcPolicy === 'quarantine';
      const dmarcStatus  = !hasDMARC              ? '✗ Not configured'
                         : dmarcPolicy === 'reject'     ? '✓ Pass'
                         : dmarcPolicy === 'quarantine' ? '⚠ Quarantine only'
                         : dmarcPolicy === 'none'       ? '⚠ Monitor only — not blocking'
                         :                               '⚠ Policy not set';

      const hasMX = dnsRecords.some(r => r.type === 'MX');

      // --- SSL cert ---
      const packs = ok(certPacks)?.result || [];
      const activePack = packs.find(p => p.status === 'active') || packs[0];
      const cert0 = activePack?.certificates?.[0] || {};
      const certExpiry = cert0.expires_on || cert0.expiration_date || activePack?.expires_on || null;
      let certExpiresStr = '—';
      let certIssuer = cert0.issuer || activePack?.issuer || '';
      let sslStatusStr = activePack ? '✓ Valid' : '—';

      // Always do a direct TLS probe — gets expiry, issuer, and validates cert independently
      let _sslDaysLeft = null;
      try {
        const tlsCheck = await probeDomain(domain.replace(/^https?:\/\//, '').split('/')[0], true);
        if (tlsCheck.certInfo) {
          if (!certIssuer) certIssuer = tlsCheck.certInfo.issuer || 'Unknown';
          if (tlsCheck.certInfo.authorized !== undefined) {
            sslStatusStr = tlsCheck.certInfo.authorized ? '✓ Valid' : '⚠ Issue';
          }
          if (tlsCheck.certInfo.validTo) {
            const exp = new Date(tlsCheck.certInfo.validTo);
            if (!isNaN(exp)) {
              const days = Math.round((exp - now) / 86400000);
              _sslDaysLeft = days;
              certExpiresStr = exp.toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'}) + ` (${days} days)`;
            }
          }
        }
      } catch(e) { /* silently ignore TLS probe errors */ }

      // If TLS probe didn't get expiry, try Cloudflare cert pack data
      if (certExpiresStr === '—' && certExpiry) {
        const exp = new Date(certExpiry);
        if (!isNaN(exp)) {
          const days = Math.round((exp - now) / 86400000);
          certExpiresStr = exp.toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'}) + ` (${days} days)`;
        }
      }
      if (!certIssuer) certIssuer = 'Cloudflare';

      // --- Security score (computed) ---
      let freshScore = 60;
      if (sslMode === 'full' || sslMode === 'strict') freshScore += 10;
      if (httpsEnforced) freshScore += 10;
      if (spfHardfail)    freshScore += 5; else if (hasSPF) freshScore += 2;
      if (hasDKIM)        freshScore += 5;
      if (dmarcBlocking)  freshScore += 5; else if (hasDMARC) freshScore += 2;
      if (hasMX)          freshScore += 5;

      // Use today's cached score if available — prevents DNS inconsistency causing fluctuation
      const cachedScore = await scoreCachePromise;
      const score      = cachedScore?.score ?? freshScore;
      const scoreGrade = cachedScore?.grade ?? (score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : 'C');

      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({
        zoneStatus,
        zoneActive: zoneStatus === 'active',
        stats: {
          threatsToday,
          threats7d,
          threats30d,
          totalRequests24h,
          totalRequests7d,
          totalRequests30d,
          securityScore: score,
          scoreGrade,
          uptime:     uptimePercent,
          responseMs: responseMs,
        },
        chart7d:     { labels: chartLabels, data: chartData, days: chartDays },
        attackTypes: { labels: attackTypeLabels, data: attackTypeData },
        threats:     evts.slice(0, 10),
        ssl: {
          status:  sslStatusStr,
          issuer:  certIssuer,
          expires: certExpiresStr,
          protocol: `TLS ${tlsVersion}`,
          httpsEnforced,
        },
        email: {
          spf:   spfStatus,
          dkim:  dkimStatus,
          dmarc: dmarcStatus,
          mx:    hasMX ? '✓ Configured' : '✗ Not found',
        },
        security: {
          waf:       wafEnabled    ? 'Active' : 'Inactive',
          ssl:       sslMode,
          botShield: botEnabled    ? 'Active' : 'Inactive',
          https:     httpsEnforced ? 'Enforced' : 'Not enforced',
        },
      }));

      // ── Record historical data (fire-and-forget, response already sent) ────────
      _cfAuthPromise.then(async authUser => {
        if (!authUser) return;

        const blockRate7d = totalRequests7d > 0 ? Math.round((threats7d / totalRequests7d) * 100) : 0;

        if (!cachedScore) {
          supabaseRequest('POST', 'security_scores', {
            profile_id: authUser.id,
            domain,
            score:      freshScore,
            grade:      freshScore >= 90 ? 'A+' : freshScore >= 80 ? 'A' : freshScore >= 70 ? 'B' : 'C',
            issues:     [],
            scanned_at: now.toISOString(),
          }).catch(() => {});
        }

        supabaseRequest('POST', 'threat_snapshots', {
          profile_id:     authUser.id,
          domain,
          date:           today,
          threats_today:  threatsToday,
          threats_7d:     threats7d,
          total_requests: totalRequests7d,
          clean_requests: Math.max(0, totalRequests7d - threats7d),
          block_rate_pct: blockRate7d,
          recorded_at:    now.toISOString(),
        }).catch(() => {});

        if (chartData.length >= 2) {
          const todayVal = chartData[chartData.length - 1];
          const prevDays = chartData.slice(0, -1).filter(v => v > 0);
          if (prevDays.length > 0) {
            const avg = prevDays.reduce((a, b) => a + b, 0) / prevDays.length;
            if (avg > 0 && todayVal > avg * 5) {
              createAlert(authUser.id, 'traffic', 'high',
                `Attack spike: ${todayVal.toLocaleString()} attacks today`,
                `Today's attack volume on ${domain} is ${Math.round(todayVal / avg)}× above your 7-day average. ProCyberWall is monitoring the situation in real time — no action needed from you.`
              ).catch(() => {});
            }
          }
        }

      }).catch(() => {});


    } catch (err) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error: err.message}));
    }
    return true;
  }

  // ── CLOUDFLARE TRAFFIC ANALYTICS (GraphQL) ────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/cf/traffic')) {
    const authUser = await requireAuth(req);
    if (!authUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }
    const _u = new URL('http://x' + req.url);
    const domain = (_u.searchParams.get('domain') || '')
      .trim().toLowerCase()
      .replace(/^https?:\/\//i, '').replace(/^www\./i, '')
      .replace(/[/?#].*$/, '').replace(/:\d+$/, '');
    let zoneId = _u.searchParams.get('zone_id') || null;
    if (!domain) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'domain required' }));
      return true;
    }
    try {
      if (!zoneId) zoneId = await cfGetZoneId(domain);
      if (!zoneId) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'zone not found' }));
        return true;
      }

      const now   = new Date();
      const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      const until = now.toISOString();

      const GQL_PRO = `
        query($zoneTag:String!,$since:String!,$until:String!){
          viewer{
            zones(filter:{zoneTag:$zoneTag}){
              ts:httpRequests1hGroups(
                filter:{datetime_geq:$since,datetime_leq:$until}
                limit:48 orderBy:[datetime_ASC]
              ){sum{requests threats cachedRequests bytes pageViews} dimensions{datetime}}
              byCountry:httpRequestsAdaptiveGroups(
                filter:{datetime_geq:$since,datetime_leq:$until}
                limit:8
              ){count dimensions{clientCountryName}}
              byDevice:httpRequestsAdaptiveGroups(
                filter:{datetime_geq:$since,datetime_leq:$until}
                limit:5
              ){count dimensions{clientDeviceType}}
              byMethod:httpRequestsAdaptiveGroups(
                filter:{datetime_geq:$since,datetime_leq:$until}
                limit:5
              ){count dimensions{clientRequestHTTPMethodName}}
              byCache:httpRequestsAdaptiveGroups(
                filter:{datetime_geq:$since,datetime_leq:$until}
                limit:6
              ){count dimensions{cacheStatus}}
              byProtocol:httpRequestsAdaptiveGroups(
                filter:{datetime_geq:$since,datetime_leq:$until}
                limit:5
              ){count dimensions{clientRequestHTTPProtocol}}
              fwActions:firewallEventsAdaptiveGroups(
                filter:{datetime_geq:$since,datetime_leq:$until}
                limit:5 orderBy:[count_DESC]
              ){count dimensions{action}}
              fwIPs:firewallEventsAdaptiveGroups(
                filter:{datetime_geq:$since,datetime_leq:$until}
                limit:6 orderBy:[count_DESC]
              ){count dimensions{clientIP}}
            }
          }
        }`;

      const GQL_FREE = `
        query($zoneTag:String!,$since:String!,$until:String!){
          viewer{
            zones(filter:{zoneTag:$zoneTag}){
              ts:httpRequests1hGroups(
                filter:{datetime_geq:$since,datetime_leq:$until}
                limit:48 orderBy:[datetime_ASC]
              ){sum{requests threats cachedRequests bytes} dimensions{datetime}}
            }
          }
        }`;

      // Try Pro query first; only fall back to free if core timeseries data is missing
      // Partial errors (e.g. fwActions access denied) are handled gracefully via null checks
      let gqlRes = await cfGraphQL(GQL_PRO, { zoneTag: zoneId, since, until });
      const tsData = gqlRes?.data?.viewer?.zones?.[0]?.ts;
      const hasCoreError = !tsData && gqlRes?.errors?.some(e =>
        e.message?.includes('does not have access') || e.extensions?.code === 'quota'
      );
      if (hasCoreError) {
        gqlRes = await cfGraphQL(GQL_FREE, { zoneTag: zoneId, since, until });
      }

      const zData = gqlRes?.data?.viewer?.zones?.[0];

      if (!zData) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: gqlRes?.errors?.[0]?.message || 'GraphQL error' }));
        return true;
      }

      const timeseries = (zData.ts || []).map(g => ({
        hour:      g.dimensions?.datetime,
        requests:  g.sum?.requests       || 0,
        threats:   g.sum?.threats        || 0,
        cached:    g.sum?.cachedRequests || 0,
        pageViews: g.sum?.pageViews      || 0,
      }));

      const tot = timeseries.reduce((acc, t) => {
        acc.requests += t.requests;
        acc.threats  += t.threats;
        acc.cached   += t.cached;
        return acc;
      }, { requests: 0, threats: 0, cached: 0 });
      const total          = tot.requests;
      const mitigated      = tot.threats;
      const cleanTraffic   = Math.max(0, total - mitigated);
      const servedByCF     = total > 0 ? Math.round((mitigated / total) * 100) : 0;
      const servedByOrigin = cleanTraffic;

      const mapList = (arr, dimKey) =>
        (arr || [])
          .map(g => ({ label: g.dimensions?.[dimKey] || 'Unknown', value: g.count || 0 }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 8);

      const pageViews      = timeseries.reduce((s, t) => s + (t.pageViews || 0), 0);
      const uniqueVisitors = pageViews > 0 ? pageViews : null;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        summary:    { total, mitigated, servedByCF, servedByOrigin, uniqueVisitors, pageViews },
        timeseries,
        countries:  mapList(zData.byCountry,  'clientCountryName'),
        devices:    mapList(zData.byDevice,   'clientDeviceType'),
        methods:    mapList(zData.byMethod,   'clientRequestHTTPMethodName'),
        cacheStatus:mapList(zData.byCache,    'cacheStatus'),
        protocols:  mapList(zData.byProtocol, 'clientRequestHTTPProtocol'),
        fwActions:  mapList(zData.fwActions,  'action'),
        topIPs:     mapList(zData.fwIPs,      'clientIP'),
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}

module.exports = { handle };
