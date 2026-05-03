# CyberWall — Claude Code Guide

## What This Project Is

CyberWall is a managed Web Application Firewall (WAF) service for small businesses. It sits in front of customer websites via Cloudflare, handles WAF rules, SSL monitoring, and sends real-time WhatsApp alerts. Customers get a dashboard; admins manage everything from an internal panel.

## How to Run

```
./start.bat          # Windows (recommended)
node server.js       # Manual — opens http://localhost:3001
```

Requires `ANTHROPIC_API_KEY` set as a Windows User environment variable.

## Tech Stack

- **Backend:** Node.js — raw `http` module, manual routing via `req.method` + `req.url`
- **Frontend:** Vanilla HTML/CSS/JS — no build step, no bundler
- **Database:** Supabase (PostgreSQL + Auth + RLS)
- **AI:** Anthropic Claude API (`@anthropic-ai/sdk`) — streaming via SSE
- **WAF:** Cloudflare API
- **Alerts:** Twilio WhatsApp API

---

## File Map

| File | Purpose |
|------|---------|
| `server.js` | HTTP server, route dispatch, static file serving |
| `routes/cloudflare.js` | `/api/cf/overview` and `/api/cf/traffic` handlers |
| `routes/ai.js` | All AI/chat endpoints |
| `routes/admin.js` | Admin panel API |
| `routes/alerts.js` | Alert creation, read, resolve |
| `routes/misc.js` | Misc endpoints (news, dark web scan, etc.) |
| `jobs/index.js` | Background poller — refreshes zone_stats_cache every 15 min |
| `lib/cloudflare.js` | `cfGet`, `cfGraphQL`, `cfGetZoneId` helpers |
| `lib/supabase.js` | `supabaseRequest`, `supabaseUpsert` helpers |
| `lib/alerts.js` | `createAlert` helper |
| `lib/twilio.js` | Twilio WhatsApp sender |
| `JS/cloudflare.js` | Frontend: fetches `/api/cf/overview`, renders stats/charts/tables |
| `JS/dashboard.js` | Frontend: dashboard init, panel switching, all other API calls |
| `JS/admin.js` | Frontend: admin panel logic |
| `JS/auth.js` | Supabase auth (login/signup/session) |
| `JS/supabase.js` | Supabase client init |
| `JS/whatsapp.js` | Twilio WhatsApp frontend integration |
| `JS/landing-chat.js` | Landing page Wally chat widget |
| `index.html` | Landing page |
| `auth.html` | Login/signup |
| `dashboard.html` | Client dashboard |
| `admin.html` | Internal admin panel |
| `onboarding.html` | Client onboarding flow |
| `supabase-setup.sql` | DB schema and RLS policies |

---

## Backend Routes

### server.js — Route Dispatch (lines 22–110)
- CORS whitelist: `cyberwall.onrender.com`, `procyberwall.com`, `localhost:3001`
- Route order: alerts → AI → Cloudflare → admin → tickets → misc
- Static files served last; `.html/.js/.css` get `no-cache` headers
- `jobs.start()` called on startup (line 110) — starts pollers

### API Routes

| Method | Path | File | Purpose |
|--------|------|------|---------|
| POST | `/api/cf/activate` | routes/cloudflare.js | Admin: add CF zone |
| POST | `/api/cf/setup-zone` | routes/cloudflare.js | Client: configure zone |
| GET | `/api/cf/overview` | routes/cloudflare.js | Core stats (threats, SSL, score) |
| GET | `/api/cf/traffic` | routes/cloudflare.js | 24h analytics timeseries |
| POST | `/api/landing-chat` | routes/ai.js | Wally sales bot (Haiku) |
| POST | `/api/ai-chat` | routes/ai.js | Client assistant (Haiku) |
| POST | `/api/admin-ai-chat` | routes/ai.js | Admin assistant (Opus) |
| POST | `/api/ai-agent` | routes/ai.js | Tool-calling agent (Opus) |
| GET | `/api/alerts` | routes/alerts.js | Fetch alerts |
| POST | `/api/alerts/read` | routes/alerts.js | Mark alert read |
| POST | `/api/alerts/resolve` | routes/alerts.js | Mark alert resolved |
| GET | `/api/tickets/mine` | routes/misc.js | Client support tickets |
| GET | `/api/cyber-news` | routes/misc.js | News feed |
| GET | `/api/darkweb-scan` | routes/misc.js | Dark web breach scan |
| GET | `/api/security-scan` | routes/misc.js | Security score scan |

