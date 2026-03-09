const http = require('http');
const https = require('https');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TWILIO_SID   = "ACe4cee4b4db65de112cd6a26156994c8b";
const TWILIO_TOKEN = "83bd0490a83a0c5420b5d08f9902720e";
const TWILIO_FROM  = "whatsapp:+14155238886";

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  console.log(`→ ${req.method} ${req.url}`);

  if (req.method === 'POST' && req.url === '/.netlify/functions/send-whatsapp') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { to, message } = JSON.parse(body);

      const toFormatted = to.startsWith('whatsapp:')
        ? to
        : `whatsapp:+91${to.replace(/\D/g, '').slice(-10)}`;

      const params = new URLSearchParams({
        From: TWILIO_FROM,
        To: toFormatted,
        Body: message
      }).toString();

      const options = {
        hostname: 'api.twilio.com',
        path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(params)
        }
      };

      const twilioReq = https.request(options, twilioRes => {
        let data = '';
        twilioRes.on('data', chunk => data += chunk);
        twilioRes.on('end', () => {
          const result = JSON.parse(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (result.sid) {
            res.end(JSON.stringify({ success: true, sid: result.sid }));
          } else {
            res.end(JSON.stringify({ success: false, error: result.message }));
          }
        });
      });

      twilioReq.on('error', err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      });

      twilioReq.write(params);
      twilioReq.end();
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/ai-chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages, domain, plan } = JSON.parse(body);

        const systemPrompt = `You are CyberWall AI, a friendly cybersecurity assistant built into the CyberWall dashboard.
You help clients understand their website security, explain threats, and answer questions about their WAF protection.

The client's protected domain is: ${domain || 'not set yet'}
Their plan is: ${plan || 'starter'}

Keep responses concise, friendly, and non-technical where possible.
If asked about something unrelated to cybersecurity or their website, politely redirect.`;

        const response = await anthropic.messages.create({
          model: 'claude-opus-4-6',
          max_tokens: 1024,
          system: systemPrompt,
          messages: messages
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, reply: response.content[0].text }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(3001, () => {
  console.log('✅ WhatsApp server running at http://localhost:3001');
});
