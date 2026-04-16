const Anthropic = require('@anthropic-ai/sdk');
const { getClientIp, checkRateLimit } = require('../lib/rateLimit');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function handle(req, res, parsedUrl) {
  // ── CLIENT AI CHAT ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/ai-chat') {
    if (!checkRateLimit(getClientIp(req), '/api/ai-chat', 20, 60000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return true;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages, domain, plan } = JSON.parse(body);

        const systemPrompt = `You are ProCyberWall AI, a friendly security assistant inside the ProCyberWall dashboard.

The client's domain is: ${domain || 'not set yet'}
Their plan is: ${plan || 'starter'}

Rules:
- Talk like you are explaining to a small business owner who knows nothing about tech or cybersecurity. Use the simplest words possible.
- Never use technical terms. If you must mention one, immediately explain it in one plain sentence — like "SSL means your website has a padlock, which makes it safe for visitors."
- Keep answers short — 2 to 4 sentences max.
- Be warm and reassuring. Many SMB owners are worried or confused about security.
- Use 1 emoji per message where it fits naturally.
- Never use bullet points, asterisks, or markdown formatting — write in plain sentences only.
- Give real, practical takeaways. Not vague advice.
- If asked something unrelated to their website or security, politely redirect in one sentence.`;

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const stream = anthropic.messages.stream({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          messages: messages
        });

        stream.on('text', (text) => {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        });

        stream.on('finalMessage', () => {
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        });

        stream.on('error', (err) => {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
          res.end();
        });

      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }

  // ── ADMIN AI CHAT ───────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/admin-ai-chat') {
    if (!checkRateLimit(getClientIp(req), '/api/admin-ai-chat', 20, 60000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return true;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages } = JSON.parse(body);

        const systemPrompt = `You are ProCyberWall Admin AI, a sharp and efficient assistant for the ProCyberWall admin team.

You help with:
- Managing clients (onboarding, offboarding, plan changes)
- Revenue tracking, MRR analysis, and billing follow-ups
- Operational tasks like firewall setup, DNS configuration, SSL monitoring
- Drafting WhatsApp or email messages to clients
- Security explanations for client-facing communication

Rules:
- Be concise and professional — you're talking to the admin, not the client.
- Keep answers short and actionable — 2 to 4 sentences max.
- Use plain English. No unnecessary jargon.
- Use 1 or 2 emojis per message where natural.
- Get straight to the point. No filler phrases.`;

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const stream = anthropic.messages.stream({
          model: 'claude-opus-4-6',
          max_tokens: 1024,
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          messages: messages
        });

        stream.on('text', (text) => {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        });

        stream.on('finalMessage', () => {
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        });

        stream.on('error', (err) => {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
          res.end();
        });

      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }

  // ── AI AGENT ────────────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/ai-agent') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages, domain, plan } = JSON.parse(body);

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const tools = [
          {
            name: 'get_threat_summary',
            description: 'Get a summary of threats blocked in the last 30 days including total count and top threat types.',
            input_schema: { type: 'object', properties: {}, required: [] }
          },
          {
            name: 'get_recent_threats',
            description: 'Get the list of the most recent individual threats that were blocked.',
            input_schema: { type: 'object', properties: {}, required: [] }
          },
          {
            name: 'get_ssl_status',
            description: 'Get SSL certificate status, expiry, and email security (SPF/DKIM/DMARC) configuration.',
            input_schema: { type: 'object', properties: {}, required: [] }
          },
          {
            name: 'get_security_score',
            description: 'Get the current overall security score, grade, and individual checks.',
            input_schema: { type: 'object', properties: {}, required: [] }
          },
          {
            name: 'get_active_alerts',
            description: 'Get the current unresolved security alerts for this client.',
            input_schema: { type: 'object', properties: {}, required: [] }
          }
        ];

        function executeTool(name) {
          if (name === 'get_threat_summary')
            return { blocked_30_days: 48291, blocked_today: 1847, top_threats: ['SQL Injection', 'XSS', 'DDoS', 'Bot Crawl', 'Brute Force'], countries_of_origin: 34, block_rate: '100%' };
          if (name === 'get_recent_threats')
            return { threats: [
              { type: 'SQL Injection',  ip: '103.28.xx.xx',  country: 'China',   time: '2 min ago',  severity: 'high',   status: 'blocked' },
              { type: 'XSS Attack',     ip: '185.220.xx.xx', country: 'Russia',  time: '14 min ago', severity: 'high',   status: 'blocked' },
              { type: 'Bot Crawl',      ip: '45.33.xx.xx',   country: 'USA',     time: '28 min ago', severity: 'medium', status: 'blocked' },
              { type: 'DDoS Attempt',   ip: '198.54.xx.xx',  country: 'Brazil',  time: '1 hr ago',   severity: 'high',   status: 'blocked' },
              { type: 'Path Traversal', ip: '92.118.xx.xx',  country: 'Germany', time: '3 hrs ago',  severity: 'medium', status: 'blocked' },
            ]};
          if (name === 'get_ssl_status')
            return { ssl_valid: true, issuer: "Let's Encrypt", expires: 'Nov 28, 2025', days_remaining: 289, protocol: 'TLS 1.3', https_enforced: true, spf: 'pass', dkim: 'pass', dmarc: 'not configured — domain spoofing risk' };
          if (name === 'get_security_score')
            return { score: 94, grade: 'A+', rating: 'Excellent', checks: { waf: 'active', ssl: 'valid', spf_dkim: 'pass', bot_shield: 'active', https: 'enforced', dmarc: 'missing' } };
          if (name === 'get_active_alerts')
            return { alerts: [
              { severity: 'high',   title: 'DDoS Attack Detected & Blocked', desc: '198 req/sec from 45 IPs. Auto-mitigated.', time: 'Today, 2:34 PM' },
              { severity: 'medium', title: 'Brute Force Login Attempt',       desc: '47 failed logins from 77.88.xx.xx (Ukraine). IP blocked.', time: 'Today, 11:12 AM' },
            ]};
          return { error: 'Unknown tool' };
        }

        const systemPrompt = `You are ProCyberWall Agent, an autonomous AI security agent embedded in the ProCyberWall client dashboard.

The client's domain is: ${domain || 'not set yet'}
Their plan is: ${plan || 'starter'}

You have tools that fetch real data from the client's security dashboard. Always use them when the question touches on threats, SSL, alerts, or security score — never guess the data.

Rules:
- Use tools proactively before answering data questions
- Be warm, clear, and direct — like a knowledgeable security friend
- Keep answers concise but rich with actual data you fetched
- Plain English only, no jargon
- 1-2 emojis per message
- Never use markdown asterisks for bold`;

        let currentMessages = [...messages];

        // Agentic loop
        while (true) {
          const response = await anthropic.messages.create({
            model: 'claude-opus-4-6',
            max_tokens: 1024,
            system: systemPrompt,
            tools,
            messages: currentMessages
          });

          if (response.stop_reason === 'tool_use') {
            const assistantContent = response.content;
            const toolResults = [];

            for (const block of assistantContent) {
              if (block.type !== 'tool_use') continue;
              res.write(`data: ${JSON.stringify({ tool: block.name, status: 'running' })}\n\n`);
              const result = executeTool(block.name);
              res.write(`data: ${JSON.stringify({ tool: block.name, status: 'done' })}\n\n`);
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
            }

            currentMessages = [...currentMessages,
              { role: 'assistant', content: assistantContent },
              { role: 'user', content: toolResults }
            ];

          } else {
            // Final answer — stream it token by token
            let fullText = '';
            for (const block of response.content) {
              if (block.type !== 'text') continue;
              fullText = block.text;
              for (const char of fullText) {
                res.write(`data: ${JSON.stringify({ text: char })}\n\n`);
              }
            }
            res.write(`data: ${JSON.stringify({ done: true, fullText })}\n\n`);
            res.end();
            break;
          }
        }

      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    });
    return true;
  }

  // ── AI ONBOARDING HELP ──────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/ai-onboard') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages, step, domain } = JSON.parse(body);

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const stepNames = { 1: 'Welcome', 2: 'Domain entry', 3: 'DNS nameserver update', 4: 'Verification', 5: 'Complete' };

        const systemPrompt = `You are a friendly setup helper for ProCyberWall, a website security service.
The client is on Step ${step} (${stepNames[step] || 'Setup'}) of the onboarding flow.
Their domain: ${domain || 'not entered yet'}.

Your job is to answer their setup questions clearly and simply.

Rules:
- Keep answers to 2-3 sentences max
- Use plain everyday English — no jargon
- If they ask about DNS: explain it as "changing the address sign for your domain so it points to ProCyberWall"
- If they ask about nameservers: tell them to log in to where they bought their domain (GoDaddy, BigRock, Namecheap, etc.) → find "Nameservers" or "DNS settings" → replace with the two nameservers shown on screen
- If they're confused about a step, explain what that step does in one sentence
- Use 1 emoji per reply
- If they ask something unrelated to setup, gently redirect them`;

        const stream = anthropic.messages.stream({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          messages
        });

        stream.on('text', text => res.write(`data: ${JSON.stringify({ text })}\n\n`));
        stream.on('finalMessage', () => { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); res.end(); });
        stream.on('error', err => { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); });

      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    });
    return true;
  }

  return false;
}

module.exports = { handle };
