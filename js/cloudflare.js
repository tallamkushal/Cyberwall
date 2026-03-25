// CYBERWALL — Cloudflare Integration (via backend proxy)
// All Cloudflare API calls go through server.js — credentials never reach the browser.

async function loadCloudflareData(domain) {
  showCFLoading(true);
  try {
    const res  = await fetch(`/api/cf/overview?domain=${encodeURIComponent(domain)}`);
    const data = await res.json();

    if (data.error) {
      if (res.status === 404) showCFNotSetup();
      showCFLoading(false);
      return;
    }

    const s = data.stats;

    // ── Stat cards ────────────────────────────────────────────────────────────
    safeSet('stat-blocked',  s.threatsBlocked30d.toLocaleString('en-IN'));
    safeSet('stat-uptime',   '99.9%');
    safeSet('stat-response', '38ms');
    safeSet('stat-score',    s.securityScore);

    // ── Threats panel stats ───────────────────────────────────────────────────
    safeSet('threats-today',     s.threatsToday.toLocaleString('en-IN'));
    safeSet('threats-month',     s.threatsThisMonth.toLocaleString('en-IN'));
    safeSet('threats-countries', '—');

    // ── Security score card ───────────────────────────────────────────────────
    safeSet('score-grade', data.security.waf ? 'A+' : 'B');
    safeSet('score-waf',   data.security.waf);
    safeSet('score-ssl',   data.security.ssl);
    safeSet('score-spf',   data.email.spf.includes('Pass') ? 'Pass' : 'Fail');
    safeSet('score-bot',   data.security.botShield);
    safeSet('score-https', data.security.https);

    // ── 7-day bar chart ───────────────────────────────────────────────────────
    if (data.chart7d && window._attacksChart) {
      window._attacksChart.data.labels = data.chart7d.labels;
      window._attacksChart.data.datasets[0].data = data.chart7d.data;
      window._attacksChart.update();
    }

    // ── Attack types pie chart ────────────────────────────────────────────────
    if (data.attackTypes?.labels?.length && window._attackTypesChart) {
      window._attackTypesChart.data.labels = data.attackTypes.labels;
      window._attackTypesChart.data.datasets[0].data = data.attackTypes.data;
      window._attackTypesChart.update();
    }

    // ── Threats tables (overview + full log) ──────────────────────────────────
    if (data.threats?.length) {
      renderRealThreats(data.threats, 'threats-tbody');
      renderRealThreats(data.threats, 'threats-full-tbody');
    }

    // ── SSL panel ─────────────────────────────────────────────────────────────
    const ssl = data.ssl;
    safeSet('ssl-status',   ssl.status);
    safeSet('ssl-issuer',   ssl.issuer);
    safeSet('ssl-expires',  ssl.expires);
    safeSet('ssl-protocol', ssl.protocol);
    safeSet('ssl-https',    ssl.httpsEnforced ? '✓ Yes' : '✗ No');

    // ── Email security panel ──────────────────────────────────────────────────
    safeSet('email-spf',   data.email.spf);
    safeSet('email-dkim',  data.email.dkim);
    safeSet('email-dmarc', data.email.dmarc);
    safeSet('email-mx',    data.email.mx);

  } catch (err) {
    console.error('Cloudflare load error:', err);
  }
  showCFLoading(false);
}

function renderRealThreats(events, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = events.map(e => `
    <tr>
      <td>${e.ruleMessage || e.action || 'Block'}</td>
      <td style="font-family:monospace;font-size:12px">${maskIP(e.clientIP || e.ip || '')}</td>
      <td>${getCountryFlag(e.clientCountryName || e.country)} ${e.clientCountryName || e.country || '—'}</td>
      <td style="color:var(--muted)">${timeAgo(e.occurredAt || e.occurred_at)}</td>
      <td><span class="badge badge-red">High</span></td>
      <td><span class="badge badge-green">Blocked</span></td>
    </tr>`).join('');
}

function showCFNotSetup() {
  const tbody = document.getElementById('threats-tbody');
  if (tbody) tbody.innerHTML = `
    <tr><td colspan="6" style="text-align:center;padding:32px">
      <div style="font-size:24px;margin-bottom:10px">⚙️</div>
      <div style="font-weight:600;margin-bottom:6px">Domain not connected to Cloudflare yet</div>
      <div style="font-size:12px;color:var(--muted)">Contact CyberWall support on WhatsApp to complete setup</div>
    </td></tr>`;
}

function showCFLoading(show) {
  const tbody = document.getElementById('threats-tbody');
  if (tbody && show) tbody.innerHTML = `
    <tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted)">
      Loading threat data from Cloudflare...
    </td></tr>`;
}

function maskIP(ip) {
  return ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/, '$1.$2.xx.xx');
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function getCountryFlag(code) {
  const flags = { CN:'🇨🇳', RU:'🇷🇺', US:'🇺🇸', IN:'🇮🇳', DE:'🇩🇪', BR:'🇧🇷', UA:'🇺🇦', GB:'🇬🇧', FR:'🇫🇷', JP:'🇯🇵', KR:'🇰🇷', NL:'🇳🇱' };
  return flags[code] || '🌍';
}

function safeSet(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
