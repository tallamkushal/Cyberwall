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

    // Small delay to ensure auth user is saved
    await new Promise(resolve => setTimeout(resolve, 500));

    const { error: profileError } = await supabaseClient.from('profiles').insert({
      id: userId,
      full_name: fullName,
      email, phone,
      business_name: businessName,
      domain, plan,
      status: 'trial',
      role: 'client',
      created_at: new Date()
    });
    if (profileError) throw profileError;

    // Notify admin on WhatsApp
    await notifyAdminNewSignup(fullName, email, plan, domain);

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
  const { data: profile } = await supabaseClient
    .from('profiles').select('*').eq('id', session.user.id).single();
  return profile;
}

async function resetPassword(email) {
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/auth.html'
  });
  return error ? { success: false, error: error.message } : { success: true };
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
