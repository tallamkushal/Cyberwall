const http  = require('http');
const https = require('https');
const { supabaseRequest } = require('../lib/supabase');
const { createAlert } = require('../lib/alerts');

// ── UPTIME CHECK ───────────────────────────────────────────────────────────────
// Ping every customer domain — fire a 'downtime' alert if unreachable
async function checkDomainUptime() {
  try {
    const result = await supabaseRequest('GET',
      `profiles?domain=not.is.null&status=in.(trial,active)&select=id,domain`, null);
    const profiles = JSON.parse(result.body);
    if (!Array.isArray(profiles)) return;
    for (const p of profiles) {
      if (!p.domain) continue;
      const host = p.domain.replace(/^https?:\/\//i, '').split('/')[0];

      // Try HTTPS first, fall back to HTTP — only alert if both fail
      const pingHost = (useHttps) => new Promise((resolve) => {
        const mod = useHttps ? https : http;
        const opts = useHttps
          ? { hostname: host, port: 443, path: '/', method: 'HEAD', timeout: 10000, rejectUnauthorized: false, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProCyberWall-Monitor/1.0)' } }
          : { hostname: host, port: 80,  path: '/', method: 'HEAD', timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProCyberWall-Monitor/1.0)' } };
        const req = mod.request(opts, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.end();
      });

      const httpsStatus = await pingHost(true);
      const httpStatus  = httpsStatus !== null ? httpsStatus : await pingHost(false);

      if (httpStatus === null) {
        // Both HTTPS and HTTP failed — site is genuinely unreachable
        supabaseRequest('PATCH', `profiles?id=eq.${p.id}`, { last_downtime_at: new Date().toISOString() }).catch(() => {});
        createAlert(p.id, 'downtime', 'high',
          'Your website appears to be down',
          `ProCyberWall could not reach ${p.domain}. We are investigating immediately. If this persists, contact ProCyberWall support right away.`
        ).catch(() => {});
      }
    }
  } catch (e) { console.error('Uptime check error:', e.message); }
}

// ── TRIAL EXPIRY CHECK ─────────────────────────────────────────────────────────
// Check for trials ending in 2 days — fire once per day via dedup
async function checkTrialExpiry() {
  try {
    const result = await supabaseRequest('GET',
      `profiles?status=eq.trial&select=id,domain,created_at`, null);
    const profiles = JSON.parse(result.body);
    if (!Array.isArray(profiles)) return;
    const now = Date.now();
    for (const p of profiles) {
      const trialEnd  = new Date(p.created_at).getTime() + 7 * 24 * 60 * 60 * 1000;
      const daysLeft  = Math.ceil((trialEnd - now) / 86400000);
      if (daysLeft <= 2 && daysLeft >= 0) {
        const msg = daysLeft === 0
          ? 'Your free trial has ended. To keep your website protected, please upgrade your plan. Contact ProCyberWall to continue without interruption.'
          : `Your 7-day ProCyberWall trial ends in ${daysLeft} day${daysLeft > 1 ? 's' : ''}. Upgrade now to keep your website protected. Contact us to activate your plan.`;
        createAlert(p.id, 'system', 'medium',
          daysLeft === 0 ? 'Your free trial has ended' : `Trial ending in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`,
          msg
        ).catch(() => {});
      }
    }
  } catch (e) { console.error('Trial check error:', e.message); }
}

// ── WEEKLY DIGEST ──────────────────────────────────────────────────────────────
// Fires every Monday
async function sendWeeklyDigest() {
  if (new Date().getDay() !== 1) return; // Monday only
  try {
    const result = await supabaseRequest('GET',
      `profiles?status=in.(trial,active)&select=id,domain`, null);
    const profiles = JSON.parse(result.body);
    if (!Array.isArray(profiles)) return;
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    for (const p of profiles) {
      if (!p.domain) continue;
      const alertRes = await supabaseRequest('GET',
        `alerts?user_id=eq.${p.id}&type=eq.threat&created_at=gte.${weekAgo}&select=id`, null);
      const weekAlerts = JSON.parse(alertRes.body);
      const count = Array.isArray(weekAlerts) ? weekAlerts.length : 0;
      createAlert(p.id, 'report', 'info',
        'Weekly security summary',
        `This week ProCyberWall protected ${p.domain}${count > 0 ? ` and generated ${count} threat alert${count > 1 ? 's' : ''}` : ' with no major threats detected'}. Your website remained fully protected throughout the week. Full details are in your Reports section.`
      ).catch(() => {});
    }
  } catch (e) { console.error('Weekly digest error:', e.message); }
}

// ── MONTHLY REPORT REMINDER ────────────────────────────────────────────────────
// Fires on the 1st of each month
async function sendMonthlyReportReminder() {
  if (new Date().getDate() !== 1) return; // 1st of month only
  try {
    const result = await supabaseRequest('GET',
      `profiles?status=in.(trial,active)&select=id,domain`, null);
    const profiles = JSON.parse(result.body);
    if (!Array.isArray(profiles)) return;
    const monthName = new Date().toLocaleString('en-IN', { month: 'long' });
    for (const p of profiles) {
      if (!p.domain) continue;
      createAlert(p.id, 'report', 'info',
        `Your ${monthName} security report is ready`,
        `Your monthly ProCyberWall security report for ${p.domain} is now available. Download it from the Reports section for a full summary of threats blocked, SSL status, and email security this month.`
      ).catch(() => {});
    }
  } catch (e) { console.error('Monthly report error:', e.message); }
}

function start() {
  setInterval(checkDomainUptime,         5 * 60 * 1000);        // every 5 minutes
  setInterval(checkTrialExpiry,          6 * 60 * 60 * 1000);   // every 6 hours
  setInterval(sendWeeklyDigest,         24 * 60 * 60 * 1000);   // checked daily, runs on Monday
  setInterval(sendMonthlyReportReminder,24 * 60 * 60 * 1000);   // checked daily, runs on 1st

  // Run immediately on startup
  checkTrialExpiry();
  sendWeeklyDigest();
  sendMonthlyReportReminder();
}

module.exports = { start };
