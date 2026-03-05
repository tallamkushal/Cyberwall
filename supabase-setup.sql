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