All AI routes stream via SSE (`text/event-stream`).

---

## Cache Architecture (IMPORTANT)

Two layers of caching — understand both before touching threat/stats logic.

### zone_stats_cache (Supabase table)
- **TTL:** 15 minutes
- **Written by:** `routes/cloudflare.js` (on-demand, cache miss) AND `jobs/index.js` (poller, every 15 min)
- **Read by:** `routes/cloudflare.js` — if fresh cache exists, skips ALL Cloudflare GraphQL calls
- **Schema:** `domain`, `zone_id`, `data` (JSON), `fetched_at`
- **data fields:** `threatsToday`, `threats7d`, `threats30d`, `totalRequests24h/7d/30d`, `chart7d`, `threats` (log), `attackTypes`

### security_scores (Supabase table)
- **TTL:** 1 day
- **Written by:** `routes/cloudflare.js` after overview fetch
- **Purpose:** Prevents DNS-based score fluctuation

### threat_snapshots (Supabase table)
- **Written by:** `jobs/index.js` (daily upsert per domain)
- **Purpose:** Historical chart data beyond Cloudflare Pro's 72h API retention
- **Schema:** `profile_id`, `domain`, `date`, `threats_today`, `threats_7d`, `total_requests`, `block_rate_pct`

---

## threatsToday — How It's Computed

This is the most complex and bug-prone stat. Two different code paths:

### In routes/cloudflare.js (on-demand fetch, lines 346–349)
```
chartFwData = firewallEventsAdaptiveGroups (7-day, hourly)
if chartFwData not empty:
    threatsToday = sum of chartFwData where datetimeHour >= since24h
else (fallback):
    threatsToday = sum of httpRequests1hGroups.sum.threats for last 24h
```
- Has a fallback to `httpRequests1hGroups` if `firewallEventsAdaptiveGroups` fails

### In jobs/index.js poller (lines 127–131)
```
threatsToday = sum of fwChart where datetimeHour >= since24hStr
```
- **NO fallback** — if `fwChart` is empty, `threatsToday = 0`
- Guard at line 92: `if (!gqlChart?.data) return` — skips cache write if chart query failed

### Why firewallEventsAdaptiveGroups, not httpRequests1hGroups?
`httpRequests1hGroups.sum.threats` misses managed WAF rule blocks on Cloudflare Pro/Business plans. `firewallEventsAdaptiveGroups` captures all firewall actions including managed rules.

### Cache write guards (prevents writing zeros)
- **routes/cloudflare.js line ~537:** `if (!statsCache && _hasLiveData)` — skips write if both CF data sources are empty
- **jobs/index.js line 92:** `if (!gqlChart?.data) return` — skips entire poller run for this domain if chart query failed

---

## Data Flow: Dashboard Load

```
User opens dashboard.html
  → JS/dashboard.js: loadDashboard() (line 15)
  → JS/cloudflare.js: loadCloudflareData(domain, zoneId)
  → fetch GET /api/cf/overview?domain=...&zone_id=...
      → routes/cloudflare.js:
          Check zone_stats_cache (15-min TTL)
          HIT  → return cached data, skip GraphQL
          MISS → query CF GraphQL (statsGqlPromise + chartGqlPromise)
                 compute threatsToday, chart7d, SSL, email, score
                 write new cache (if live data exists)
                 return response
  → frontend receives { stats, chart7d, threats, ssl, email, waf, ... }
  → update DOM: stat cards, Chart.js bar chart, threats table, SSL/email badges
  → JS/dashboard.js: loadTrafficAnalytics() — separate fetch to /api/cf/traffic
  → JS/dashboard.js: loadSecurityScore() — separate fetch to /api/security-scan
```

