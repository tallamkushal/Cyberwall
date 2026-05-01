const https = require('https');
const { supabaseRequest, supabaseUpsert } = require('../lib/supabase');
const { cfGetZoneId, cfGraphQL } = require('../lib/cloudflare');
const { createAlert } = require('../lib/alerts');
const { sendTwilioMessage, TWILIO_SID, TWILIO_TOKEN } = require('../lib/twilio');

// ── SELF-PING (keep Render awake) ─────────────────────────────────────────────
function selfPing() {
  const url = process.env.RENDER_EXTERNAL_URL || 'https://cyberwall.onrender.com';
  const target = new URL('/health', url);
  const req = https.request({ hostname: target.hostname, path: target.pathname, method: 'GET', timeout: 10000 }, res => {
    res.resume();
    console.log(`[keep-alive] ping → ${res.statusCode}`);
  });
  req.on('error', err => console.error('[keep-alive] ping failed:', err.message));
  req.on('timeout', () => req.destroy());
  req.end();
}

// ── MONTHLY REPORT REMINDER ────────────────────────────────────────────────────
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

async function sendMonthlyReportReminder() {
  if (new Date().getUTCDate() !== 1) return;
  try {
    const result = await supabaseRequest('GET',
      `profiles?status=in.(trial,active)&select=id,domain,phone,full_name`, null);
    const profiles = JSON.parse(result.body);
    if (!Array.isArray(profiles)) return;
    const now = new Date();
    const prevMonthIdx = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1;
    const monthName = MONTH_NAMES[prevMonthIdx];
    for (const p of profiles) {
      if (!p.domain) continue;
      createAlert(p.id, 'report', 'info',
        `Your ${monthName} security report is ready`,
        `Your monthly ProCyberWall security report for ${p.domain} is now available. Download it from the Reports section for a full summary of threats blocked, SSL status, and email security this month.`,
        28  // dedup window: once per month
      ).catch(err => console.error('[jobs]', err.message));
      if (p.phone && TWILIO_SID && TWILIO_TOKEN) {
        const msg = `📄 *ProCyberWall Monthly Report*\n\nHi ${p.full_name || 'there'}!\n\nYour *${monthName} Security Report* is ready for ${p.domain}.\n\nLog in to download your report and see a full summary of threats blocked this month.\n\n— ProCyberWall Team 🇮🇳`;
        sendTwilioMessage(p.phone, msg).catch(err => console.error('[jobs]', err.message));
      }
    }
  } catch (e) { console.error('Monthly report error:', e.message); }
}

