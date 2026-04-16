const https = require('https');

const TWILIO_SID   = process.env.TWILIO_SID   || '';
const TWILIO_TOKEN = process.env.TWILIO_TOKEN  || '';
const TWILIO_FROM  = process.env.TWILIO_FROM   || 'whatsapp:+14155238886';

function sendTwilioMessage(to, message) {
  return new Promise((resolve, reject) => {
    // Normalise the destination to whatsapp:+<E.164> format.
    // Handles: already-formatted "whatsapp:+...", E.164 "+...", or bare digits.
    const clean = to.replace(/\s/g, '');
    const toFormatted = clean.startsWith('whatsapp:') ? clean
      : clean.startsWith('+')                          ? `whatsapp:${clean}`
      :                                                  `whatsapp:+${clean.replace(/\D/g, '')}`;

    const params = new URLSearchParams({ From: TWILIO_FROM, To: toFormatted, Body: message }).toString();
    const opts = {
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params)
      }
    };
    const r = https.request(opts, resp => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try {
          const body = JSON.parse(data);
          if (resp.statusCode >= 400) reject(new Error(body.message || `Twilio error ${resp.statusCode}`));
          else resolve(body);
        } catch(e) { reject(e); }
      });
    });
    r.on('error', reject);
    r.setTimeout(15000, () => { r.destroy(); reject(new Error('Twilio request timed out')); });
    r.write(params);
    r.end();
  });
}

module.exports = { sendTwilioMessage, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM };
