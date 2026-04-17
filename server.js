const http = require('http');
const fs   = require('fs');
const path = require('path');

const alertsRouter    = require('./routes/alerts');
const aiRouter        = require('./routes/ai');
const cfRouter        = require('./routes/cloudflare');
const adminRouter     = require('./routes/admin');
const ticketsRouter   = require('./routes/tickets');
const miscRouter      = require('./routes/misc');
const jobs            = require('./jobs/index');

// ── ENV CHECK ─────────────────────────────────────────────────────────────────
const REQUIRED_ENV = ['ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_KEY'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// ── HTTP SERVER ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS
  const allowedOrigins = ['https://cyberwall.onrender.com', 'https://procyberwall.com', 'https://www.procyberwall.com', 'http://localhost:3001'];
  const origin = req.headers['origin'] || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'HEAD') { res.writeHead(200); res.end(); return; }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  console.log(`→ ${req.method} ${req.url}`);
  const parsedUrl = new URL(req.url, 'http://localhost');

  // ── HEALTH CHECK ─────────────────────────────────────────────────────────
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ts: Date.now() }));
    return;
  }

  // ── API ROUTES ────────────────────────────────────────────────────────────
  if (await alertsRouter.handle(req, res, parsedUrl))  return;
  if (await aiRouter.handle(req, res, parsedUrl))      return;
  if (await cfRouter.handle(req, res, parsedUrl))      return;
  if (await adminRouter.handle(req, res, parsedUrl))   return;
  if (await ticketsRouter.handle(req, res, parsedUrl)) return;
  if (await miscRouter.handle(req, res, parsedUrl))    return;

  // ── STATIC FILE SERVING ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

    const filePath = path.join(__dirname, urlPath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.css':  'text/css',
      '.js':   'application/javascript',
      '.json': 'application/json',
      '.png':  'image/png',
      '.jpg':  'image/jpeg',
      '.svg':  'image/svg+xml',
      '.ico':  'image/x-icon',
    };

    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const noCache = ['.html', '.js', '.css'].includes(ext);
      const headers = { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' };
      if (noCache) headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      res.writeHead(200, headers);
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ── SCHEDULED JOBS ────────────────────────────────────────────────────────────
jobs.start();

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ ProCyberWall server running at http://localhost:${PORT}`);
});