// ── ZONE STATS POLLER ─────────────────────────────────────────────────────────
async function pollZoneStats(domain, zoneId, profileId) {
  const now        = new Date();
  const since30d   = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since7d    = new Date(now -  7 * 24 * 60 * 60 * 1000).toISOString();
  const since7dStr = since7d.slice(0, 10);
  const sinceToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const until      = now.toISOString();

  // Two separate queries — Cloudflare analytics API rejects multiple aliases
  // of the same dataset in a single request
  const [gqlChart, gqlEvents] = await Promise.all([
    cfGraphQL(`
      query($zoneTag:String!,$since30d:String!,$since7d:String!,$until:String!){
        viewer{
          zones(filter:{zoneTag:$zoneTag}){
            fwChart:firewallEventsAdaptiveGroups(
              filter:{datetime_geq:$since7d,datetime_leq:$until}
              limit:200 orderBy:[datetimeHour_ASC]
            ){count dimensions{datetimeHour}}
            requests:httpRequests1dGroups(
              filter:{datetime_geq:$since30d,datetime_leq:$until}
              limit:31 orderBy:[datetime_ASC]
            ){sum{requests threats} dimensions{datetime}}
          }
        }
      }`, { zoneTag: zoneId, since30d, since7d, until }
    ).catch(() => null),
    cfGraphQL(`
      query($zoneTag:String!,$sinceToday:String!,$until:String!){
        viewer{
          zones(filter:{zoneTag:$zoneTag}){
            fw:firewallEventsAdaptiveGroups(
              filter:{datetime_geq:$sinceToday,datetime_leq:$until}
              limit:10 orderBy:[count_DESC]
            ){count dimensions{action clientIP clientCountryName}}
          }
        }
      }`, { zoneTag: zoneId, sinceToday, until }
    ).catch(() => null),
  ]);

  // Skip writing if both queries failed — never overwrite good cache with zeros
  if (!gqlChart?.data && !gqlEvents?.data) return;

  const fwChart  = gqlChart?.data?.viewer?.zones?.[0]?.fwChart  || [];
  const requests = gqlChart?.data?.viewer?.zones?.[0]?.requests || [];
  const fw       = gqlEvents?.data?.viewer?.zones?.[0]?.fw      || [];

  // Chart: aggregate firewall events by UTC day
  const chartDayMap = {};
  for (const h of fwChart) {
    const day = (h.dimensions?.datetimeHour || '').slice(0, 10);
    if (day) chartDayMap[day] = (chartDayMap[day] || 0) + (h.count || 0);
  }

  const chartLabels = [], chartData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    chartLabels.push(dateStr); // ISO date — frontend formats to local day name
    chartData.push(chartDayMap[dateStr] || 0);
  }

  // Request stats: from daily groups (accurate for total requests)
  const today = now.toISOString().slice(0, 10);
  const reqDayMap = {};
  for (const d of requests) {
    const day = (d.dimensions?.datetime || '').slice(0, 10);
    if (day) reqDayMap[day] = { requests: d.sum?.requests || 0 };
  }
  let totalRequests7d = 0, totalRequests30d = 0;
  for (const [day, vals] of Object.entries(reqDayMap)) {
    totalRequests30d += vals.requests;
    if (day >= since7dStr) totalRequests7d += vals.requests;
  }

  // Threat counts: from firewall events (accurate for Pro WAF blocks)
  const since24hStr  = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const threatsToday = fwChart.reduce((s, h) => {
    const dt = h.dimensions?.datetimeHour || '';
    return dt >= since24hStr ? s + (h.count || 0) : s;
  }, 0);
  const threats7d    = Object.entries(chartDayMap).reduce((s, [d, v]) => d >= since7dStr ? s + v : s, 0);
  const threats30d   = Object.values(chartDayMap).reduce((s, v) => s + v, 0);

  const threats = fw.map(g => ({
    action:            g.dimensions?.action            || 'Block',
    clientIP:          g.dimensions?.clientIP          || '—',
    clientCountryName: g.dimensions?.clientCountryName || '—',
  }));

  // Write today's snapshot first — chart will read from this history
  if (profileId) {
    await supabaseUpsert(`threat_snapshots?on_conflict=profile_id,date`, {
      profile_id:     profileId,
      domain,
      date:           today,
      threats_today:  threatsToday,
      threats_7d:     threats7d,
      total_requests: totalRequests7d,
      clean_requests: Math.max(0, totalRequests7d - threats7d),
      block_rate_pct: totalRequests7d > 0 ? Math.round((threats7d / totalRequests7d) * 100) : 0,
      recorded_at:    now.toISOString(),
    }).catch(err => console.error(`[poller-snap] ${domain}:`, err.message));

    // Read last 7 days from threat_snapshots to build accurate chart
    const since8dDate = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const snapRes = await supabaseRequest('GET',
      `threat_snapshots?profile_id=eq.${encodeURIComponent(profileId)}&date=gte.${since8dDate}&select=date,threats_today&order=date.asc`,
      null).catch(() => null);
    let snapRows = [];
    try { snapRows = JSON.parse(snapRes?.body || '[]'); if (!Array.isArray(snapRows)) snapRows = []; } catch(e) {}

    const snapDayMap = {};
    for (const s of snapRows) { if (s.date) snapDayMap[s.date] = s.threats_today || 0; }
    snapDayMap[today] = threatsToday; // today's live count takes priority

    chartLabels.length = 0; chartData.length = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      chartLabels.push(dateStr); // ISO date — frontend formats to local day name
      chartData.push(snapDayMap[dateStr] || 0);
    }
  }

  await supabaseUpsert('zone_stats_cache', {
    domain,
    zone_id:    zoneId,
    data: {
      chart7d:          { labels: chartLabels, data: chartData, days: 7 },
      threatsToday,
      threats7d,
      threats30d,
      totalRequests24h: reqDayMap[today]?.requests || 0,
      totalRequests7d,
      totalRequests30d,
      threats,
      attackTypes:      { labels: [], data: [] },
    },
    fetched_at: now.toISOString(),
  });
}

async function pollAllZones() {
  console.log('[poller] refreshing zone stats...');
  let updated = 0, failed = 0;
  try {
    const r = await supabaseRequest('GET',
      'profiles?role=eq.client&status=in.(active,trial)&select=id,domain,cf_zone_id&domain=not.is.null',
      null);
    const profiles = JSON.parse(r.body);
    if (!Array.isArray(profiles)) return;

    for (const p of profiles) {
      if (!p.domain) continue;
      try {
        const zoneId = p.cf_zone_id || await cfGetZoneId(p.domain);
        if (!zoneId) continue;
        await pollZoneStats(p.domain, zoneId, p.id);
        updated++;
        await new Promise(r => setTimeout(r, 300)); // 300ms gap to avoid rate limiting
      } catch (err) {
        failed++;
        console.error(`[poller] ${p.domain}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[poller]', err.message);
  }
  console.log(`[poller] done — ${updated} updated, ${failed} failed`);
}

function start() {
  setInterval(selfPing,                 10 * 60 * 1000);        // every 10 minutes
  setInterval(sendMonthlyReportReminder,24 * 60 * 60 * 1000);   // checked daily, runs on 1st
  setInterval(pollAllZones,             15 * 60 * 1000);        // every 15 minutes

  sendMonthlyReportReminder();
  pollAllZones();
}

module.exports = { start };
