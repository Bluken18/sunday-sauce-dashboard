// ── Supabase config ───────────────────────────────────────────────
// REPLACE these with your Supabase project values:
const SUPABASE_URL  = 'https://ucdjvmoushzkfgghhpmp.supabase.co';
const SUPABASE_ANON = 'sb_publishable_mblO9OE9YSzQubL_X7xMNg_QLMKIyRW';

// REPLACE with your Supabase auth user ID (UUID from auth.users).
// After your first login, find it with:
//   SELECT id FROM auth.users WHERE email = 'you@example.com';
const ADMIN_USER_ID = 'e453127a-a51a-489a-b1b9-fe861e47c8af';

// The anon key is safe to expose client-side because RLS policies
// restrict all reads on session_analytics to ADMIN_USER_ID only.
// No other authenticated user can see dashboard data.
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

/**
 * Check if the current user has a valid Supabase session AND is the admin.
 * Returns true if authorized, false otherwise.
 * If the user is authenticated but not the admin, signs them out.
 */
async function checkSession() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;

    if (session.user.id !== ADMIN_USER_ID) {
      await supabase.auth.signOut();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Guard a protected page. Call on page load.
 * Redirects to index.html if not authenticated or not admin.
 */
async function requireAuth() {
  const ok = await checkSession();
  if (!ok) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}
