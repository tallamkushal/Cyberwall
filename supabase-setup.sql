-- ============================================
-- CYBERWALL — Database Setup
-- Run this SQL in your Supabase SQL Editor
-- Go to: Supabase → SQL Editor → New Query
-- Paste this → Click Run
-- ============================================

-- PROFILES TABLE
-- Stores extra info about each user
-- (Supabase Auth already stores email/password)
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT,
  email         TEXT,
  phone         TEXT,
  business_name TEXT,
  domain        TEXT,
  plan          TEXT DEFAULT 'starter',   -- starter, pro, business
  status        TEXT DEFAULT 'trial',     -- trial, active, overdue, cancelled
  role          TEXT DEFAULT 'client',    -- client, admin
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Allow users to read/write their own profile only
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Admins can see ALL profiles
CREATE POLICY "Admins can view all profiles"
  ON profiles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- Make yourself an admin
-- After you sign up, run this with YOUR email:
-- UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
-- ============================================

-- TASKS TABLE
-- Admin-created manual tasks + action items
CREATE TABLE tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  priority    TEXT DEFAULT 'med',      -- high, med, low
  due_date    DATE,
  completed   BOOLEAN DEFAULT FALSE,
  client_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks are admin/server-only. Enable RLS with no client policies so direct
-- client access is blocked. The service_role key used in server.js bypasses
-- RLS entirely, so backend access is unaffected.
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- SUPPORT TICKETS TABLE
-- Clients submit tickets; admin resolves them
CREATE TABLE support_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject     TEXT NOT NULL,
  message     TEXT NOT NULL,
  status      TEXT DEFAULT 'open',     -- open, resolved
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Clients can only see their own tickets
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients view own tickets"
  ON support_tickets FOR SELECT
  USING (auth.uid() = client_id);

CREATE POLICY "Clients insert own tickets"
  ON support_tickets FOR INSERT
  WITH CHECK (auth.uid() = client_id);

-- Admin can see/update all tickets (via service key — bypasses RLS)

-- ============================================
-- MIGRATION: Cloudflare zone tracking
-- Run this if the profiles table already exists
-- ============================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS cf_zone_id  TEXT,
  ADD COLUMN IF NOT EXISTS nameservers TEXT;  -- comma-separated, e.g. "aida.ns.cloudflare.com,noah.ns.cloudflare.com"

-- ============================================
-- HISTORICAL DATA TABLES
-- Run these to enable data collection
-- ============================================

-- THREAT SNAPSHOTS — daily threat counts per client
-- Written every time a client loads their dashboard
CREATE TABLE IF NOT EXISTS threat_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  domain           TEXT NOT NULL,
  date             DATE NOT NULL DEFAULT CURRENT_DATE,
  threats_today    INTEGER DEFAULT 0,   -- threats in last 24h
  threats_7d       INTEGER DEFAULT 0,   -- threats in last 7 days
  total_requests   INTEGER DEFAULT 0,   -- total requests in last 24h
  clean_requests   INTEGER DEFAULT 0,   -- clean requests in last 24h
  block_rate_pct   INTEGER DEFAULT 0,   -- % of traffic blocked
  recorded_at      TIMESTAMPTZ DEFAULT NOW()
);

-- One snapshot per client per day
CREATE UNIQUE INDEX IF NOT EXISTS threat_snapshots_daily
  ON threat_snapshots (profile_id, date);

ALTER TABLE threat_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients view own snapshots"
  ON threat_snapshots FOR SELECT
  USING (auth.uid() = profile_id);

-- SECURITY SCORES — score history per domain over time
CREATE TABLE IF NOT EXISTS security_scores (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  domain       TEXT NOT NULL,
  score        INTEGER NOT NULL,
  grade        TEXT NOT NULL,
  issues       JSONB,                  -- array of issues found
  scanned_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE security_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients view own scores"
  ON security_scores FOR SELECT
  USING (auth.uid() = profile_id);

-- DOMAIN ANALYTICS — daily aggregate traffic per client
CREATE TABLE IF NOT EXISTS domain_analytics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  domain           TEXT NOT NULL,
  date             DATE NOT NULL DEFAULT CURRENT_DATE,
  total_requests   INTEGER DEFAULT 0,
  threats_blocked  INTEGER DEFAULT 0,
  cached_requests  INTEGER DEFAULT 0,
  bandwidth_bytes  BIGINT DEFAULT 0,
  recorded_at      TIMESTAMPTZ DEFAULT NOW()
);

-- One analytics row per client per day
CREATE UNIQUE INDEX IF NOT EXISTS domain_analytics_daily
  ON domain_analytics (profile_id, date);

ALTER TABLE domain_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients view own analytics"
  ON domain_analytics FOR SELECT
  USING (auth.uid() = profile_id);
