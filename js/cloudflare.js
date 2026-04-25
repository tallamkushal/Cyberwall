// CYBERWALL — Cloudflare Integration (via backend proxy)
// All Cloudflare API calls go through server.js — credentials never reach the browser.

function escapeHtml(str) {
  if (str == null) return '—';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadCloudflareData(domain, zoneId) {
  showCFLoading(true);
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const cfHeaders = {};
    if (session?.access_token) cfHeaders['Authorization'] = 'Bearer ' + session.access_token;
    let url = `/api/cf/overview?domain=${encodeURIComponent(domain)}`;
    if (zoneId) url += `&zone_id=${encodeURIComponent(zoneId)}`;
    const res  = await fetch(url, { headers: cfHeaders });
    const data = await res.json();

    if (data.error) {
      showCFNotSetup();
      showCFLoading(false);
      return;
    }


    const s = data.stats;

    // ── Stat cards ────────────────────────────────────────────────────────────
    const statPeriod = data.chart7d?.days || 30;
    const blockedCount = s.threatsBlocked30d;
    safeSet('stat-blocked', blockedCount.toLocaleString('en-IN'));
    safeSet('stat-blocked-period', `(${statPeriod} days)`);
    safeSet('chart-period-label', `Last ${statPeriod} Days`);
    safeSet('stat-uptime',  s.uptime || '—');
    safeSet('stat-response', s.responseMs != null ? s.responseMs + 'ms' : '—');

    // ── Trend badge on Attacks Blocked card ───────────────────────────────────
    const trendBadge = document.getElementById('stat-trend-badge');
    if (trendBadge && data.chart7d?.data?.length >= 2) {
      const todayVal = data.chart7d.data[data.chart7d.data.length - 1];
      const prevVals = data.chart7d.data.slice(0, -1).filter(v => v >= 0);
      const avg = prevVals.length > 0 ? prevVals.reduce((a, b) => a + b, 0) / prevVals.length : 0;
      if (avg === 0 && todayVal === 0) {
        trendBadge.style.display = 'none';
      } else if (avg === 0) {
        trendBadge.textContent = '↑ New activity';
        trendBadge.className = 'badge badge-red';
        trendBadge.style.display = '';
      } else {
        const pct = Math.round(((todayVal - avg) / avg) * 100);
        if (Math.abs(pct) < 5) {
          trendBadge.style.display = 'none';
        } else if (pct > 0) {
          trendBadge.textContent = `↑ ${pct}% today`;
          trendBadge.className = 'badge badge-red';
          trendBadge.style.display = '';
        } else {
          trendBadge.textContent = `↓ ${Math.abs(pct)}% today`;
          trendBadge.className = 'badge badge-green';
          trendBadge.style.display = '';
        }
      }
    }
    // Security grade is set by the real scan in loadSecurityScore() — leave stat-score alone here

    // ── Threats panel stats ───────────────────────────────────────────────────
    const threatsToday = s.threatsToday;
    const threatsMonth = s.threatsThisMonth;
    safeSet('threats-today', threatsToday.toLocaleString('en-IN'));
    safeSet('threats-today-desc', threatsToday > 0
      ? `${threatsToday.toLocaleString()} attempts to break into your site today. All blocked automatically.`
      : 'No attacks on your site today. You\'re good.');
    safeSet('threats-month', threatsMonth.toLocaleString('en-IN'));
    safeSet('threats-month-desc', threatsMonth > 0
      ? `${threatsMonth.toLocaleString()} hacker attempts blocked in the last ${statPeriod} days. Your site stayed online without any interruptions.`
      : `No attacks detected in the last ${statPeriod} days. Your site is clean.`);
    safeSet('threats-period', `${statPeriod} days`);
    const uniqueCountries = new Set((data.threats || []).map(t => t.clientCountryName || t.country).filter(Boolean)).size;
    safeSet('threats-countries', uniqueCountries > 0 ? uniqueCountries : '—');

    // ── Security score card ───────────────────────────────────────────────────
    // score-grade is set by loadSecurityScore() to keep it in sync with the real scan
    safeSet('score-waf',   data.security.waf);
    safeSet('score-ssl',   data.security.ssl);
    safeSet('score-spf',   data.email.spf);
    safeSet('score-bot',   data.security.botShield);
    safeSet('score-https', data.security.https);

    // ── 7-day bar chart ───────────────────────────────────────────────────────
    if (data.chart7d && window._attacksChart) {
      window._attacksChart.data.labels = data.chart7d.labels;
      window._attacksChart.data.datasets[0].data = data.chart7d.data;
      window._attacksChart.update();
      // Update peak label
      const peakVal = Math.max(...data.chart7d.data);
      const peakDay = data.chart7d.labels[data.chart7d.data.indexOf(peakVal)];
      safeSet('chart-peak-label', peakVal > 0 ? `Peak: ${peakDay} · ${peakVal.toLocaleString('en-IN')} attacks` : 'No attacks in the last 7 days');
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
    } else {
      const noDataMsg = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px">No suspicious activity detected in this period. Your site is clean.</td></tr>';
      const tbody1 = document.getElementById('threats-tbody');
      const tbody2 = document.getElementById('threats-full-tbody');
      if (tbody1) tbody1.innerHTML = noDataMsg;
      if (tbody2) tbody2.innerHTML = noDataMsg;
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

    // Show DMARC warning only if not configured
    const dmarcWarn = document.getElementById('email-dmarc-warning');
    if (dmarcWarn) dmarcWarn.style.display = data.email.dmarc.includes('✗') ? '' : 'none';

    // ── Website Health panel ──────────────────────────────────────────────────
    updateHealthPanel(ssl, data.email);

  } catch (err) {
    console.error('Cloudflare load error:', err);
    showCFNotSetup();
  }
  showCFLoading(false);
}

function renderRealThreats(events, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = events.map(e => `
    <tr>
      <td>${escapeHtml(e.ruleMessage || e.action || 'Block')}</td>
      <td style="font-family:monospace;font-size:12px">${escapeHtml(maskIP(e.clientIP || e.ip || ''))}</td>
      <td>${getCountryFlag(e.clientCountryName || e.country)} ${escapeHtml(e.clientCountryName || e.country || '—')}</td>
      <td style="color:var(--muted)">${escapeHtml(timeAgo(e.occurredAt || e.occurred_at))}</td>
      <td><span class="badge badge-red">High</span></td>
      <td><span class="badge badge-green">Blocked</span></td>
    </tr>`).join('');
}

function showCFNotSetup() {
  const msg = `
    <tr><td colspan="6" style="text-align:center;padding:32px">
      <div style="font-size:24px;margin-bottom:10px">🌐</div>
      <div style="font-weight:600;margin-bottom:6px">Domain not connected</div>
      <div style="font-size:12px;color:var(--muted)">Contact <strong>ProCyberWall</strong> to activate protection for your domain</div>
    </td></tr>`;
  ['threats-tbody', 'threats-full-tbody'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = msg;
  });
  safeSet('score-grade', '—');
  safeSet('chart-peak-label', 'Connect your domain to see data');

  // Protection Status panel — show a clear not-connected state
  safeSet('ssl-status',   '— Not connected');
  safeSet('ssl-issuer',   '—');
  safeSet('ssl-expires',  '—');
  safeSet('ssl-protocol', '—');
  safeSet('ssl-https',    '—');
  safeSet('health-ssl-val',    '—');
  safeSet('health-ssl-sub',    'Domain not connected to ProCyberWall');
  safeSet('health-status-text', 'Not connected');
  safeSet('health-status-desc', 'Your domain is not yet connected to ProCyberWall. Contact us to activate protection.');
  safeSet('health-status-icon', '⚪');
}

function showCFLoading(show) {
  const msg = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted)">Loading threat logs...</td></tr>`;
  ['threats-tbody', 'threats-full-tbody'].forEach(id => {
    const el = document.getElementById(id);
    if (el && show) el.innerHTML = msg;
  });
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

function updateHealthPanel(ssl, email) {
  // ── SSL stat card ────────────────────────────────────────────────────────
  const sslValid = ssl.status && ssl.status.includes('Valid');
  const daysLeft = sslDaysLeft(ssl.expires);

  if (sslValid && daysLeft !== null) {
    safeSet('health-ssl-val', daysLeft > 30 ? 'Secure' : daysLeft + 'd left');
    safeSet('health-ssl-sub', `Expires in ${daysLeft} days`);
    const sslVal = document.getElementById('health-ssl-val');
    if (sslVal) sslVal.style.color = daysLeft > 30 ? 'var(--green)' : daysLeft > 7 ? 'var(--orange)' : 'var(--red)';
  } else if (sslValid) {
    safeSet('health-ssl-val', 'Secure');
    safeSet('health-ssl-sub', ssl.expires || '—');
  } else {
    safeSet('health-ssl-val', 'Issue');
    safeSet('health-ssl-sub', 'Check SSL settings');
    const sslVal = document.getElementById('health-ssl-val');
    if (sslVal) sslVal.style.color = 'var(--red)';
  }

  // ── Uptime stat card ─────────────────────────────────────────────────────
  const uptimeEl  = document.getElementById('stat-uptime');
  const uptimeTxt = uptimeEl ? uptimeEl.textContent : '—';
  const uptimeDisplay = (uptimeTxt && uptimeTxt !== '0' && uptimeTxt !== '—') ? uptimeTxt : '—';
  safeSet('health-uptime-val', uptimeDisplay);
  const uptimeVal = document.getElementById('health-uptime-val');
  if (uptimeVal) uptimeVal.style.color = uptimeDisplay !== '—' ? 'var(--green)' : 'var(--muted)';

  // ── Response time stat card ──────────────────────────────────────────────
  const responseEl = document.getElementById('stat-response');
  const responseMs = responseEl ? responseEl.textContent : '—';
  const responseDisplay = (responseMs && responseMs !== '0' && responseMs !== '—') ? responseMs : '—';
  safeSet('health-response-val', responseDisplay);
  const responseVal = document.getElementById('health-response-val');
  if (responseVal) responseVal.style.color = responseDisplay !== '—' ? 'var(--green)' : 'var(--muted)';

  // ── Domain stat card ─────────────────────────────────────────────────────
  const httpsEnforced = ssl.httpsEnforced;
  safeSet('health-domain-val', httpsEnforced ? 'Active' : 'Limited');
  safeSet('health-domain-sub', httpsEnforced ? 'HTTPS enforced' : 'HTTPS not enforced');
  const domainVal = document.getElementById('health-domain-val');
  if (domainVal) domainVal.style.color = httpsEnforced ? 'var(--green)' : 'var(--orange)';

  // ── Overall health banner ────────────────────────────────────────────────
  const hasDmarcIssue = email.dmarc && email.dmarc.includes('✗');
  const sslExpiringSoon = daysLeft !== null && daysLeft <= 30;
  const sslCritical = !sslValid || (daysLeft !== null && daysLeft <= 7);

  let icon, statusText, statusColor, desc;
  if (sslCritical) {
    icon = '🔴'; statusText = 'Needs Attention'; statusColor = 'var(--red)';
    desc = 'Your site has an SSL issue — visitors may see a security warning. Contact ProCyberWall support immediately.';
  } else if (sslExpiringSoon || hasDmarcIssue || !httpsEnforced) {
    icon = '🟡'; statusText = 'Warning'; statusColor = 'var(--orange)';
    const issues = [];
    if (sslExpiringSoon) issues.push(`your SSL certificate expires in ${daysLeft} days`);
    if (hasDmarcIssue) issues.push('email protection is not fully set up');
    if (!httpsEnforced) issues.push('HTTPS is not enforced');
    desc = 'Heads up — ' + issues.join(', ') + '. Review the details below.';
  } else {
    icon = '🟢'; statusText = 'Good'; statusColor = 'var(--green)';
    desc = 'Your site is protected, fast, and fully online. ProCyberWall is watching 24/7.';
  }

  safeSet('health-status-text', statusText);
  safeSet('health-status-icon', icon);
  safeSet('health-status-desc', desc);
  safeSet('health-check-time', new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
  const statusEl = document.getElementById('health-status-text');
  if (statusEl) statusEl.style.color = statusColor;
}

// ── TRAFFIC ANALYTICS (GraphQL) ───────────────────────────────────────────
let _lastTrafficDomain = null, _lastTrafficZone = null, _trafficLoaded = false;

function initAndLoadTraffic() {
  // Lazy-init the Chart.js instance now that the canvas is visible
  if (!window._trafficChart) {
    const canvas = document.getElementById('chart-traffic-24h');
    if (canvas) {
      window._trafficChart = new Chart(canvas, {
        type: 'line',
        data: { labels: [], datasets: [
          { label: 'Requests', data: [], borderColor: '#6b8fff', backgroundColor: 'rgba(107,143,255,0.08)', tension: 0.4, borderWidth: 2, pointRadius: 0, fill: true },
          { label: 'Mitigated', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.06)', tension: 0.4, borderWidth: 2, pointRadius: 0, fill: true },
          { label: 'Cached',   data: [], borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.06)',  tension: 0.4, borderWidth: 2, pointRadius: 0, fill: true },
        ]},
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#888', font: { size: 10 }, maxTicksLimit: 12 }, grid: { display: false } },
            y: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(128,128,128,0.1)' }, beginAtZero: true },
          },
        },
      });
    }
  }
  if (_lastTrafficDomain) loadTrafficAnalytics(_lastTrafficDomain, _lastTrafficZone);
}

