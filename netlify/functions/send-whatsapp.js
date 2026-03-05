// ============================================
// CYBERWALL — Netlify Serverless Function
// File: netlify/functions/send-whatsapp.js
//
// This runs on Netlify's servers (not in
// the browser) so API keys stay safe.
//
// Called by whatsapp.js in the frontend.
// ============================================

exports.handler = async (event) => {

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { to, message } = JSON.parse(event.body);

    // Twilio credentials
    const TWILIO_SID   = "ACe4cee4b4db65de112cd6a26156994c8b";
    const TWILIO_TOKEN = "f1d9ccb32b712c875e10022bcb311628";
    const TWILIO_FROM  = "whatsapp:+14155238886";

    // Format phone number
    // Must be in format: whatsapp:+919876543210
    const toFormatted = to.startsWith('whatsapp:')
      ? to
      : `whatsapp:+91${to.replace(/\D/g, '').slice(-10)}`;

    // Call Twilio API
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          From: TWILIO_FROM,
          To: toFormatted,
          Body: message
        })
      }
    );

    const data = await response.json();

    if (data.sid) {
      // Message sent successfully
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, sid: data.sid })
      };
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: data.message })
      };
    }

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
