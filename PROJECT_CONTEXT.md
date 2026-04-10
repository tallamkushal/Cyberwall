# CyberWall — Project Context for New Claude Session

## What is CyberWall?
A managed Web Application Firewall (WAF) SaaS for small businesses in India.
- Sits in front of customer websites via Cloudflare
- Handles WAF rules, SSL monitoring, real-time WhatsApp alerts
- Customers get a dashboard; admins manage from an internal panel

## Live URL
**https://cyberwall.onrender.com** (deployed on Render free tier)

## Tech Stack
- **Backend:** Node.js — raw `http` module, no framework, manual routing in `server.js`
- **Frontend:** Vanilla HTML/CSS/JS — no build step, no bundler
- **Database:** Supabase (PostgreSQL + Auth + RLS)
- **AI:** Anthropic Claude API (`@anthropic-ai/sdk`) — streaming via SSE
- **WAF:** Cloudflare API
- **Alerts:** Twilio WhatsApp API
- **Hosting:** Render (free tier — sleeps after 15 min inactivity)

## Key Files
| File | Purpose |
|------|---------|
| `server.js` | All backend routes and AI endpoints |
| `index.html` | Landing page with Wally chat widget |
| `auth.html` | Login/signup via Supabase Auth |
| `dashboard.html` | Client-facing dashboard |
| `admin.html` | Internal admin panel |
| `onboarding.html` | Client onboarding flow |
| `js/auth.js` | Supabase auth logic |
| `js/dashboard.js` | Dashboard UI and data loading |
| `js/admin.js` | Admin panel logic |
| `js/cloudflare.js` | Cloudflare API calls |
| `js/whatsapp.js` | Twilio WhatsApp integration |
| `js/supabase.js` | Supabase client init |
| `js/landing-chat.js` | Landing page chat widget |

## AI Endpoints (server.js)
| Route | Model | Persona |
|-------|-------|---------|
| `/api/landing-chat` | claude-haiku-4-5 | "Wally" — friendly sales bot for visitors |
| `/api/ai-chat` | claude-haiku-4-5 | Client assistant — jovial, emojis, short answers |
| `/api/admin-ai-chat` | claude-opus-4-6 | Admin assistant — professional, actionable |
| `/api/ai-agent` | claude-opus-4-6 | Tool-calling agent with dashboard tools |

All AI routes stream responses using Server-Sent Events (`text/event-stream`).

## Pricing Tiers
- **Starter** — ₹2,999/mo
- **Pro** — ₹5,999/mo
- **Business** — ₹9,999/mo
- All plans include a 7-day free trial

## Database
Single `profiles` table in Supabase:
- Fields: `id`, `email`, `full_name`, `company`, `domain`, `plan`, `role` (client/admin), `status` (trial/active/overdue/cancelled)
- RLS: users see only their own row; admins see all rows

## GitHub Repo
https://github.com/tallamkushal/Cyberwall

## Environment Variables
- `ANTHROPIC_API_KEY` — set as Windows User env var locally, set in Render dashboard for production

## What Has Been Done (Completed Work)

### Features Built
- Full auth flow (signup multi-step, login, logout, forgot password)
- Client dashboard with WAF stats, SSL monitoring, threat feed
- Admin panel with client management
- Onboarding flow for new clients
- AI Security Assistant in dashboard (streaming, SSE)
- Wally chat widget on landing page
- WhatsApp alerts via Twilio on new signups
- Cloudflare WAF rule management

### AI Assistant Improvements
- Streaming word-by-word responses via SSE
- Markdown rendering in chat
- Short, conversational answers in plain English
- Jovial tone with emojis for client assistant
- Professional tone for admin assistant

### Bug Fixes
- Fixed retry logic for profile insert (foreign key constraint on signup)
- Fixed logout button on admin panel
- Fixed onboarding back button, domain validation
- Fixed WhatsApp number format
- Fixed Twilio auth token
- Fixed clients count badge in admin sidebar
- Fixed debug alerts removed, WhatsApp notify made non-blocking

### Deployment (Render)
- Moved from Netlify (static-only) to Render (full Node.js support)
- Fixed `PORT` to use `process.env.PORT || 3001` for Render compatibility
- Fixed folder casing: `JS/` → `js/`, `CSS/` → `css/` (Linux is case-sensitive)
- Fixed API URLs to auto-detect local vs production using `window.location.hostname`
- Git force-tracked the folder renames (Windows git ignores case changes by default)

## Known Issues / TODO
- Cloudflare, Twilio, and Supabase credentials are hardcoded in frontend JS files — should be moved to backend env variables before real production use
- Render free tier sleeps after 15 min inactivity (consider UptimeRobot to keep it awake)
- No custom domain yet (currently on `cyberwall.onrender.com`)

## How to Run Locally
```bash
./start.bat
# then open http://localhost:3001
```
Requires `ANTHROPIC_API_KEY` set as a Windows User environment variable.