async function loadTrafficAnalytics(domain, zoneId) {
  _lastTrafficDomain = domain;
  _lastTrafficZone   = zoneId;
  setTrafficState('loading');
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const headers = {};
    if (session?.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
    let url = `/api/cf/traffic?domain=${encodeURIComponent(domain)}`;
    if (zoneId) url += `&zone_id=${encodeURIComponent(zoneId)}`;
    const res  = await fetch(url, { headers });
    if (res.status === 401) {
      await supabaseClient.auth.signOut();
      window.location.replace('auth.html');
      return;
    }
    const data = await res.json();
    if (data.error) { setTrafficState('error', data.error); return; }
    renderTrafficAnalytics(data);
    setTrafficState('done');
  } catch (err) {
    setTrafficState('error', err.message);
  }
}

function renderTrafficAnalytics(d) {
  const s     = d.summary || {};
  const total = s.total   || 0;

  safeSet('tr-total',     total.toLocaleString());
  safeSet('tr-mitigated', (s.mitigated     || 0).toLocaleString());
  safeSet('tr-cached',    (s.servedByCF    || 100) + '%');
  safeSet('tr-origin',    (s.servedByOrigin || 0).toLocaleString());

  const pct = v => total > 0 ? Math.round(v / total * 100) + '% of total' : '';
  safeSet('tr-mitigated-pct', pct(s.mitigated     || 0));
  safeSet('tr-cached-pct',    '');
  safeSet('tr-origin-pct',    pct(s.servedByOrigin || 0));

  if (window._trafficChart && d.timeseries?.length) {
    const fmt = h => new Date(h).getHours().toString().padStart(2, '0') + ':00';
    window._trafficChart.data.labels             = d.timeseries.map(t => fmt(t.hour));
    window._trafficChart.data.datasets[0].data  = d.timeseries.map(t => t.requests);
    window._trafficChart.data.datasets[1].data  = d.timeseries.map(t => t.threats);
    window._trafficChart.data.datasets[2].data  = d.timeseries.map(t => t.cached);
    window._trafficChart.update();
  }

  renderBarList('tr-countries',  d.countries);
  renderBarList('tr-devices',    d.devices);
  renderBarList('tr-methods',    d.methods);
  renderBarList('tr-cache',      d.cacheStatus);
  renderBarList('tr-protocols',  d.protocols);
  renderBarList('tr-fw-actions', d.fwActions);

  const ipEl = document.getElementById('tr-top-ips');
  if (ipEl) {
    const ips = d.topIPs || [];
    if (!ips.length) { ipEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">No blocked IPs in the last 24 h</div>'; return; }
    const maxV = ips[0]?.value || 1;
    ipEl.innerHTML = ips.map(item => `
      <div class="tr-bar-row" style="padding:2px 0">
        <span class="tr-bar-label" style="font-family:monospace;font-size:12px">${escapeHtml(maskIP(item.label))}</span>
        <span class="tr-bar-val">${item.value}</span>
        <div class="tr-bar-track"><div class="tr-bar-fill" style="width:${Math.round(item.value / maxV * 100)}%;background:#ef4444"></div></div>
      </div>`).join('');
  }
}

function renderBarList(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items?.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">No data</div>'; return; }
  const maxV = Math.max(items[0]?.value || 1, 1);
  el.innerHTML = items.map(item => `
    <div class="tr-bar-row">
      <span class="tr-bar-label">${escapeHtml(String(item.label || '—'))}</span>
      <span class="tr-bar-val">${item.value}</span>
      <div class="tr-bar-track"><div class="tr-bar-fill" style="width:${Math.round(item.value / maxV * 100)}%"></div></div>
    </div>`).join('');
}

function setTrafficState(state, msg) {
  const statIds = ['tr-countries','tr-devices','tr-methods','tr-cache','tr-protocols','tr-fw-actions','tr-top-ips'];
  const errBanner = document.getElementById('tr-error-banner');
  if (state === 'loading') {
    statIds.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = '<div style="color:var(--muted);font-size:12px">Loading…</div>'; });
    if (errBanner) errBanner.style.display = 'none';
  } else if (state === 'error') {
    statIds.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = '<div style="color:var(--muted);font-size:12px">—</div>'; });
    if (errBanner) { errBanner.textContent = '⚠ ' + (msg || 'Failed to load data'); errBanner.style.display = ''; }
  } else {
    if (errBanner) errBanner.style.display = 'none';
  }
}

function refreshTrafficPanel() {
  if (_lastTrafficDomain) loadTrafficAnalytics(_lastTrafficDomain, _lastTrafficZone);
}

function sslDaysLeft(expiresStr) {
  if (!expiresStr || expiresStr === '—') return null;
  // Strip "(X days)" suffix if present before parsing
  const clean = expiresStr.replace(/\s*\(\d+\s*days?\)/i, '').trim();
  const d = new Date(clean);
  if (isNaN(d)) return null;
  const days = Math.ceil((d - Date.now()) / 86400000);
  return days > 0 ? days : 0;
}
