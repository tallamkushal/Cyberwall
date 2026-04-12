-- ── ProCyberWall: Alerts Table ──────────────────────────────────────────────
-- Run this in your Supabase dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS public.alerts (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type        text        NOT NULL DEFAULT 'system',   -- threat | ssl | darkweb | report | system
  severity    text        NOT NULL DEFAULT 'medium',   -- high | medium | low | info
  title       text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  is_read       boolean     NOT NULL DEFAULT false,
  is_resolved   boolean     NOT NULL DEFAULT false,
  resolved_at   timestamptz,
  whatsapp_sent boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Index for fast per-user queries
CREATE INDEX IF NOT EXISTS alerts_user_id_idx ON public.alerts (user_id, created_at DESC);

-- Row Level Security
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- Users can only read their own alerts
CREATE POLICY "users_see_own_alerts" ON public.alerts
  FOR SELECT USING (auth.uid() = user_id);

-- Users can mark their own alerts as read
CREATE POLICY "users_update_own_alerts" ON public.alerts
  FOR UPDATE USING (auth.uid() = user_id);

-- Server (service key) can insert — bypasses RLS automatically
-- No INSERT policy needed for service key usage

-- ── Migration: add resolved columns if table already exists ──────────────────
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS is_resolved boolean NOT NULL DEFAULT false;
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- Users can resolve their own alerts
CREATE POLICY IF NOT EXISTS "users_resolve_own_alerts" ON public.alerts
  FOR UPDATE USING (auth.uid() = user_id);

-- ── Migration: add login tracking columns to profiles ────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_login_ip   text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_login_at   timestamptz;
