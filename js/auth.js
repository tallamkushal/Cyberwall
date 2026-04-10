// ============================================
// CYBERWALL — Auth Logic
// This file handles:
// - Signing up new users
// - Logging in existing users
// - Logging out
// - Checking if someone is logged in
// ============================================

async function signUp(email, password, fullName, phone, businessName, domain, plan) {
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email, password,
      options: { data: { full_name: fullName, phone } }
    });
    if (error) throw error;

    // Wait for user to be fully created
    const userId = data?.user?.id || data?.session?.user?.id;
    if (!userId) throw new Error('User creation failed. Please try again.');

    // Create profile via server (bypasses RLS using service key)
    const SERVER = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
    const profileRes = await fetch(`${SERVER}/api/create-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: userId,
        full_name: fullName,
        email, phone,
        business_name: businessName,
        domain, plan,
        status: 'trial',
        role: 'client',
        created_at: new Date()
      })
    });
    const profileData = await profileRes.json();
    if (!profileData.success) throw new Error(profileData.error || 'Profile creation failed');

    return { success: true, user: data.user };
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
  await supabaseClient.auth.signOut();
  window.location.href = 'auth.html';
}

async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = 'auth.html'; return null; }
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
