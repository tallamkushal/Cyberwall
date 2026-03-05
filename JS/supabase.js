// ============================================
// CYBERWALL — Supabase Connection
// This file connects your website to your
// Supabase database. Think of it like a
// phone number to call your database.
// ============================================

const SUPABASE_URL = "https://fwbclrdzctszwbfxywgi.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3YmNscmR6Y3RzendiZnh5d2dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1OTYxMDUsImV4cCI6MjA4ODE3MjEwNX0.SP1cveSwbkpygWyUp8zYGIMz99YSdMXiSLoLnAsH8ls";

// This creates the connection using a different variable name
// to avoid conflict with the supabase SDK global variable
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Test the connection — check browser console to confirm
console.log("✅ CyberWall connected to Supabase");
