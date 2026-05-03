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
// Sole job: keep threat_snapshots up to date for chart history beyond CF's 72h retention.
// zone_stats_cache is written exclusively by routes/cloudflare.js on a cache miss,
// so the poller never touches it (prevents the two-writer corruption that caused zeros).
async function pollZoneStats(domain, zoneId, profileId) {
  if (!profileId) return;

  const now        = new Date();
  const since30d   = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since7d    = new Date(now -  7 * 24 * 60 * 60 * 1000).toISOString();
  const since7dStr = since7d.slice(0, 10);
  const until      = now.toISOString();
  const today      = now.toISOString().slice(0, 10);

  const gqlChart = await cfGraphQL(`
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
  ).catch(() => null);

  if (!gqlChart?.data) return;

  const fwChart  = gqlChart.data.viewer.zones[0]?.fwChart  || [];
  const requests = gqlChart.data.viewer.zones[0]?.requests || [];

  // Aggregate firewall events by UTC day
  const chartDayMap = {};
  for (const h of fwChart) {
    const day = (h.dimensions?.datetimeHour || '').slice(0, 10);
    if (day) chartDayMap[day] = (chartDayMap[day] || 0) + (h.count || 0);
  }

  // Request stats from daily groups
  const reqDayMap = {};
  for (const d of requests) {
    const day = (d.dimensions?.datetime || '').slice(0, 10);
    if (day) reqDayMap[day] = { requests: d.sum?.requests || 0, threats: d.sum?.threats || 0 };
  }
  let totalRequests7d = 0, totalRequests30d = 0;
  for (const [day, vals] of Object.entries(reqDayMap)) {
    totalRequests30d += vals.requests;
    if (day >= since7dStr) totalRequests7d += vals.requests;
  }

  // Fallback: when fwChart empty, use httpRequests daily threats (Free plan)
  if (fwChart.length === 0) {
    for (const [day, vals] of Object.entries(reqDayMap)) {
      if (vals.threats > 0) chartDayMap[day] = (chartDayMap[day] || 0) + vals.threats;
    }
  }

  // threatsToday: 24h rolling count from fwChart, fallback to httpRequests
  const since24hStr = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  let threatsToday = fwChart.reduce((s, h) => {
    const dt = h.dimensions?.datetimeHour || '';
    return dt >= since24hStr ? s + (h.count || 0) : s;
  }, 0);
  if (threatsToday === 0) threatsToday = reqDayMap[today]?.threats || 0;

  const threats7d  = Object.entries(chartDayMap).reduce((s, [d, v]) => d >= since7dStr ? s + v : s, 0);
  const threats30d = Object.values(chartDayMap).reduce((s, v) => s + v, 0);

  // Read existing snapshot to avoid decreasing count due to CF data lag
  const since8dDate = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const snapRes = await supabaseRequest('GET',
    `threat_snapshots?profile_id=eq.${encodeURIComponent(profileId)}&date=gte.${since8dDate}&select=date,threats_today&order=date.asc`,
    null).catch(() => null);
  let snapRows = [];
  try { snapRows = JSON.parse(snapRes?.body || '[]'); if (!Array.isArray(snapRows)) snapRows = []; } catch(e) {}

  const existingToday     = snapRows.find(s => s.date === today);
  const effectiveThreats  = Math.max(threatsToday, existingToday?.threats_today || 0);

  await supabaseUpsert(`threat_snapshots?on_conflict=profile_id,date`, {
    profile_id:     profileId,
    domain,
    date:           today,
    threats_today:  effectiveThreats,
    threats_7d:     threats7d,
    total_requests: totalRequests7d,
    clean_requests: Math.max(0, totalRequests7d - threats7d),
    block_rate_pct: totalRequests7d > 0 ? Math.round((threats7d / totalRequests7d) * 100) : 0,
    recorded_at:    now.toISOString(),
  }).catch(err => console.error(`[poller-snap] ${domain}:`, err.message));
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
