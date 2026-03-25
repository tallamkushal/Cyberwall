# CyberWall — Claude Code Guide

## What This Project Is

CyberWall is a managed Web Application Firewall (WAF) service for small businesses. It sits in front of customer websites via Cloudflare, handles WAF rules, SSL monitoring, and sends real-time WhatsApp alerts. Customers get a dashboard; admins manage everything from an internal panel.

## How to Run

```bash
# Windows (recommended)
./start.bat

# Manual
node server.js
# then open http://localhost:3001
```

Requires `ANTHROPIC_API_KEY` set as a Windows User environment variable.

## Tech Stack

- **Backend:** Node.js with no framework — raw `http` module, manual routing via `req.method` + `req.url`
- **Frontend:** Vanilla HTML/CSS/JS — no build step, no bundler
- **Database:** Supabase (PostgreSQL + Auth + RLS)
- **AI:** Anthropic Claude API (`@anthropic-ai/sdk`) — streaming via SSE
- **WAF:** Cloudflare API
- **Alerts:** Twilio WhatsApp API

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | All backend routes and AI endpoints |
| `index.html` | Landing page with Wally chat widget |
| `auth.html` | Login/signup via Supabase Auth |
| `dashboard.html` | Client-facing dashboard |
| `admin.html` | Internal admin panel |
| `onboarding.html` | Client onboarding flow |
| `JS/auth.js` | Supabase auth logic |
| `JS/dashboard.js` | Dashboard UI and data loading |
| `JS/admin.js` | Admin panel logic |
| `JS/cloudflare.js` | Cloudflare API calls |
| `JS/whatsapp.js` | Twilio WhatsApp integration |
| `JS/supabase.js` | Supabase client init |
| `JS/landing-chat.js` | Landing page chat widget |
| `supabase-setup.sql` | DB schema and RLS policies |

## AI Endpoints (server.js)

| Route | Model | Persona |
|-------|-------|---------|
| `/api/landing-chat` | claude-haiku-4-5 | "Wally" — friendly sales bot for visitors |
| `/api/ai-chat` | claude-haiku-4-5 | Client assistant — jovial, emojis, short answers |
| `/api/admin-ai-chat` | claude-opus-4-6 | Admin assistant — professional, actionable |
| `/api/ai-agent` | claude-opus-4-6 | Tool-calling agent with dashboard tools |

All AI routes stream responses using Server-Sent Events (`text/event-stream`).

## Pricing Tiers

- **Starter** — $29/mo (or ₹2,499 + 18% GST)
- **Pro** — $59/mo (or ₹4,999 + 18% GST)
- **Business** — $99/mo (or ₹8,499 + 18% GST)
- All plans include a 7-day free trial.

## Database Schema

Single `profiles` table in Supabase:
- Fields: `id`, `email`, `full_name`, `company`, `domain`, `plan`, `role` (client/admin), `status` (trial/active/overdue/cancelled)
- RLS: users see only their own row; admins see all rows

## Security Notes (Known Issues)

Cloudflare, Twilio, and Supabase credentials are currently hardcoded in frontend JS files. These should be moved to backend environment variables before production deployment.
