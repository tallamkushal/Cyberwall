const { supabaseRequest } = require('./supabase');
const { sendTwilioMessage, TWILIO_SID, TWILIO_TOKEN } = require('./twilio');

// Writes one alert record to Supabase.
// dedupDays=1 (default) → once per day. dedupDays=7 → once per week.
// Fires a WhatsApp message for high/medium severity only.
async function createAlert(userId, type, severity, title, description = '', dedupDays = 1) {
  try {
    const cutoff = new Date(Date.now() - (dedupDays - 1) * 86400000).toISOString().slice(0, 10);
    const existing = await supabaseRequest('GET',
      `alerts?user_id=eq.${encodeURIComponent(userId)}&type=eq.${encodeURIComponent(type)}&created_at=gte.${cutoff}T00:00:00Z&select=id`,
      null
    );
    const rows = JSON.parse(existing.body);
    if (Array.isArray(rows) && rows.length > 0) return; // already alerted within dedup window

    // Write alert record
    await supabaseRequest('POST', 'alerts',
      { user_id: userId, type, severity, title, description, whatsapp_sent: false }
    );

    // Send WhatsApp for high/medium severity
    if ((severity === 'high' || severity === 'medium') && TWILIO_SID && TWILIO_TOKEN) {
      const profileRes = await supabaseRequest('GET',
        `profiles?id=eq.${encodeURIComponent(userId)}&select=phone,full_name`,
        null
      );
      const profiles = JSON.parse(profileRes.body);
      const phone = Array.isArray(profiles) && profiles[0]?.phone;
      if (phone) {
        const icon = severity === 'high' ? '🚨' : '⚠️';
        const msg = `${icon} *ProCyberWall Alert*\n\n*${title}*\n\n${description}\n\nLog in to your dashboard to view details.\n\n— ProCyberWall`;
        sendTwilioMessage(phone, msg).catch(() => {});
        // Mark whatsapp_sent
        const today = new Date().toISOString().slice(0, 10);
        await supabaseRequest('PATCH',
          `alerts?user_id=eq.${encodeURIComponent(userId)}&type=eq.${encodeURIComponent(type)}&created_at=gte.${today}T00:00:00Z`,
          { whatsapp_sent: true }
        ).catch(() => {});
      }
    }
  } catch (e) {
    console.error('createAlert error:', e.message);
  }
}

module.exports = { createAlert };
