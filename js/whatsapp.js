// ============================================
// CYBERWALL — WhatsApp Alerts
// Sends WhatsApp messages via the ProCyberWall
// backend (server.js → Twilio API).
// Credentials never exposed to the browser.
// ============================================

var SERVER = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : '';

// ---- SEND WHATSAPP MESSAGE ----
async function sendWhatsApp(toPhone, message) {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const headers = { 'Content-Type': 'application/json' };
    if (session?.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
    const response = await fetch(`${SERVER}/api/whatsapp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ to: toPhone, message })
    });
    const data = await response.json();
    return data.success ? { success: true } : { success: false, error: data.error };
  } catch (err) {
    console.error('WhatsApp error:', err);
    return { success: false, error: err.message };
  }
}

// ---- ALERT TEMPLATES ----

// Sent to CLIENT when a serious attack is blocked
function alertClientThreat(clientName, domain, threatType, count) {
  return `🛡 *ProCyberWall Alert*

Hi ${clientName}!

⚠️ *${count} ${threatType} attacks* were just blocked on *${domain}*.

✅ Your website is safe — we blocked all of them automatically.

No action needed from your side. We're on it 24/7.

_View details: ${window.location.origin}/dashboard.html_

— ProCyberWall Team 🇮🇳`;
}

// Sent to CLIENT when their monthly report is ready
function alertClientReport(clientName, month) {
  return `📄 *ProCyberWall Monthly Report*

Hi ${clientName}!

Your *${month} Security Report* is ready.

Log in to download your report and see a full summary of threats blocked this month.

_Download: ${window.location.origin}/dashboard.html_

— ProCyberWall Team 🇮🇳`;
}

// Sent to CLIENT when setup is complete
function alertClientSetupDone(clientName, domain) {
  return `🎉 *ProCyberWall is Live!*

Hi ${clientName}!

Great news — your website *${domain}* is now protected by ProCyberWall WAF!

✅ WAF rules active
✅ SSL monitoring active  
✅ Bot protection active
✅ DDoS protection active

You can now view your security dashboard anytime.

_Dashboard: ${window.location.origin}/dashboard.html_

Welcome to ProCyberWall! 🛡🇮🇳`;
}

// Sent to ADMIN when a new client signs up
function alertAdminNewSignup(clientName, email, plan, domain) {
  plan = plan || 'starter';
  return `🆕 *New ProCyberWall Signup!*

*Name:* ${clientName}
*Email:* ${email}
*Plan:* ${plan.toUpperCase()}
*Domain:* ${domain}

*Action needed:*
1. Add domain to Cloudflare
2. Configure WAF rules
3. Send setup confirmation

_Admin panel: ${window.location.origin}/admin.html_

— ProCyberWall System`;
}

// Sent to ADMIN when payment fails
function alertAdminPaymentFailed(clientName, email, amount) {
  return `⚠️ *Payment Failed*

*Client:* ${clientName}
*Email:* ${email}
*Amount:* ₹${amount}

Please follow up with client on WhatsApp.

— ProCyberWall System`;
}

// ---- SEND ALERT BUTTONS (called from admin panel) ----

async function sendSetupCompleteAlert(clientPhone, clientName, domain) {
  const message = alertClientSetupDone(clientName, domain);
  const result = await sendWhatsApp(clientPhone, message);
  if (result.success) {
    showToast(`WhatsApp sent to ${clientName} ✅`, 'success');
  } else {
    showToast('Failed to send WhatsApp', 'error');
  }
  return result;
}

async function sendReportReadyAlert(clientPhone, clientName, month) {
  const message = alertClientReport(clientName, month);
  const result = await sendWhatsApp(clientPhone, message);
  if (result.success) {
    showToast(`Report alert sent to ${clientName} ✅`, 'success');
  } else {
    showToast('Failed to send WhatsApp', 'error');
  }
  return result;
}

// Admin signup notification is now handled server-side in /api/create-profile.
