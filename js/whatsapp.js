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

// Sent to CLIENT when their monthly report is ready (manual send from admin panel)
function alertClientReport(clientName, month) {
  return `📄 *ProCyberWall Monthly Report*

Hi ${clientName}!

Your *${month} Security Report* is ready.

Log in to download your report and see a full summary of threats blocked this month.

_Download: ${window.location.origin}/dashboard.html_

— ProCyberWall Team 🇮🇳`;
}

// ---- SEND ALERT BUTTONS (called from admin panel) ----

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
