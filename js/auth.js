// ============================================
// CYBERWALL — Auth Logic
// This file handles:
// - Signing up new users
// - Logging in existing users
// - Logging out
// - Checking if someone is logged in
// - Session guards (bfcache, inactivity, PWA keepalive)
// ============================================

// ── PWA detection ─────────────────────────────────────────────────────────
function isPWA() {
  return window.matchMedia('(display-mode: standalone)').matches
      || navigator.standalone === true;
}

// ── Bfcache guard ─────────────────────────────────────────────────────────
// Fires when browser restores a page from back/forward cache without re-running JS.
// Re-checks session so a logged-out user can't see protected pages via back button.
function _setupBfcacheGuard() {
  window.addEventListener('pageshow', async (e) => {
    if (e.persisted) {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) window.location.replace('auth.html');
    }
  });
}

// ── Inactivity auto-logout (browser only — PWA stays logged in) ───────────
const _INACTIVITY_MS  = 30 * 60 * 1000; // 30 min idle → logout
const _WARNING_BEFORE =  2 * 60 * 1000; // warn 2 min before logout
let _idleTimer = null, _warnTimer = null;

function _dismissWarning() {
  const el = document.getElementById('_idle_warning');
  if (el) el.remove();
}

function _showIdleWarning() {
  _dismissWarning();
  const div = document.createElement('div');
  div.id = '_idle_warning';
  div.style.cssText = [
    'position:fixed','bottom:90px','left:50%','transform:translateX(-50%)',
    'z-index:9999','background:#1e1e2e','border:1.5px solid rgba(251,191,36,0.4)',
    'border-radius:14px','padding:14px 18px','display:flex','align-items:center',
    'gap:14px','box-shadow:0 8px 32px rgba(0,0,0,0.35)','min-width:280px',
    'max-width:90vw','font-family:"DM Sans",sans-serif'
  ].join(';');
  div.innerHTML = `
    <span style="font-size:22px">⏱</span>
    <div style="flex:1">
      <div style="font-size:13px;font-weight:700;color:white">Logging out in 2 minutes</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:2px">Tap anywhere to stay logged in</div>
    </div>
    <button id="_idle_stay" style="background:#1a47e8;color:white;border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer">Stay in</button>
  `;
  document.body.appendChild(div);
  document.getElementById('_idle_stay').onclick = _resetIdleTimer;
}

function _resetIdleTimer() {
  clearTimeout(_idleTimer);
  clearTimeout(_warnTimer);
  _dismissWarning();
  _warnTimer = setTimeout(_showIdleWarning, _INACTIVITY_MS - _WARNING_BEFORE);
  _idleTimer  = setTimeout(() => logOut(), _INACTIVITY_MS);
}

function _setupInactivityTimer() {
  if (isPWA()) return; // PWA users stay logged in indefinitely
  ['mousemove','keydown','touchstart','click','scroll'].forEach(ev =>
    document.addEventListener(ev, _resetIdleTimer, { passive: true })
  );
  _resetIdleTimer();
}

// ── PWA foreground keepalive ──────────────────────────────────────────────
// When the installed app is reopened from background, silently refresh the session.
function _setupPWAKeepalive() {
  if (!isPWA()) return;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) window.location.replace('auth.html');
    }
  });
}

async function _createProfile(userId, email, fullName, phone, businessName, domain, plan) {
  const SERVER = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
  const res = await fetch(`${SERVER}/api/create-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: userId, full_name: fullName, email, phone,
      business_name: businessName, domain, plan,
      status: 'trial', role: 'client', created_at: new Date()
    })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Profile creation failed');
}

async function signUp(email, password, fullName, phone, businessName, domain, plan) {
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email, password,
      options: { data: { full_name: fullName, phone } }
    });
    if (error) throw error;

    const userId = data?.user?.id || data?.session?.user?.id;
    if (!userId) throw new Error('User creation failed. Please try again.');

    // Fast path: session exists (email confirmation is disabled in Supabase)
    if (data.session) {
      await _createProfile(userId, email, fullName, phone, businessName, domain, plan);
      return { success: true, user: data.user };
    }

    // No session — email confirmation is required OR this is a re-signup to an existing email.
    // Supabase returns a fake user ID (email enumeration protection) for existing emails,
    // which would cause a FK violation when inserting the profile.
    // Try signing in to determine which case this is.
    const { data: signInData, error: signInError } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (signInData?.session) {
      // Confirmation was actually off — sign-in succeeded right away
      await _createProfile(signInData.user.id, email, fullName, phone, businessName, domain, plan);
      return { success: true, user: signInData.user };
    }

    const signInMsg = (signInError?.message || '').toLowerCase();

    if (signInMsg.includes('not confirmed') || signInMsg.includes('email not confirmed')) {
      // Real new user — email is in auth.users, FK will be valid
      await _createProfile(userId, email, fullName, phone, businessName, domain, plan);
      return { success: true, user: data.user, needsConfirmation: true };
    }

    // Sign-in failed for an unrelated reason — likely Supabase returned a fake response
    // because an account with this email already exists. Don't attempt profile creation.
    throw new Error('An account with this email already exists. Please log in, or check your inbox for a confirmation link.');

  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function logIn(email, password) {
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const { data: profile } = await supabaseClient
      .from('profiles').select('role').eq('id', data.user.id).single();

    window.location.href = profile?.role === 'admin' ? 'admin.html' : 'dashboard.html';
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function logOut() {
  // Clear inactivity timers before redirect
  clearTimeout(_idleTimer);
  clearTimeout(_warnTimer);
  _dismissWarning();
  await supabaseClient.auth.signOut();
  window.location.replace('auth.html');
}

async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.replace('auth.html'); return null; }

  // Wire up all session guards (safe to call multiple times — guards check isPWA internally)
  _setupBfcacheGuard();
  _setupInactivityTimer();
  _setupPWAKeepalive();

  return session.user;
}

async function getCurrentProfile() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;
  // Retry up to 5 times — PGRST116 can fire even when profile exists due to Supabase replication lag
  for (let i = 0; i < 5; i++) {
    const { data: profile, error } = await supabaseClient
      .from('profiles').select('*').eq('id', session.user.id).single();
    if (profile) return profile;
    await new Promise(r => setTimeout(r, 600));
  }
  return null;
}

async function resetPassword(email) {
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/auth.html'
  });
  return error ? { success: false, error: error.message } : { success: true };
}

async function verifyEmailOtp(email, token) {
  try {
    const { error } = await supabaseClient.auth.verifyOtp({ email, token, type: 'signup' });
    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function resendEmailConfirmation(email) {
  try {
    const { error } = await supabaseClient.auth.resend({ type: 'signup', email });
    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function showToast(message, type = 'default') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