---

## Cloudflare GraphQL Queries

### statsGqlPromise (routes/cloudflare.js lines 271–274)
- Dataset: `httpRequests1hGroups` — hourly request/threat counts
- Fields: `sum{requests threats}`, `dimensions{datetime}`
- Quota fallback cascade: tries `since30d` → `since7d` → `since3d` on quota error

### chartGqlPromise (routes/cloudflare.js lines 278–290)
- Dataset: `firewallEventsAdaptiveGroups` — actual WAF block events
- Fields: `count`, `dimensions{datetimeHour}`
- Window: 7 days; limit 200 (168 hours max, so no truncation)
- 5-second timeout race (line 304)
- Used for: `threatsToday`, `chart7d` bar chart

### Poller GraphQL (jobs/index.js lines 59–88)
- Two parallel queries; Cloudflare rejects multiple aliases of same dataset in one request
- Query 1: `fwChart` (firewallEventsAdaptiveGroups, 7d) + `requests` (httpRequests1dGroups, 30d)
- Query 2: `fw` (top 10 firewall events today by count, for threats log)

---

## AI Endpoints

| Route | Model | Persona |
|-------|-------|---------|
| `/api/landing-chat` | claude-haiku-4-5 | "Wally" — friendly sales bot for visitors |
| `/api/ai-chat` | claude-haiku-4-5 | Client assistant — jovial, emojis, short answers |
| `/api/admin-ai-chat` | claude-opus-4-6 | Admin assistant — professional, actionable |
| `/api/ai-agent` | claude-opus-4-6 | Tool-calling agent with dashboard tools |

---

## Database Schema

### profiles
`id`, `email`, `full_name`, `company`, `domain`, `plan`, `role` (client/admin), `status` (trial/active/overdue/cancelled), `cf_zone_id`, `phone`
- RLS: users see only their own row; admins see all

### zone_stats_cache
`domain`, `zone_id`, `data` (JSONB), `fetched_at`
- Upserted on domain (one row per domain)

### threat_snapshots
`profile_id`, `domain`, `date`, `threats_today`, `threats_7d`, `total_requests`, `clean_requests`, `block_rate_pct`, `recorded_at`
- Unique constraint on `(profile_id, date)`

### security_scores
`profile_id`, `domain`, `score`, `grade`, `issues`, `scanned_at`

### alerts
`id`, `profile_id`, `type`, `severity`, `title`, `body`, `read`, `resolved`, `created_at`

---

## Pricing Tiers

- **Starter** — $29/mo (₹2,499 + 18% GST)
- **Pro** — $59/mo (₹4,999 + 18% GST)
- **Business** — $99/mo (₹8,499 + 18% GST)
- All plans include a 7-day free trial

---

## Frontend Patterns

- **`safeSet(id, value)`** — null-safe `textContent` setter used throughout JS/cloudflare.js
- **Server URL** — `localhost:3001` in dev, empty string (relative) in prod; detected per-file
- **Auth header** — Supabase session token added to all API calls: `Authorization: Bearer <token>`
- **Chart.js instances** — stored as `window._attacksChart`, `window._trafficChart`; must destroy before re-create
- **Threat period toggle** — `window._threatCounts = { today, sevenDay, thirtyDay }`; buttons call `setThreatPeriod()`
- **Panel switching** — `showPanel(id)` in dashboard.js manages CSS active classes + URL hash

---

## Known Issues / Gotchas

- **Cloudflare credentials hardcoded** in frontend JS files — must move to backend env vars before production
- **`datetimeHour` string comparison** — CF returns `"2026-04-30T11:00:00Z"` (no ms); `since24h` has ms (`.789Z`). String compare misses the boundary partial hour — minor undercount, not a bug
- **Poller vs route data mismatch** — poller has no fallback if `fwChart` is empty; route does. Both share same cache table
- **Security score** fetched separately from `/api/security-scan` — may differ from score inside `/api/cf/overview` response if caches are out of sync
- **`firewallEventsAdaptiveGroups` limit:200** — covers 7 days (168 hours) safely; if window is extended, raise the limit
