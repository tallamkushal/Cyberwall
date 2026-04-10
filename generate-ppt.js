const PptxGenJS = require('pptxgenjs');
const prs = new PptxGenJS();

// ── Theme ──────────────────────────────────────────────────────────────────
const BG     = '0D1117';
const SURF   = '161B22';
const ACCENT = '00C2FF';
const WHITE  = 'FFFFFF';
const MUTED  = '8B9AA8';
const GREEN  = '00D97E';
const RED    = 'FF5A5F';
const ORANGE = 'F59E0B';
const BORDER = '21262D';
const DARK   = '0A0E13';

// Pre-blended tint colors (alpha composited over SURF #161B22)
// 13% opacity tints (hex 22)
const GREEN_T13  = '13342E'; // GREEN  13% over SURF
const ACCENT_T13 = '13313F'; // ACCENT 13% over SURF
const RED_T13    = '35232A'; // RED    13% over SURF
const ORANGE_T13 = '342C1F'; // ORANGE 13% over SURF
const FEE_T13    = '35353C'; // fee2e2 13% over SURF (icon bg red)
const DCF_T13    = '30393C'; // dcfce7 13% over SURF (icon bg green)
const DBE_T13    = '30373F'; // dbeafe 13% over SURF (icon bg blue)
const F0F_T13    = '33393E'; // f0fdf4 13% over SURF (icon bg light green)
const FEF_T13    = '353937'; // fef9c3 13% over SURF (icon bg yellow)
// 33% opacity tints (hex 55)
const ACCENT_T33 = '0F536C'; // ACCENT 33% over SURF (chart bar)
// 7% opacity tints (hex 11)
const RED_T7     = '261F26'; // RED    7% over SURF (alert bg high)
const ORANGE_T7  = '252420'; // ORANGE 7% over SURF (alert bg medium)
const ACCENT_T7  = '152631'; // ACCENT 7% over SURF
// 60% opacity (hex 99)
const MUTED60    = '5C6772'; // MUTED  60% — dimmed text

prs.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in

// ── Helpers ────────────────────────────────────────────────────────────────
function newSlide() {
  const s = prs.addSlide();
  s.background = { color: BG };
  return s;
}

// Map a color to its 13%-opacity tinted version (pre-blended over SURF)
const TINT = { [GREEN]: GREEN_T13, [ACCENT]: ACCENT_T13, [RED]: RED_T13, [ORANGE]: ORANGE_T13 };
function tint(color) { return TINT[color] || SURF; }

function pill(s, text, x, y, color = ACCENT) {
  s.addShape(prs.ShapeType.roundRect, { x, y, w: 1.5, h: 0.3, fill: { color: tint(color) }, line: { color, width: 1 }, rectRadius: 0.15 });
  s.addText(text, { x, y: y + 0.02, w: 1.5, h: 0.27, fontSize: 8, color, bold: true, fontFace: 'Segoe UI', align: 'center' });
}

function badge(s, text, x, y, color = GREEN) {
  s.addShape(prs.ShapeType.roundRect, { x, y, w: 1.1, h: 0.28, fill: { color: tint(color) }, line: { color, width: 1 }, rectRadius: 0.06 });
  s.addText(text, { x, y: y + 0.01, w: 1.1, h: 0.26, fontSize: 8, color, bold: true, fontFace: 'Segoe UI', align: 'center' });
}

function card(s, x, y, w, h, { border = BORDER, bg = SURF } = {}) {
  s.addShape(prs.ShapeType.roundRect, { x, y, w, h, fill: { color: bg }, line: { color: border, width: 1 }, rectRadius: 0.1 });
}

function heading(s, text, y = 0.38, size = 21) {
  s.addText(text, { x: 0.5, y, w: 12.33, h: 0.6, fontSize: size, bold: true, color: WHITE, fontFace: 'Segoe UI' });
}

function sub(s, text, y = 1.05) {
  s.addText(text, { x: 0.5, y, w: 12.33, h: 0.35, fontSize: 10, color: MUTED, fontFace: 'Segoe UI' });
}

