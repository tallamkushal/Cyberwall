// ============================================
// CYBERWALL — Cloudflare Integration
// This file:
// - Connects to Cloudflare API
// - Fetches real threat data for each client
// - Gets real analytics and attack logs
// ============================================

const CF_EMAIL = "tallamkushal@gmail.com";
const CF_API_KEY = "_csyi7LY_2v8rV3awxCy_qotEiBWQyCmsv9aIVmv";
const CF_BASE = "https://api.cloudflare.com/client/v4";

// Headers needed for every Cloudflare API call
const CF_HEADERS = {
  "X-Auth-Email": CF_EMAIL,
  "X-Auth-Key": CF_API_KEY,
  "Content-Type": "application/json"
};

// ---- GET ALL ZONES (websites) ----
// A "zone" in Cloudflare = one website
async function getZones() {
  try {
    const res = await fetch(`${CF_BASE}/zones`, {
      headers: CF_HEADERS
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.errors[0].message);
    return data.result; // array of zones
  } catch (err) {
    console.error("Cloudflare zones error:", err);
    return [];
  }
}

// ---- GET ZONE ID FOR A DOMAIN ----
async function getZoneId(domain) {
  const zones = await getZones();
  // Clean domain — remove https:// and www.
  const cleanDomain = domain.replace(/https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const zone = zones.find(z => z.name === cleanDomain);
  return zone ? zone.id : null;
}

// ---- GET THREAT STATS FOR A ZONE ----
async function getThreatStats(zoneId) {
  try {
    // Get last 7 days of analytics
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const until = new Date().toISOString();

    const res = await fetch(
      `${CF_BASE}/zones/${zoneId}/analytics/dashboard?since=${since}&until=${until}&continuous=true`,
      { headers: CF_HEADERS }
    );
    const data = await res.json();
    if (!data.success) throw new Error(data.errors[0].message);

    const totals = data.result.totals;
    return {
      totalRequests: totals.requests.all || 0,
      threatsBlocked: totals.requests.threat || 0,
      bandwidth: totals.bandwidth.all || 0,
      uniqueVisitors: totals.uniques.all || 0
    };
  } catch (err) {
    console.error("Cloudflare analytics error:", err);
    return null;
  }
}

// ---- GET FIREWALL EVENTS (actual attacks) ----
async function getFirewallEvents(zoneId) {
  try {
    const res = await fetch(
      `${CF_BASE}/zones/${zoneId}/firewall/events?per_page=20`,
      { headers: CF_HEADERS }
    );
    const data = await res.json();
    if (!data.success) throw new Error(data.errors[0].message);
    return data.result || [];
  } catch (err) {
    console.error("Cloudflare firewall events error:", err);
    return [];
  }
}

// ---- GET SSL STATUS ----
async function getSSLStatus(zoneId) {
  try {
    const res = await fetch(
      `${CF_BASE}/zones/${zoneId}/ssl/analyze`,
      { headers: CF_HEADERS }
    );
    const data = await res.json();
    if (!data.success) throw new Error(data.errors[0].message);
    return data.result;
  } catch (err) {
    console.error("Cloudflare SSL error:", err);
    return null;
  }
}

// ---- ADD A NEW DOMAIN TO CLOUDFLARE ----
// Called when you onboard a new client
async function addDomainToCloudflare(domain) {
  try {
    // Clean domain
    const cleanDomain = domain.replace(/https?:\/\//, '').replace(/^www\./, '').split('/')[0];

    const res = await fetch(`${CF_BASE}/zones`, {
      method: "POST",
      headers: CF_HEADERS,
      body: JSON.stringify({
        name: cleanDomain,
        jump_start: true  // auto-scan DNS records
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.errors[0].message);

    return {
      success: true,
      zoneId: data.result.id,
      nameservers: data.result.name_servers, // client needs to update these
      status: data.result.status
    };
  } catch (err) {
    console.error("Add domain error:", err);
    return { success: false, error: err.message };
  }
}

// ---- LOAD REAL CLOUDFLARE DATA INTO DASHBOARD ----
async function loadCloudflareData(domain) {
  // Show loading state
  showCFLoading(true);

  // Step 1: Get zone ID for this domain
  const zoneId = await getZoneId(domain);

  if (!zoneId) {
    // Domain not in Cloudflare yet
    showCFLoading(false);
    showCFNotSetup();
    return;
  }

  // Step 2: Get real stats
  const [stats, events] = await Promise.all([
    getThreatStats(zoneId),
    getFirewallEvents(zoneId)
  ]);

  // Step 3: Update the dashboard UI
  if (stats) {
    safeSet('stat-blocked',  stats.threatsBlocked.toLocaleString('en-IN'));
    safeSet('stat-requests', stats.totalRequests.toLocaleString('en-IN'));
    safeSet('stat-visitors', stats.uniqueVisitors.toLocaleString('en-IN'));
  }

  // Step 4: Update threats table with real events
  if (events.length > 0) {
    renderRealThreats(events);
  }

  showCFLoading(false);
}

// ---- RENDER REAL THREAT EVENTS ----
function renderRealThreats(events) {
  const tbody = document.getElementById('threats-tbody');
  if (!tbody) return;

  tbody.innerHTML = events.map(e => `
    <tr>
      <td>${e.action || 'Block'}</td>
      <td class="font-mono" style="font-size:12px">${maskIP(e.ip || '')}</td>
      <td>${getCountryFlag(e.country)} ${e.country || '—'}</td>
      <td style="color:var(--muted);font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${e.uri || '/'}</td>
      <td style="color:var(--muted);font-size:12px">${timeAgo(e.occurred_at)}</td>
      <td><span class="badge badge-red">High</span></td>
      <td><span class="badge badge-green">Blocked</span></td>
    </tr>
  `).join('');
}

// ---- SHOW NOT SETUP STATE ----
function showCFNotSetup() {
  const tbody = document.getElementById('threats-tbody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;padding:32px">
          <div style="font-size:24px;margin-bottom:10px">⚙️</div>
          <div style="font-weight:600;margin-bottom:6px">Domain not connected to Cloudflare yet</div>
          <div style="font-size:12px;color:var(--muted)">Contact CyberWall support on WhatsApp to complete setup</div>
        </td>
      </tr>`;
  }
}

// ---- LOADING STATE ----
function showCFLoading(show) {
  const tbody = document.getElementById('threats-tbody');
  if (tbody && show) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;padding:24px;color:var(--muted)">
          <span class="spinner" style="border-color:var(--accent);border-top-color:transparent"></span>
          Loading real threat data...
        </td>
      </tr>`;
  }
}

// ---- HELPERS ----
function maskIP(ip) {
  // Hide last part of IP for privacy e.g. 103.28.44.123 → 103.28.xx.xx
  return ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/, '$1.$2.xx.xx');
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function getCountryFlag(code) {
  const flags = {
    CN: '🇨🇳', RU: '🇷🇺', US: '🇺🇸', IN: '🇮🇳',
    DE: '🇩🇪', BR: '🇧🇷', UA: '🇺🇦', GB: '🇬🇧',
    FR: '🇫🇷', JP: '🇯🇵', KR: '🇰🇷', NL: '🇳🇱'
  };
  return flags[code] || '🌍';
}

function safeSet(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
