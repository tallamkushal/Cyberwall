// ============================================
// CYBERWALL — WhatsApp Alerts
// This file sends real WhatsApp messages
// to clients and admin using Twilio API
// ============================================

const TWILIO_SID   = "ACe4cee4b4db65de112cd6a26156994c8b";
const TWILIO_TOKEN = "83bd0490a83a0c5420b5d08f9902720e";
const TWILIO_FROM  = "whatsapp:+14155238886"; // Twilio sandbox number

// ============================================
// NOTE: In production, NEVER put API keys in
// frontend JS. These should be in a backend.
// For now this calls a Netlify serverless
// function which keeps keys safe.
// ============================================

// ---- SEND WHATSAPP MESSAGE ----
async function sendWhatsApp(toPhone, message) {
  try {
    const response = await fetch('/.netlify/functions/send-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: toPhone,
        message: message
      })
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
  return `🛡 *CyberWall Alert*

Hi ${clientName}!

⚠️ *${count} ${threatType} attacks* were just blocked on *${domain}*.

✅ Your website is safe — we blocked all of them automatically.

No action needed from your side. We're on it 24/7.

_View details: ${window.location.origin}/dashboard.html_

— CyberWall Team 🇮🇳`;
}

// Sent to CLIENT when their monthly report is ready
function alertClientReport(clientName, month) {
  return `📄 *CyberWall Monthly Report*

Hi ${clientName}!

Your *${month} Security Report* is ready.

Log in to download your report and see a full summary of threats blocked this month.

_Download: ${window.location.origin}/dashboard.html_

— CyberWall Team 🇮🇳`;
}

// Sent to CLIENT when setup is complete
function alertClientSetupDone(clientName, domain) {
  return `🎉 *CyberWall is Live!*

Hi ${clientName}!

Great news — your website *${domain}* is now protected by CyberWall WAF!

✅ WAF rules active
✅ SSL monitoring active  
✅ Bot protection active
✅ DDoS protection active

You can now view your security dashboard anytime.

_Dashboard: ${window.location.origin}/dashboard.html_

Welcome to CyberWall! 🛡🇮🇳`;
}

// Sent to ADMIN when a new client signs up
function alertAdminNewSignup(clientName, email, plan, domain) {
  return `🆕 *New CyberWall Signup!*

*Name:* ${clientName}
*Email:* ${email}
*Plan:* ${plan.toUpperCase()}
*Domain:* ${domain}

*Action needed:*
1. Add domain to Cloudflare
2. Configure WAF rules
3. Send setup confirmation

_Admin panel: ${window.location.origin}/admin.html_

— CyberWall System`;
}

// Sent to ADMIN when payment fails
function alertAdminPaymentFailed(clientName, email, amount) {
  return `⚠️ *Payment Failed*

*Client:* ${clientName}
*Email:* ${email}
*Amount:* ₹${amount}

Please follow up with client on WhatsApp.

— CyberWall System`;
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

async function notifyAdminNewSignup(clientName, email, plan, domain) {
  const adminPhone = '+919844482193'; // Kushal's WhatsApp
  const message = alertAdminNewSignup(clientName, email, plan, domain);
  return await sendWhatsApp(adminPhone, message);
}