// ── Draw a pixel-perfect sidebar (reused across dashboard slides) ──────────
function drawSidebar(s) {
  // Sidebar bg
  s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 2.15, h: 7.5, fill: { color: DARK }, line: { color: DARK, width: 0 } });
  s.addShape(prs.ShapeType.line, { x: 2.15, y: 0, w: 0, h: 7.5, line: { color: BORDER, width: 0.5 } });

  // Logo
  s.addShape(prs.ShapeType.roundRect, { x: 0.18, y: 0.18, w: 0.35, h: 0.35, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 }, rectRadius: 0.05 });
  s.addText('🛡', { x: 0.18, y: 0.18, w: 0.35, h: 0.35, fontSize: 10, align: 'center' });
  s.addText('CyberWall', { x: 0.6, y: 0.22, w: 1.4, h: 0.28, fontSize: 9.5, bold: true, color: WHITE, fontFace: 'Segoe UI' });

  s.addShape(prs.ShapeType.line, { x: 0, y: 0.65, w: 2.15, h: 0, line: { color: BORDER, width: 0.5 } });

  // Section label
  s.addText('OVERVIEW', { x: 0.18, y: 0.75, w: 1.8, h: 0.22, fontSize: 7.5, color: MUTED, fontFace: 'Segoe UI', bold: true });

  const items = [
    { icon: '📊', label: 'Dashboard',    active: true  },
    { icon: '🚨', label: 'Threats',      active: false, notif: '12' },
    { icon: '📄', label: 'Reports',      active: false },
  ];
  items.forEach((item, i) => {
    const iy = 1.02 + i * 0.38;
    if (item.active) {
      s.addShape(prs.ShapeType.roundRect, { x: 0.1, y: iy, w: 1.95, h: 0.32, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 }, rectRadius: 0.06 });
    }
    s.addText(item.icon + '  ' + item.label, { x: 0.18, y: iy + 0.05, w: 1.6, h: 0.22, fontSize: 8.5, color: item.active ? DARK : MUTED, fontFace: 'Segoe UI', bold: item.active });
    if (item.notif) {
      s.addShape(prs.ShapeType.roundRect, { x: 1.75, y: iy + 0.06, w: 0.28, h: 0.2, fill: { color: RED }, line: { color: RED, width: 0 }, rectRadius: 0.05 });
      s.addText(item.notif, { x: 1.75, y: iy + 0.07, w: 0.28, h: 0.18, fontSize: 7.5, bold: true, color: WHITE, fontFace: 'Segoe UI', align: 'center' });
    }
  });

  s.addText('SECURITY', { x: 0.18, y: 2.18, w: 1.8, h: 0.22, fontSize: 7.5, color: MUTED, fontFace: 'Segoe UI', bold: true });
  const sec = [
    { icon: '🔐', label: 'SSL Monitor' },
    { icon: '🔔', label: 'Alerts', notif: '3' },
  ];
  sec.forEach((item, i) => {
    const iy = 2.45 + i * 0.38;
    s.addText(item.icon + '  ' + item.label, { x: 0.18, y: iy + 0.05, w: 1.6, h: 0.22, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });
    if (item.notif) {
      s.addShape(prs.ShapeType.roundRect, { x: 1.75, y: iy + 0.06, w: 0.28, h: 0.2, fill: { color: RED }, line: { color: RED, width: 0 }, rectRadius: 0.05 });
      s.addText(item.notif, { x: 1.75, y: iy + 0.07, w: 0.28, h: 0.18, fontSize: 7.5, bold: true, color: WHITE, fontFace: 'Segoe UI', align: 'center' });
    }
  });

  s.addText('AI', { x: 0.18, y: 3.3, w: 1.8, h: 0.22, fontSize: 7.5, color: MUTED, fontFace: 'Segoe UI', bold: true });
  s.addText('🤖  AI Assistant', { x: 0.18, y: 3.55, w: 1.8, h: 0.22, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });

  s.addText('ACCOUNT', { x: 0.18, y: 3.95, w: 1.8, h: 0.22, fontSize: 7.5, color: MUTED, fontFace: 'Segoe UI', bold: true });
  s.addText('💳  Billing', { x: 0.18, y: 4.2, w: 1.8, h: 0.22, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });
  s.addText('⚙️  Settings', { x: 0.18, y: 4.58, w: 1.8, h: 0.22, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });

  // User footer
  s.addShape(prs.ShapeType.line, { x: 0, y: 6.7, w: 2.15, h: 0, line: { color: BORDER, width: 0.5 } });
  s.addShape(prs.ShapeType.ellipse, { x: 0.18, y: 6.82, w: 0.38, h: 0.38, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 } });
  s.addText('RS', { x: 0.18, y: 0.82 + 6, w: 0.38, h: 0.38, fontSize: 8, bold: true, color: DARK, align: 'center', fontFace: 'Segoe UI' });
  s.addText('Rahul Sharma', { x: 0.65, y: 6.85, w: 1.35, h: 0.18, fontSize: 8, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  s.addText('Pro Plan', { x: 0.65, y: 7.05, w: 1.35, h: 0.18, fontSize: 7.5, color: MUTED, fontFace: 'Segoe UI' });
}

// ── Draw topbar ────────────────────────────────────────────────────────────
function drawTopbar(s, title = 'Dashboard') {
  s.addShape(prs.ShapeType.rect, { x: 2.15, y: 0, w: 11.18, h: 0.62, fill: { color: SURF }, line: { color: BORDER, width: 0 } });
  s.addShape(prs.ShapeType.line, { x: 2.15, y: 0.62, w: 11.18, h: 0, line: { color: BORDER, width: 0.5 } });
  s.addText(title, { x: 2.35, y: 0.17, w: 3, h: 0.3, fontSize: 10, bold: true, color: WHITE, fontFace: 'Segoe UI' });

  // Protected badge
  s.addShape(prs.ShapeType.roundRect, { x: 5.0, y: 0.18, w: 1.2, h: 0.26, fill: { color: GREEN_T13 }, line: { color: GREEN, width: 1 }, rectRadius: 0.06 });
  s.addShape(prs.ShapeType.ellipse, { x: 5.1, y: 0.29, w: 0.09, h: 0.09, fill: { color: GREEN }, line: { color: GREEN, width: 0 } });
  s.addText('Protected', { x: 5.2, y: 0.2, w: 0.95, h: 0.22, fontSize: 7.5, color: GREEN, bold: true, fontFace: 'Segoe UI' });

  // Right badges
  s.addShape(prs.ShapeType.roundRect, { x: 10.5, y: 0.17, w: 1.0, h: 0.27, fill: { color: ACCENT_T13 }, line: { color: ACCENT, width: 1 }, rectRadius: 0.06 });
  s.addText('Pro Plan', { x: 10.5, y: 0.19, w: 1.0, h: 0.23, fontSize: 7.5, color: ACCENT, bold: true, fontFace: 'Segoe UI', align: 'center' });

  s.addShape(prs.ShapeType.roundRect, { x: 11.65, y: 0.17, w: 1.45, h: 0.27, fill: { color: SURF }, line: { color: BORDER, width: 1 }, rectRadius: 0.06 });
  s.addText('↓ Download Report', { x: 11.65, y: 0.19, w: 1.45, h: 0.23, fontSize: 7.5, color: MUTED, fontFace: 'Segoe UI', align: 'center' });
}

// ── Stat card ──────────────────────────────────────────────────────────────
function statCard(s, x, y, icon, iconBg, value, label, badge_text, badge_color = GREEN) {
  card(s, x, y, 2.55, 1.3);
  // icon box
  s.addShape(prs.ShapeType.roundRect, { x: x + 0.15, y: y + 0.15, w: 0.42, h: 0.42, fill: { color: iconBg }, line: { color: iconBg, width: 0 }, rectRadius: 0.07 });
  s.addText(icon, { x: x + 0.15, y: y + 0.17, w: 0.42, h: 0.38, fontSize: 11, align: 'center' });
  // badge top-right
  s.addShape(prs.ShapeType.roundRect, { x: x + 1.95, y: y + 0.15, w: 0.5, h: 0.22, fill: { color: tint(badge_color) }, line: { color: badge_color, width: 1 }, rectRadius: 0.05 });
  s.addText(badge_text, { x: x + 1.95, y: y + 0.16, w: 0.5, h: 0.2, fontSize: 7.5, color: badge_color, bold: true, fontFace: 'Segoe UI', align: 'center' });
  // value
  s.addText(value, { x: x + 0.15, y: y + 0.65, w: 2.3, h: 0.42, fontSize: 15, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  // label
  s.addText(label, { x: x + 0.15, y: y + 1.05, w: 2.3, h: 0.22, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });
}

// ── Draw bar chart ─────────────────────────────────────────────────────────
function barChart(s, x, y, w, h) {
  const days   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const vals   = [312, 589, 741, 1982, 1124, 430, 290];
  const max    = Math.max(...vals);
  const bw     = (w - 0.2) / days.length - 0.06;
  const chartH = h - 0.45;

  days.forEach((d, i) => {
    const bh = (vals[i] / max) * chartH;
    const bx = x + 0.1 + i * (bw + 0.06);
    const by = y + chartH - bh;
    // value label
    s.addText(vals[i] >= 1000 ? (vals[i]/1000).toFixed(1)+'K' : vals[i]+'', {
      x: bx, y: by - 0.22, w: bw, h: 0.2, fontSize: 7.5, color: MUTED, fontFace: 'Segoe UI', align: 'center'
    });
    s.addShape(prs.ShapeType.roundRect, {
      x: bx, y: by, w: bw, h: bh,
      fill: { color: i === 3 ? ACCENT : ACCENT_T33 },
      line: { color: i === 3 ? ACCENT : ACCENT_T33, width: 0 },
      rectRadius: 0.04
    });
    s.addText(d, { x: bx, y: y + chartH + 0.05, w: bw, h: 0.18, fontSize: 7.5, color: MUTED, fontFace: 'Segoe UI', align: 'center' });
  });
}

// ── Threats table row ──────────────────────────────────────────────────────
function threatRow(s, x, y, type, ip, country, target, time, severity, even) {
  if (even) s.addShape(prs.ShapeType.rect, { x, y, w: 10.5, h: 0.32, fill: { color: BG }, line: { color: BG, width: 0 } });
  const sevColor = severity === 'High' ? RED : ORANGE;
  s.addText(type,    { x: x + 0.1,  y: y + 0.07, w: 2.2, h: 0.2, fontSize: 8.5, color: WHITE, fontFace: 'Segoe UI' });
  s.addText(ip,      { x: x + 2.4,  y: y + 0.07, w: 2.1, h: 0.2, fontSize: 8,   color: MUTED, fontFace: 'Courier New' });
  s.addText(country, { x: x + 4.6,  y: y + 0.07, w: 1.5, h: 0.2, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });
  s.addText(target,  { x: x + 6.2,  y: y + 0.07, w: 1.8, h: 0.2, fontSize: 8,   color: MUTED, fontFace: 'Courier New' });
  s.addText(time,    { x: x + 8.1,  y: y + 0.07, w: 1.1, h: 0.2, fontSize: 8,   color: MUTED, fontFace: 'Segoe UI' });
  // Severity badge
  s.addShape(prs.ShapeType.roundRect, { x: x + 9.3, y: y + 0.07, w: 0.55, h: 0.2, fill: { color: tint(sevColor) }, line: { color: sevColor, width: 1 }, rectRadius: 0.04 });
  s.addText(severity, { x: x + 9.3, y: y + 0.08, w: 0.55, h: 0.18, fontSize: 7.5, color: sevColor, bold: true, fontFace: 'Segoe UI', align: 'center' });
  // Blocked badge
  s.addShape(prs.ShapeType.roundRect, { x: x + 10.0, y: y + 0.07, w: 0.55, h: 0.2, fill: { color: GREEN_T13 }, line: { color: GREEN, width: 1 }, rectRadius: 0.04 });
  s.addText('Blocked', { x: x + 10.0, y: y + 0.08, w: 0.55, h: 0.18, fontSize: 7.5, color: GREEN, bold: true, fontFace: 'Segoe UI', align: 'center' });
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 1 — Cover
// ════════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();
  // Subtle grid background lines
  for (let i = 0; i < 14; i++) s.addShape(prs.ShapeType.line, { x: i, y: 0, w: 0, h: 7.5, line: { color: BORDER, width: 0.3 } });
  for (let j = 0; j < 8;  j++) s.addShape(prs.ShapeType.line, { x: 0, y: j, w: 13.33, h: 0, line: { color: BORDER, width: 0.3 } });

  s.addText('🛡', { x: 5.65, y: 0.55, w: 2.0, h: 1.4, fontSize: 48, align: 'center' });

  s.addText('CYBERWALL', {
    x: 0.5, y: 2.0, w: 12.33, h: 1.1,
    fontSize: 42, bold: true, color: WHITE, fontFace: 'Segoe UI', align: 'center', charSpacing: 10
  });

  s.addShape(prs.ShapeType.line, { x: 3.8, y: 3.2, w: 5.73, h: 0, line: { color: ACCENT, width: 1.5 } });

  s.addText('Enterprise-Grade Web Security — Fully Managed for Your Business', {
    x: 0.5, y: 3.35, w: 12.33, h: 0.45,
    fontSize: 11, color: ACCENT, fontFace: 'Segoe UI', align: 'center'
  });

  s.addText('We protect your website from hackers, DDoS attacks, and bots.\nNo technical knowledge needed. We handle everything.', {
    x: 1.5, y: 3.95, w: 10.33, h: 0.7,
    fontSize: 9, color: MUTED, fontFace: 'Segoe UI', align: 'center'
  });

  // Three feature pills at bottom
  const features = ['🛡 WAF Protection', '🔔 WhatsApp Alerts', '🔐 Free SSL', '📊 Monthly Reports', '⚡ Faster Website'];
  features.forEach((f, i) => {
    const fw = 2.1;
    const gap = 0.12;
    const total = features.length * fw + (features.length - 1) * gap;
    const startX = (13.33 - total) / 2;
    s.addShape(prs.ShapeType.roundRect, { x: startX + i * (fw + gap), y: 4.85, w: fw, h: 0.38, fill: { color: SURF }, line: { color: BORDER, width: 1 }, rectRadius: 0.08 });
    s.addText(f, { x: startX + i * (fw + gap), y: 4.9, w: fw, h: 0.3, fontSize: 8.5, color: WHITE, fontFace: 'Segoe UI', align: 'center' });
  });

  s.addText('www.cyberwall.in  ·  Confidential Client Presentation', {
    x: 0.5, y: 7.0, w: 12.33, h: 0.3,
    fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI', align: 'center'
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 2 — The Problem
// ════════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();
  heading(s, 'Is Your Website Really Safe?', 0.3, 21);
  sub(s, 'Every 39 seconds, a website is attacked somewhere in the world — most owners never even know.', 0.97);

  const stats = [
    { n: '43%',        l: 'of cyberattacks\ntarget small businesses',          c: RED },
    { n: '₹14 Crore',  l: 'average cost of\na data breach in India',           c: ORANGE },
    { n: '60%',        l: 'of hacked SMBs shut down\nwithin 6 months',         c: RED },
    { n: '0',          l: 'is how many warnings\nyou get before an attack',     c: MUTED },
  ];

  stats.forEach((st, i) => {
    card(s, 0.5 + i * 3.1, 1.6, 2.85, 1.65, { border: st.c });
    s.addText(st.n, { x: 0.5 + i * 3.1, y: 1.72, w: 2.85, h: 0.7, fontSize: 19, bold: true, color: st.c, fontFace: 'Segoe UI', align: 'center' });
    s.addText(st.l, { x: 0.5 + i * 3.1, y: 2.45, w: 2.85, h: 0.72, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI', align: 'center' });
  });

  // What can go wrong
  s.addText('What can happen to YOUR website right now:', { x: 0.5, y: 3.42, w: 12.33, h: 0.35, fontSize: 10, color: WHITE, bold: true, fontFace: 'Segoe UI' });

  const threats = [
    ['💉', 'SQL Injection',    'Hacker steals your customer database'],
    ['🤖', 'Bot Attacks',      'Bots place fake orders or scrape your prices'],
    ['💥', 'DDoS Flood',       'Your site goes down — customers can\'t reach you'],
    ['🔓', 'Brute Force',      'Someone tries thousands of passwords on your admin'],
    ['🕵️', 'Data Scraping',   'Competitors steal your content, pricing, product data'],
    ['🔗', 'Phishing via Email','Your domain spoofed to scam your own customers'],
  ];

  threats.forEach((t, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.5 + col * 6.4, y = 3.9 + row * 0.9;
    card(s, x, y, 6.1, 0.78, { border: BORDER });
    s.addText(t[0], { x: x + 0.1, y: y + 0.15, w: 0.5, h: 0.5, fontSize: 14, align: 'center' });
    s.addText(t[1], { x: x + 0.7, y: y + 0.1, w: 5.2, h: 0.3, fontSize: 9, bold: true, color: WHITE, fontFace: 'Segoe UI' });
    s.addText(t[2], { x: x + 0.7, y: y + 0.42, w: 5.2, h: 0.25, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 3 — What is CyberWall?
// ════════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();
  heading(s, 'What is CyberWall?', 0.3, 21);
  sub(s, 'A fully managed Web Application Firewall (WAF) service — we sit between the internet and your website, blocking threats before they reach you.', 0.97);

  // Architecture flow
  const boxes = [
    { label: '🌍\nInternet\n& Hackers', c: RED },
    { label: '🚫\nCyberWall\nBlocks It', c: ACCENT },
    { label: '✅\nClean Traffic\nPasses Through', c: GREEN },
    { label: '🌐\nYour Website\nStays Safe', c: GREEN },
  ];
  boxes.forEach((b, i) => {
    card(s, 0.5 + i * 3.1, 1.7, 2.8, 1.35, { border: b.c, bg: SURF });
    s.addText(b.label, { x: 0.5 + i * 3.1, y: 1.78, w: 2.8, h: 1.2, fontSize: 9, color: WHITE, fontFace: 'Segoe UI', align: 'center' });
  });
  [1.65, 4.75, 7.85].forEach(ax => {
    s.addText('→', { x: ax, y: 2.2, w: 0.6, h: 0.4, fontSize: 13, color: MUTED, align: 'center' });
  });

  // 6 feature cards
  const features = [
    ['🔥', 'WAF Protection',      'Blocks SQL injection, XSS, brute force, path traversal and 100+ attack types — automatically, 24/7.'],
    ['🔔', 'WhatsApp Alerts',     'Instant message on your phone the moment a threat is detected. No checking dashboards needed.'],
    ['🔐', 'Free SSL / HTTPS',    'Your website gets a free SSL certificate and all traffic is forced to HTTPS automatically.'],
    ['📊', 'Monthly PDF Reports', 'Professional security report in your inbox every month. Perfect to show stakeholders.'],
    ['⚡', 'Speed Boost',         'Your website loads faster for visitors with global CDN caching — no extra cost.'],
    ['🤖', 'AI Assistant',        'Built-in AI assistant answers your security questions in plain English, any time of day.'],
  ];

  features.forEach((f, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.5 + col * 6.4, y = 3.35 + row * 1.3;
    card(s, x, y, 6.1, 1.15);
    s.addText(f[0], { x: x + 0.12, y: y + 0.3, w: 0.55, h: 0.55, fontSize: 15, align: 'center' });
    s.addText(f[1], { x: x + 0.75, y: y + 0.12, w: 5.1, h: 0.3, fontSize: 9.5, bold: true, color: ACCENT, fontFace: 'Segoe UI' });
    s.addText(f[2], { x: x + 0.75, y: y + 0.48, w: 5.1, h: 0.55, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 4 — Dashboard Overview (actual UI snippet)
// ════════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();

  // Label
  s.addText('YOUR DASHBOARD', { x: 0.25, y: 0.08, w: 4, h: 0.25, fontSize: 8, color: ACCENT, bold: true, fontFace: 'Segoe UI' });
  s.addText('Everything in one place — real-time, live data about your website\'s security.', { x: 0.25, y: 0.32, w: 9, h: 0.28, fontSize: 9, color: MUTED, fontFace: 'Segoe UI' });

  // Dashboard frame
  const DX = 0.15, DY = 0.68, DW = 13.03, DH = 6.65;
  s.addShape(prs.ShapeType.roundRect, { x: DX, y: DY, w: DW, h: DH, fill: { color: BG }, line: { color: BORDER, width: 1.5 }, rectRadius: 0.12 });

  drawSidebar(s);
  drawTopbar(s, 'Dashboard');

  // Stat cards
  const stats = [
    { icon: '🛡', bg: FEE_T13, val: '1,247',  label: 'Attacks Blocked (30 days)', badge: '↑ 12%',   bc: GREEN },
    { icon: '✅', bg: DCF_T13, val: '99.97%', label: 'Uptime This Month',          badge: '↑ 0.2%',  bc: GREEN },
    { icon: '⚡', bg: DBE_T13, val: '42 ms',  label: 'Avg Response Time',          badge: 'Fast',    bc: ACCENT },
    { icon: '🏆', bg: F0F_T13, val: '94/100', label: 'Security Score',             badge: 'A+',      bc: GREEN },
  ];
  stats.forEach((st, i) => {
    statCard(s, 2.3 + i * 2.72, 0.78, st.icon, st.bg, st.val, st.label, st.badge, st.bc);
  });

  // Chart card
  card(s, 2.3, 2.18, 6.3, 2.18);
  s.addText('Attacks Blocked — Last 7 Days', { x: 2.45, y: 2.28, w: 4.5, h: 0.28, fontSize: 9, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  s.addText('View all →', { x: 7.6, y: 2.28, w: 0.85, h: 0.28, fontSize: 8, color: ACCENT, fontFace: 'Segoe UI' });
  barChart(s, 2.35, 2.65, 6.2, 1.5);
  s.addShape(prs.ShapeType.line, { x: 2.45, y: 4.08, w: 6.0, h: 0, line: { color: BORDER, width: 0.5 } });
  s.addText('Peak: Thursday · 1,982 attacks', { x: 2.5, y: 4.15, w: 3.5, h: 0.2, fontSize: 7.5, color: MUTED, fontFace: 'Segoe UI' });
  s.addText('All blocked ✓', { x: 7.2, y: 4.15, w: 1.3, h: 0.2, fontSize: 7.5, color: GREEN, bold: true, fontFace: 'Segoe UI' });

  // Security score card
  card(s, 8.72, 2.18, 4.3, 2.18);
  s.addText('Security Score', { x: 8.87, y: 2.28, w: 3.8, h: 0.28, fontSize: 9, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  s.addText('A+', { x: 8.87, y: 2.62, w: 4.0, h: 0.75, fontSize: 30, bold: true, color: GREEN, fontFace: 'Segoe UI', align: 'center' });
  s.addText('Excellent Protection', { x: 8.87, y: 3.38, w: 4.0, h: 0.22, fontSize: 8, color: MUTED, fontFace: 'Segoe UI', align: 'center' });
  const scoreRows = [['🛡 WAF Rules', 'Active', GREEN], ['🔐 SSL', 'Valid', GREEN], ['✉ SPF/DKIM', 'Pass', GREEN], ['🔒 HTTPS', 'Enforced', GREEN]];
  scoreRows.forEach((r, i) => {
    s.addShape(prs.ShapeType.line, { x: 8.87, y: 3.66 + i * 0.35, w: 3.9, h: 0, line: { color: BORDER, width: 0.4 } });
    s.addText(r[0], { x: 8.92, y: 3.72 + i * 0.35, w: 2.3, h: 0.22, fontSize: 8, color: MUTED, fontFace: 'Segoe UI' });
    s.addText(r[1], { x: 11.3, y: 3.72 + i * 0.35, w: 1.5, h: 0.22, fontSize: 8, color: r[2], bold: true, fontFace: 'Segoe UI', align: 'right' });
  });

  // Recent threats table
  card(s, 2.3, 4.44, 10.72, 2.58);
  s.addText('Recent Threats Blocked', { x: 2.45, y: 4.54, w: 5, h: 0.28, fontSize: 9, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  s.addText('View all →', { x: 11.9, y: 4.54, w: 0.9, h: 0.28, fontSize: 8, color: ACCENT, fontFace: 'Segoe UI' });

  // Table header
  s.addShape(prs.ShapeType.rect, { x: 2.3, y: 4.86, w: 10.72, h: 0.3, fill: { color: BG }, line: { color: BG, width: 0 } });
  const hcols = ['Threat Type', 'IP Address', 'Country', 'Target', 'Time', 'Severity', 'Status'];
  const hx    = [2.4, 4.6, 6.7, 8.2, 10.0, 11.1, 12.2];
  hcols.forEach((h, i) => s.addText(h, { x: hx[i], y: 4.89, w: 2.0, h: 0.2, fontSize: 7.5, color: MUTED, bold: true, fontFace: 'Segoe UI' }));

  const rows = [
    ['SQL Injection', '103.28.xx.xx', '🇨🇳 China',  '/api/users', '2 min ago',  'High',   true],
    ['XSS Attack',   '185.220.xx.xx','🇷🇺 Russia', '/search',    '14 min ago', 'High',   false],
    ['Bot Crawl',    '45.33.xx.xx',  '🇺🇸 USA',    '/products',  '28 min ago', 'Medium', true],
    ['DDoS Attempt', '198.54.xx.xx', '🇧🇷 Brazil', '/checkout',  '1 hr ago',   'High',   false],
    ['Brute Force',  '77.88.xx.xx',  '🇺🇦 Ukraine','/admin',     '5 hrs ago',  'High',   true],
  ];
  rows.forEach((r, i) => threatRow(s, 2.3, 5.18 + i * 0.35, r[0], r[1], r[2], r[3], r[4], r[5], r[6]));
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 5 — Threats Log (actual UI)
// ════════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();

  s.addText('THREATS LOG', { x: 0.25, y: 0.08, w: 4, h: 0.25, fontSize: 8, color: ACCENT, bold: true, fontFace: 'Segoe UI' });
  s.addText('See every attack — the type, where it came from, what it was targeting, and how we stopped it.', { x: 0.25, y: 0.32, w: 10, h: 0.28, fontSize: 9, color: MUTED, fontFace: 'Segoe UI' });

  s.addShape(prs.ShapeType.roundRect, { x: 0.15, y: 0.68, w: 13.03, h: 6.65, fill: { color: BG }, line: { color: BORDER, width: 1.5 }, rectRadius: 0.12 });

  // Sidebar with Threats active
  s.addShape(prs.ShapeType.rect, { x: 0, y: 0.68, w: 2.15, h: 6.65, fill: { color: DARK }, line: { color: DARK, width: 0 } });
  s.addShape(prs.ShapeType.line, { x: 2.15, y: 0.68, w: 0, h: 6.65, line: { color: BORDER, width: 0.5 } });
  s.addText('🛡', { x: 0.22, y: 0.85, w: 0.35, h: 0.35, fontSize: 10, align: 'center' });
  s.addText('CyberWall', { x: 0.62, y: 0.9, w: 1.4, h: 0.28, fontSize: 9.5, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  const sideItems2 = [
    { icon: '📊', label: 'Dashboard',   active: false },
    { icon: '🚨', label: 'Threats',     active: true  },
    { icon: '📄', label: 'Reports',     active: false },
  ];
  sideItems2.forEach((it, i) => {
    const iy = 1.38 + i * 0.38;
    if (it.active) s.addShape(prs.ShapeType.roundRect, { x: 0.1, y: iy, w: 1.95, h: 0.32, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 }, rectRadius: 0.06 });
    s.addText(it.icon + '  ' + it.label, { x: 0.18, y: iy + 0.05, w: 1.7, h: 0.22, fontSize: 8.5, color: it.active ? DARK : MUTED, fontFace: 'Segoe UI', bold: it.active });
  });

  // Topbar
  s.addShape(prs.ShapeType.rect, { x: 2.15, y: 0.68, w: 11.18, h: 0.62, fill: { color: SURF }, line: { color: SURF, width: 0 } });
  s.addShape(prs.ShapeType.line, { x: 2.15, y: 1.3, w: 11.18, h: 0, line: { color: BORDER, width: 0.5 } });
  s.addText('Threats Log', { x: 2.35, y: 0.85, w: 3, h: 0.3, fontSize: 10, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  s.addShape(prs.ShapeType.roundRect, { x: 5.0, y: 0.86, w: 1.2, h: 0.26, fill: { color: GREEN_T13 }, line: { color: GREEN, width: 1 }, rectRadius: 0.06 });
  s.addText('● Protected', { x: 5.05, y: 0.88, w: 1.1, h: 0.22, fontSize: 7.5, color: GREEN, bold: true, fontFace: 'Segoe UI' });

  // Threat stat cards
  const tStats = [
    { icon: '🚨', bg: FEE_T13, val: '28',     label: 'Threats Today',       badge: 'High', bc: RED },
    { icon: '✅', bg: DCF_T13, val: '1,247',  label: 'Blocked This Month',  badge: '100%', bc: GREEN },
    { icon: '🌍', bg: FEF_T13, val: '17',     label: 'Countries of Origin', badge: 'Live', bc: ORANGE },
  ];
  tStats.forEach((st, i) => {
    statCard(s, 2.3 + i * 3.65, 1.42, st.icon, st.bg, st.val, st.label, st.badge, st.bc);
  });

  // Full threats table
  card(s, 2.3, 2.9, 10.8, 4.25);
  s.addText('Full Threats Log', { x: 2.45, y: 3.0, w: 5, h: 0.28, fontSize: 9, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  s.addShape(prs.ShapeType.rect, { x: 2.3, y: 3.35, w: 10.8, h: 0.3, fill: { color: BG }, line: { color: BG, width: 0 } });
  const hcols2 = ['Threat', 'IP', 'Country', 'Target', 'Time', 'Severity', 'Status'];
  const hx2    = [2.4, 4.6, 6.7, 8.2, 10.0, 11.1, 12.2];
  hcols2.forEach((h, i) => s.addText(h, { x: hx2[i], y: 3.38, w: 2.0, h: 0.2, fontSize: 7.5, color: MUTED, bold: true, fontFace: 'Segoe UI' }));

  const fullRows = [
    ['SQL Injection',  '103.28.xx.xx',  '🇨🇳 China',   '/api/users', '2 min ago',   'High',   true ],
    ['XSS Attack',     '185.220.xx.xx', '🇷🇺 Russia',  '/search',    '14 min ago',  'High',   false],
    ['Bot Crawl',      '45.33.xx.xx',   '🇺🇸 USA',     '/products',  '28 min ago',  'Medium', true ],
    ['DDoS Attempt',   '198.54.xx.xx',  '🇧🇷 Brazil',  '/checkout',  '1 hr ago',    'High',   false],
    ['Path Traversal', '92.118.xx.xx',  '🇩🇪 Germany', '/../config', '3 hrs ago',   'Medium', true ],
    ['Brute Force',    '77.88.xx.xx',   '🇺🇦 Ukraine', '/admin',     '5 hrs ago',   'High',   false],
    ['Rate Limit Hit', '91.108.xx.xx',  '🇫🇷 France',  '/login',     'Yesterday',   'Medium', true ],
  ];
  fullRows.forEach((r, i) => threatRow(s, 2.3, 3.72 + i * 0.38, r[0], r[1], r[2], r[3], r[4], r[5], r[6]));
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 6 — Alerts + SSL (actual UI)
// ════════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();

  s.addText('ALERTS & SSL MONITOR', { x: 0.25, y: 0.08, w: 6, h: 0.25, fontSize: 8, color: ACCENT, bold: true, fontFace: 'Segoe UI' });
  s.addText('Instant alerts delivered to your WhatsApp. SSL certificate monitored and auto-renewed.', { x: 0.25, y: 0.32, w: 10, h: 0.28, fontSize: 9, color: MUTED, fontFace: 'Segoe UI' });

  // Left: Alerts panel
  card(s, 0.25, 0.72, 6.3, 6.55);
  s.addText('Security Alerts', { x: 0.45, y: 0.82, w: 4, h: 0.3, fontSize: 10, bold: true, color: WHITE, fontFace: 'Segoe UI' });

  const alerts = [
    { icon: '🚨', title: 'DDoS Attack Detected & Blocked', desc: '198 requests/sec from 45 IPs. Automatically mitigated by CyberWall.', time: 'Today, 2:34 PM', level: 'high' },
    { icon: '⚠️', title: 'Brute Force Login Attempt',      desc: '47 failed login attempts from IP 77.88.xx.xx (Ukraine). IP permanently blocked.', time: 'Today, 11:12 AM', level: 'medium' },
    { icon: '📄', title: 'February Report Ready',          desc: 'Your February 2025 security report is ready to download.', time: 'Mar 1, 2025', level: 'info' },
    { icon: '✅', title: 'SSL Certificate Renewed',        desc: 'SSL certificate automatically renewed. Valid for 289 more days.', time: 'Feb 28, 2025', level: 'info' },
    { icon: '🔔', title: 'WhatsApp Alert Sent',            desc: 'You were notified about the DDoS attack on WhatsApp at +91 98765 43210.', time: 'Today, 2:34 PM', level: 'info' },
  ];

  alerts.forEach((a, i) => {
    const ay = 1.22 + i * 1.0;
    const borderCol = a.level === 'high' ? RED : a.level === 'medium' ? ORANGE : BORDER;
    const bgCol = a.level === 'high' ? RED_T7 : a.level === 'medium' ? ORANGE_T7 : SURF;
    s.addShape(prs.ShapeType.roundRect, { x: 0.35, y: ay, w: 6.0, h: 0.88, fill: { color: bgCol }, line: { color: borderCol, width: 1 }, rectRadius: 0.08 });
    s.addText(a.icon, { x: 0.4, y: ay + 0.18, w: 0.45, h: 0.45, fontSize: 13, align: 'center' });
    s.addText(a.title, { x: 0.9, y: ay + 0.1, w: 5.25, h: 0.26, fontSize: 9, bold: true, color: WHITE, fontFace: 'Segoe UI' });
    s.addText(a.desc,  { x: 0.9, y: ay + 0.38, w: 5.25, h: 0.3, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });
    s.addText(a.time,  { x: 0.9, y: ay + 0.68, w: 5.25, h: 0.18, fontSize: 7.5, color: MUTED60, fontFace: 'Segoe UI' });
  });

  // Right: SSL Monitor
  card(s, 6.8, 0.72, 6.3, 3.1);
  s.addText('SSL Certificate', { x: 7.0, y: 0.82, w: 5, h: 0.3, fontSize: 10, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  const sslRows = [
    ['Domain',         'yourstore.in'],
    ['Status',         '✓ Valid'],
    ['Issuer',         "Let's Encrypt"],
    ['Expires',        'Mar 15, 2026'],
    ['Protocol',       'TLS 1.3'],
    ['HTTPS Enforced', '✓ Yes'],
  ];
  sslRows.forEach((r, i) => {
    s.addShape(prs.ShapeType.line, { x: 7.0, y: 1.22 + i * 0.38, w: 5.8, h: 0, line: { color: BORDER, width: 0.5 } });
    s.addText(r[0], { x: 7.05, y: 1.27 + i * 0.38, w: 2.5, h: 0.26, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });
    s.addText(r[1], { x: 9.7,  y: 1.27 + i * 0.38, w: 3.2, h: 0.26, fontSize: 8.5, bold: true, color: i <= 1 || i >= 4 ? GREEN : WHITE, fontFace: 'Segoe UI', align: 'right' });
  });

  // Email security card
  card(s, 6.8, 3.98, 6.3, 3.28);
  s.addText('Email Security (SPF / DKIM / DMARC)', { x: 7.0, y: 4.08, w: 5.9, h: 0.3, fontSize: 9.5, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  const emailRows = [
    ['SPF Record', '✓ Configured',   GREEN],
    ['DKIM',       '✓ Signing Active', GREEN],
    ['DMARC',      '⚠ Not Set',     ORANGE],
    ['MX Records', '✓ Valid',        GREEN],
  ];
  emailRows.forEach((r, i) => {
    s.addShape(prs.ShapeType.line, { x: 7.0, y: 4.48 + i * 0.38, w: 5.8, h: 0, line: { color: BORDER, width: 0.5 } });
    s.addText(r[0], { x: 7.05, y: 4.53 + i * 0.38, w: 2.5, h: 0.26, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });
    s.addText(r[1], { x: 9.7,  y: 4.53 + i * 0.38, w: 3.2, h: 0.26, fontSize: 8.5, bold: true, color: r[2], fontFace: 'Segoe UI', align: 'right' });
  });
  // Warning box
  s.addShape(prs.ShapeType.roundRect, { x: 7.0, y: 6.05, w: 5.9, h: 0.95, fill: { color: ORANGE_T7 }, line: { color: ORANGE, width: 1 }, rectRadius: 0.07 });
  s.addText('⚠  DMARC not set — your domain could be spoofed.\nContact us on WhatsApp to fix this in minutes.', {
    x: 7.1, y: 6.15, w: 5.7, h: 0.75, fontSize: 8.5, color: ORANGE, fontFace: 'Segoe UI'
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 7 — Billing & Reports (actual UI)
// ════════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();

  s.addText('BILLING & REPORTS', { x: 0.25, y: 0.08, w: 5, h: 0.25, fontSize: 8, color: ACCENT, bold: true, fontFace: 'Segoe UI' });
  s.addText('Transparent billing with GST invoices. Monthly security reports auto-generated and ready to download.', { x: 0.25, y: 0.32, w: 11, h: 0.28, fontSize: 9, color: MUTED, fontFace: 'Segoe UI' });

  // Billing plan card
  s.addShape(prs.ShapeType.roundRect, { x: 0.25, y: 0.72, w: 12.83, h: 1.45, fill: { color: ACCENT_T7 }, line: { color: ACCENT, width: 1.5 }, rectRadius: 0.1 });
  s.addText('Pro Plan', { x: 0.5, y: 0.88, w: 5, h: 0.5, fontSize: 15, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  s.addText('Next billing: April 1, 2025  ·  Auto-renews via Razorpay', { x: 0.5, y: 1.4, w: 7, h: 0.3, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });
  s.addText('₹5,999', { x: 9.5, y: 0.85, w: 3.3, h: 0.75, fontSize: 22, bold: true, color: ACCENT, fontFace: 'Segoe UI', align: 'right' });
  s.addText('/month + GST', { x: 9.5, y: 1.58, w: 3.3, h: 0.25, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI', align: 'right' });

  // Payment history
  card(s, 0.25, 2.3, 12.83, 2.3);
  s.addText('Payment History', { x: 0.45, y: 2.4, w: 5, h: 0.3, fontSize: 9.5, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  s.addShape(prs.ShapeType.rect, { x: 0.25, y: 2.78, w: 12.83, h: 0.3, fill: { color: BG }, line: { color: BG, width: 0 } });
  ['Date', 'Description', 'Amount', 'GST', 'Status', 'Invoice'].forEach((h, i) => {
    s.addText(h, { x: 0.45 + i * 2.1, y: 2.82, w: 2.0, h: 0.2, fontSize: 7.5, color: MUTED, bold: true, fontFace: 'Segoe UI' });
  });
  const payments = [
    ['Mar 1, 2025', 'Pro Plan — March',    '₹5,999', '₹1,080', 'Paid', '↓ PDF'],
    ['Feb 1, 2025', 'Pro Plan — February', '₹5,999', '₹1,080', 'Paid', '↓ PDF'],
    ['Jan 1, 2025', 'Pro Plan — January',  '₹5,999', '₹1,080', 'Paid', '↓ PDF'],
  ];
  payments.forEach((p, i) => {
    if (i % 2 === 0) s.addShape(prs.ShapeType.rect, { x: 0.25, y: 3.1 + i * 0.38, w: 12.83, h: 0.38, fill: { color: BG }, line: { color: BG, width: 0 } });
    p.forEach((cell, j) => {
      const color = j === 4 ? GREEN : j === 5 ? ACCENT : j >= 2 ? WHITE : MUTED;
      s.addText(cell, { x: 0.45 + j * 2.1, y: 3.17 + i * 0.38, w: 2.0, h: 0.24, fontSize: 8.5, color, fontFace: j === 5 ? 'Segoe UI' : 'Segoe UI', bold: j === 4 || j === 5 });
    });
  });

  // Reports section
  card(s, 0.25, 4.75, 12.83, 2.5);
  s.addText('Monthly Security Reports', { x: 0.45, y: 4.85, w: 5, h: 0.3, fontSize: 9.5, bold: true, color: WHITE, fontFace: 'Segoe UI' });

  // Latest report highlighted
  s.addShape(prs.ShapeType.roundRect, { x: 0.4, y: 5.25, w: 12.45, h: 0.85, fill: { color: BG }, line: { color: BORDER, width: 1 }, rectRadius: 0.08 });
  s.addText('📄', { x: 0.55, y: 5.4, w: 0.6, h: 0.55, fontSize: 17, align: 'center' });
  s.addText('March 2025 Security Report', { x: 1.25, y: 5.35, w: 7, h: 0.3, fontSize: 9.5, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  s.addText('Generated Apr 1, 2025  ·  2.7 MB  ·  Includes: threats, SSL status, uptime, recommendations', { x: 1.25, y: 5.67, w: 9, h: 0.25, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });
  s.addShape(prs.ShapeType.roundRect, { x: 11.3, y: 5.42, w: 1.25, h: 0.35, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 }, rectRadius: 0.07 });
  s.addText('↓ Download', { x: 11.3, y: 5.46, w: 1.25, h: 0.27, fontSize: 8, bold: true, color: DARK, fontFace: 'Segoe UI', align: 'center' });

  s.addText('📅  Previous monthly reports will appear here as they are generated each month.', {
    x: 0.4, y: 6.2, w: 12.45, h: 0.8,
    fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI', align: 'center',
    valign: 'middle'
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 8 — AI Assistant (actual UI snippet)
// ════════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();

  s.addText('AI SECURITY ASSISTANT', { x: 0.25, y: 0.08, w: 6, h: 0.22, fontSize: 8, color: ACCENT, bold: true, fontFace: 'Segoe UI' });
  s.addText('Ask anything about your website security — in plain English. No jargon. Available 24/7.', { x: 0.25, y: 0.3, w: 10, h: 0.25, fontSize: 9, color: MUTED, fontFace: 'Segoe UI' });

  // Dashboard frame
  s.addShape(prs.ShapeType.roundRect, { x: 0.15, y: 0.65, w: 13.03, h: 6.68, fill: { color: BG }, line: { color: BORDER, width: 1.5 }, rectRadius: 0.12 });

  // Sidebar — AI active
  s.addShape(prs.ShapeType.rect, { x: 0, y: 0.65, w: 2.15, h: 6.68, fill: { color: DARK }, line: { color: DARK, width: 0 } });
  s.addShape(prs.ShapeType.line, { x: 2.15, y: 0.65, w: 0, h: 6.68, line: { color: BORDER, width: 0.5 } });
  s.addText('🛡', { x: 0.22, y: 0.82, w: 0.35, h: 0.35, fontSize: 13, align: 'center' });
  s.addText('CyberWall', { x: 0.62, y: 0.87, w: 1.4, h: 0.26, fontSize: 11, bold: true, color: WHITE, fontFace: 'Segoe UI' });

  const aiSideItems = [
    { icon: '📊', label: 'Dashboard', active: false },
    { icon: '🚨', label: 'Threats', active: false },
    { icon: '📄', label: 'Reports', active: false },
    { icon: '🔐', label: 'SSL Monitor', active: false },
    { icon: '🔔', label: 'Alerts', active: false },
    { icon: '🤖', label: 'AI Assistant', active: true },
  ];
  s.addText('OVERVIEW', { x: 0.18, y: 1.28, w: 1.8, h: 0.2, fontSize: 7.5, color: MUTED, bold: true, fontFace: 'Segoe UI' });
  aiSideItems.slice(0,3).forEach((it, i) => {
    const iy = 1.52 + i * 0.35;
    if (it.active) s.addShape(prs.ShapeType.roundRect, { x: 0.1, y: iy, w: 1.95, h: 0.3, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 }, rectRadius: 0.06 });
    s.addText(it.icon + '  ' + it.label, { x: 0.18, y: iy + 0.04, w: 1.7, h: 0.2, fontSize: 9, color: it.active ? DARK : MUTED, fontFace: 'Segoe UI', bold: it.active });
  });
  s.addText('SECURITY', { x: 0.18, y: 2.6, w: 1.8, h: 0.2, fontSize: 7.5, color: MUTED, bold: true, fontFace: 'Segoe UI' });
  aiSideItems.slice(3,5).forEach((it, i) => {
    const iy = 2.82 + i * 0.35;
    s.addText(it.icon + '  ' + it.label, { x: 0.18, y: iy + 0.04, w: 1.7, h: 0.2, fontSize: 9, color: MUTED, fontFace: 'Segoe UI' });
  });
  s.addText('AI', { x: 0.18, y: 3.6, w: 1.8, h: 0.2, fontSize: 7.5, color: MUTED, bold: true, fontFace: 'Segoe UI' });
  // AI active item
  s.addShape(prs.ShapeType.roundRect, { x: 0.1, y: 3.82, w: 1.95, h: 0.3, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 }, rectRadius: 0.06 });
  s.addText('🤖  AI Assistant', { x: 0.18, y: 3.86, w: 1.7, h: 0.2, fontSize: 9, color: DARK, bold: true, fontFace: 'Segoe UI' });

  // Topbar
  s.addShape(prs.ShapeType.rect, { x: 2.15, y: 0.65, w: 11.18, h: 0.58, fill: { color: SURF }, line: { color: SURF, width: 0 } });
  s.addShape(prs.ShapeType.line, { x: 2.15, y: 1.23, w: 11.18, h: 0, line: { color: BORDER, width: 0.5 } });
  s.addText('AI Assistant', { x: 2.35, y: 0.82, w: 3, h: 0.27, fontSize: 11, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  s.addShape(prs.ShapeType.roundRect, { x: 5.0, y: 0.82, w: 1.2, h: 0.24, fill: { color: GREEN_T13 }, line: { color: GREEN, width: 1 }, rectRadius: 0.06 });
  s.addText('● Protected', { x: 5.05, y: 0.84, w: 1.1, h: 0.2, fontSize: 7.5, color: GREEN, bold: true, fontFace: 'Segoe UI' });

  // AI panel card
  card(s, 2.3, 1.35, 10.7, 5.88);

  // AI header
  s.addShape(prs.ShapeType.roundRect, { x: 2.5, y: 1.5, w: 0.42, h: 0.42, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 }, rectRadius: 0.07 });
  s.addText('🤖', { x: 2.5, y: 1.52, w: 0.42, h: 0.38, fontSize: 14, align: 'center' });
  s.addText('CyberWall AI Assistant', { x: 3.02, y: 1.53, w: 5, h: 0.22, fontSize: 10, bold: true, color: WHITE, fontFace: 'Segoe UI' });
  s.addText('Ask me anything about your website security', { x: 3.02, y: 1.77, w: 5, h: 0.2, fontSize: 8, color: MUTED, fontFace: 'Segoe UI' });

  // Chat area bg
  s.addShape(prs.ShapeType.roundRect, { x: 2.4, y: 2.05, w: 10.45, h: 3.55, fill: { color: BG }, line: { color: BORDER, width: 1 }, rectRadius: 0.1 });

  // Bot greeting bubble
  s.addShape(prs.ShapeType.roundRect, { x: 2.55, y: 2.2, w: 6.2, h: 0.55, fill: { color: WHITE }, line: { color: BORDER, width: 0 }, rectRadius: 0.08 });
  s.addText("👋  Hi! I'm your CyberWall AI security assistant. Ask me about your protection, threats, or anything about website security!", { x: 2.65, y: 2.26, w: 6.0, h: 0.43, fontSize: 8, color: DARK, fontFace: 'Segoe UI' });

  // User message 1
  s.addShape(prs.ShapeType.roundRect, { x: 7.85, y: 2.9, w: 4.8, h: 0.38, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 }, rectRadius: 0.08 });
  s.addText('Am I fully protected right now?', { x: 7.95, y: 2.96, w: 4.6, h: 0.26, fontSize: 8, color: DARK, fontFace: 'Segoe UI', bold: true });

  // Bot response
  s.addShape(prs.ShapeType.roundRect, { x: 2.55, y: 3.43, w: 7.5, h: 0.8, fill: { color: WHITE }, line: { color: BORDER, width: 0 }, rectRadius: 0.08 });
  s.addText("Yes! ✅ Your site is fully protected. WAF is active, SSL is valid (289 days left), and we've blocked 28 threats today — including 1 DDoS attempt and 4 SQL injection attacks. Your security score is A+.", { x: 2.65, y: 3.49, w: 7.3, h: 0.68, fontSize: 8, color: DARK, fontFace: 'Segoe UI' });

  // User message 2
  s.addShape(prs.ShapeType.roundRect, { x: 9.6, y: 4.38, w: 3.15, h: 0.38, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 }, rectRadius: 0.08 });
  s.addText('What is SQL injection?', { x: 9.7, y: 4.44, w: 2.95, h: 0.26, fontSize: 8, color: DARK, fontFace: 'Segoe UI', bold: true });

  // Bot response 2
  s.addShape(prs.ShapeType.roundRect, { x: 2.55, y: 4.9, w: 8.2, h: 0.55, fill: { color: WHITE }, line: { color: BORDER, width: 0 }, rectRadius: 0.08 });
  s.addText("SQL injection is when a hacker types code into a form on your website to trick it into leaking your database. CyberWall blocks all such attempts automatically. 🛡", { x: 2.65, y: 4.95, w: 8.0, h: 0.43, fontSize: 8, color: DARK, fontFace: 'Segoe UI' });

  // Input bar
  s.addShape(prs.ShapeType.roundRect, { x: 2.4, y: 5.72, w: 8.8, h: 0.38, fill: { color: SURF }, line: { color: BORDER, width: 1 }, rectRadius: 0.07 });
  s.addText('Ask about your security...', { x: 2.55, y: 5.78, w: 8.6, h: 0.26, fontSize: 8.5, color: MUTED, fontFace: 'Segoe UI' });
  s.addShape(prs.ShapeType.roundRect, { x: 11.35, y: 5.72, w: 1.28, h: 0.38, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 }, rectRadius: 0.07 });
  s.addText('Send →', { x: 11.35, y: 5.78, w: 1.28, h: 0.26, fontSize: 8.5, bold: true, color: DARK, fontFace: 'Segoe UI', align: 'center' });

  // Suggestion chips
  const chips = ['Am I protected?', 'What is SQL injection?', 'What does a WAF do?', 'Improve my score'];
  chips.forEach((c, i) => {
    const cw = 2.35;
    s.addShape(prs.ShapeType.roundRect, { x: 2.4 + i * (cw + 0.08), y: 6.18, w: cw, h: 0.3, fill: { color: SURF }, line: { color: BORDER, width: 1 }, rectRadius: 0.08 });
    s.addText(c, { x: 2.4 + i * (cw + 0.08), y: 6.22, w: cw, h: 0.22, fontSize: 7.5, color: MUTED, fontFace: 'Segoe UI', align: 'center' });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 9 — Pricing (INR)
// ════════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();
  heading(s, 'Simple, Transparent Pricing', 0.3, 21);
  sub(s, 'All plans include a 7-day free trial. No credit card required. Cancel anytime.', 0.72);

  const plans = [
    {
      name: 'Starter', price: '₹2,499', gst: '+ 18% GST', color: '4A90E2',
      features: ['1 Website', 'WAF Protection', 'Free SSL / HTTPS', 'WhatsApp Alerts', 'Monthly PDF Report', 'AI Assistant', 'Email Support'],
    },
    {
      name: 'Pro', price: '₹4,999', gst: '+ 18% GST', color: ACCENT, popular: true,
      features: ['3 Websites', 'WAF Protection', 'Free SSL / HTTPS', 'WhatsApp Alerts', 'Weekly Reports', 'AI Assistant', 'DDoS Mitigation', 'Priority Support'],
    },
    {
      name: 'Business', price: '₹8,499', gst: '+ 18% GST', color: 'B57BFF',
      features: ['10 Websites', 'Advanced WAF Rules', 'Free SSL / HTTPS', 'Real-Time Alerts', 'Custom Reports', 'AI Assistant', 'Bot Management', 'Dedicated Manager'],
    },
  ];

  plans.forEach((p, i) => {
    const x = 0.5 + i * 4.25;
    const popular = !!p.popular;

    s.addShape(prs.ShapeType.roundRect, {
      x, y: 1.15, w: 4.0, h: 5.05,
      fill: { color: popular ? '0A1929' : SURF },
      line: { color: p.color, width: popular ? 2.5 : 1 },
      rectRadius: 0.1
    });

    if (popular) {
      s.addShape(prs.ShapeType.roundRect, { x: x + 1.15, y: 1.06, w: 1.7, h: 0.26, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 }, rectRadius: 0.08 });
      s.addText('⭐ Most Popular', { x: x + 1.15, y: 1.08, w: 1.7, h: 0.22, fontSize: 7.5, bold: true, color: DARK, fontFace: 'Segoe UI', align: 'center' });
    }

    s.addText(p.name,  { x, y: 1.26, w: 4.0, h: 0.38, fontSize: 12, bold: true, color: p.color, fontFace: 'Segoe UI', align: 'center' });
    s.addText(p.price, { x, y: 1.63, w: 4.0, h: 0.55, fontSize: 19, bold: true, color: WHITE, fontFace: 'Segoe UI', align: 'center' });
    s.addText(p.gst + ' / month', { x, y: 2.17, w: 4.0, h: 0.25, fontSize: 7.5, color: MUTED, fontFace: 'Segoe UI', align: 'center' });

    s.addShape(prs.ShapeType.line, { x: x + 0.3, y: 2.48, w: 3.4, h: 0, line: { color: p.color, width: 0.5 } });

    p.features.forEach((f, fi) => {
      s.addText('✓  ' + f, {
        x: x + 0.25, y: 2.58 + fi * 0.36, w: 3.5, h: 0.3,
        fontSize: 8, color: fi === 0 ? WHITE : MUTED, fontFace: 'Segoe UI', bold: fi === 0
      });
    });

    // CTA button
    s.addShape(prs.ShapeType.roundRect, { x: x + 0.3, y: 5.95, w: 3.4, h: 0.3, fill: { color: popular ? ACCENT : SURF }, line: { color: p.color, width: 1 }, rectRadius: 0.07 });
    s.addText('Start Free Trial →', { x: x + 0.3, y: 5.97, w: 3.4, h: 0.25, fontSize: 8, bold: true, color: popular ? DARK : p.color, fontFace: 'Segoe UI', align: 'center' });
  });

  // ── 10x Money-Back Guarantee banner ──────────────────────────────────────
  s.addShape(prs.ShapeType.roundRect, {
    x: 0.5, y: 6.42, w: 12.33, h: 0.85,
    fill: { color: GREEN_T13 }, line: { color: GREEN, width: 1.5 }, rectRadius: 0.1
  });
  s.addText('🛡', { x: 0.7, y: 6.52, w: 0.55, h: 0.65, fontSize: 22, align: 'center' });
  s.addText('10× Money-Back Guarantee', { x: 1.35, y: 6.5, w: 6, h: 0.3, fontSize: 11, bold: true, color: GREEN, fontFace: 'Segoe UI' });
  s.addText('If your website is ever breached while under CyberWall protection, we refund 10× your monthly fee. No questions asked.', {
    x: 1.35, y: 6.8, w: 11.3, h: 0.35, fontSize: 8, color: MUTED, fontFace: 'Segoe UI'
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 9 — Why CyberWall vs DIY / Others
// ════════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();
  heading(s, 'Why CyberWall?', 0.3, 21);

  const comparisons = [
    { feature: 'Setup Time',             us: 'Under 24 hours',      them: 'Days or weeks of config' },
    { feature: 'Technical Know-How Needed', us: 'Zero — we handle it', them: 'High — dev / sysadmin' },
    { feature: 'WhatsApp Alerts',        us: '✓ Instant',            them: '✗ Email only' },
    { feature: 'Managed by Experts',     us: '✓ Dedicated team',     them: '✗ You manage it' },
    { feature: 'Indian INR Pricing + GST Invoice', us: '✓ Yes',      them: '✗ USD only' },
    { feature: 'Monthly PDF Reports',    us: '✓ Auto-generated',     them: '✗ Extra cost or manual' },
    { feature: 'SPF / DKIM / DMARC Setup', us: '✓ We set it up',    them: '✗ You figure it out' },
    { feature: 'Hindi + English Support', us: '✓ WhatsApp / Email',  them: '✗ Offshore tickets' },
    { feature: '10× Money-Back Guarantee', us: '✓ If site gets breached', them: '✗ No such guarantee' },
  ];

  s.addShape(prs.ShapeType.rect, { x: 0.5, y: 1.05, w: 12.33, h: 0.45, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 } });
  ['Feature', 'CyberWall', 'Others / DIY'].forEach((h, i) => {
    s.addText(h, { x: 0.7 + i * 4.3, y: 1.1, w: 4.0, h: 0.35, fontSize: 9, bold: true, color: DARK, fontFace: 'Segoe UI', align: i === 0 ? 'left' : 'center' });
  });

  comparisons.forEach((c, i) => {
    const y = 1.55 + i * 0.56;
    if (i % 2 === 0) s.addShape(prs.ShapeType.rect, { x: 0.5, y, w: 12.33, h: 0.52, fill: { color: SURF }, line: { color: SURF, width: 0 } });
    s.addText(c.feature, { x: 0.7,  y: y + 0.14, w: 4.0, h: 0.26, fontSize: 9, color: WHITE, fontFace: 'Segoe UI' });
    s.addText(c.us,       { x: 5.0,  y: y + 0.14, w: 3.8, h: 0.26, fontSize: 9, color: GREEN, bold: true, fontFace: 'Segoe UI', align: 'center' });
    s.addText(c.them,     { x: 9.0,  y: y + 0.14, w: 3.6, h: 0.26, fontSize: 9, color: MUTED, fontFace: 'Segoe UI', align: 'center' });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SLIDE 10 — Call to Action
// ════════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();

  // Grid bg
  for (let i = 0; i < 14; i++) s.addShape(prs.ShapeType.line, { x: i, y: 0, w: 0, h: 7.5, line: { color: BORDER, width: 0.3 } });
  for (let j = 0; j < 8;  j++) s.addShape(prs.ShapeType.line, { x: 0, y: j, w: 13.33, h: 0, line: { color: BORDER, width: 0.3 } });

  s.addText('🛡', { x: 5.6, y: 0.35, w: 2.0, h: 1.3, fontSize: 44, align: 'center' });

  s.addText('Start Protecting Your Website Today', {
    x: 0.5, y: 1.7, w: 12.33, h: 0.85,
    fontSize: 22, bold: true, color: WHITE, fontFace: 'Segoe UI', align: 'center'
  });

  s.addText('7-day free trial · No credit card · No technical setup · Cancel anytime', {
    x: 0.5, y: 2.6, w: 12.33, h: 0.4,
    fontSize: 10, color: MUTED, fontFace: 'Segoe UI', align: 'center'
  });

  // CTA button
  s.addShape(prs.ShapeType.roundRect, { x: 4.5, y: 3.1, w: 4.33, h: 0.62, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 }, rectRadius: 0.1 });
  s.addText('Get Started Free →', { x: 4.5, y: 3.18, w: 4.33, h: 0.45, fontSize: 12, bold: true, color: DARK, fontFace: 'Segoe UI', align: 'center' });

  // Money-back guarantee strip
  s.addShape(prs.ShapeType.roundRect, { x: 3.2, y: 3.82, w: 6.93, h: 0.42, fill: { color: GREEN_T13 }, line: { color: GREEN, width: 1 }, rectRadius: 0.08 });
  s.addText('🛡  10× Money-Back Guarantee — if your site is breached while on CyberWall, we refund 10× your fee.', {
    x: 3.3, y: 3.88, w: 6.7, h: 0.3, fontSize: 7.5, color: GREEN, fontFace: 'Segoe UI', align: 'center', bold: true
  });

  const contacts = [
    ['🌐', 'Website',  'www.cyberwall.in'],
    ['📧', 'Email',    'hello@cyberwall.in'],
    ['💬', 'WhatsApp', '+91 99999 00000'],
  ];
  contacts.forEach((c, i) => {
    card(s, 1.5 + i * 3.6, 4.2, 3.2, 1.0);
    s.addText(c[0], { x: 1.5 + i * 3.6, y: 4.28, w: 3.2, h: 0.4, fontSize: 15, align: 'center' });
    s.addText(c[1], { x: 1.5 + i * 3.6, y: 4.7, w: 3.2, h: 0.2, fontSize: 8, color: MUTED, fontFace: 'Segoe UI', align: 'center' });
    s.addText(c[2], { x: 1.5 + i * 3.6, y: 4.88, w: 3.2, h: 0.22, fontSize: 8.5, color: WHITE, bold: true, fontFace: 'Segoe UI', align: 'center' });
  });

  s.addText('"Your website never sleeps. Neither does CyberWall."', {
    x: 0.5, y: 5.5, w: 12.33, h: 0.45,
    fontSize: 10, italic: true, color: ACCENT, fontFace: 'Segoe UI', align: 'center'
  });

  s.addText('© 2025 CyberWall. Prices in Indian Rupees. GST applicable as per Indian tax law.', {
    x: 0.5, y: 7.0, w: 12.33, h: 0.3,
    fontSize: 8, color: MUTED, fontFace: 'Segoe UI', align: 'center'
  });
}

// ── Save ──────────────────────────────────────────────────────────────────
prs.writeFile({ fileName: 'CyberWall-v2.pptx' })
  .then(() => console.log('✅  CyberWall-Client-Presentation.pptx created! (11 slides) v2'))
  .catch(e => console.error('Error:', e));
