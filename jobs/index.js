const https = require('https');
const { supabaseRequest } = require('../lib/supabase');
const { createAlert } = require('../lib/alerts');
const { sendTwilioMessage } = require('../lib/twilio');

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
async function sendMonthlyReportReminder() {
  if (new Date().getDate() !== 1) return;
  try {
    const result = await supabaseRequest('GET',
      `profiles?status=in.(trial,active)&select=id,domain,phone,full_name`, null);
    const profiles = JSON.parse(result.body);
    if (!Array.isArray(profiles)) return;
    const monthName = new Date().toLocaleString('en-IN', { month: 'long' });
    for (const p of profiles) {
      if (!p.domain) continue;
      createAlert(p.id, 'report', 'info',
        `Your ${monthName} security report is ready`,
        `Your monthly ProCyberWall security report for ${p.domain} is now available. Download it from the Reports section for a full summary of threats blocked, SSL status, and email security this month.`
      ).catch(() => {});
      if (p.phone) {
        const msg = `📄 *ProCyberWall Monthly Report*\n\nHi ${p.full_name || 'there'}!\n\nYour *${monthName} Security Report* is ready for ${p.domain}.\n\nLog in to download your report and see a full summary of threats blocked this month.\n\n— ProCyberWall Team 🇮🇳`;
        sendTwilioMessage(p.phone, msg).catch(() => {});
      }
    }
  } catch (e) { console.error('Monthly report error:', e.message); }
}

function start() {
  setInterval(selfPing,                 10 * 60 * 1000);        // every 10 minutes
  setInterval(sendMonthlyReportReminder,24 * 60 * 60 * 1000);   // checked daily, runs on 1st

  sendMonthlyReportReminder();
}

module.exports = { start };
